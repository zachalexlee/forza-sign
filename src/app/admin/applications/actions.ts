"use server";

import { revalidatePath } from "next/cache";
import { regenerateFilledPdf } from "@/lib/applications";
import {
  hasStampableCustomerSignature,
  resolveTemplateMap,
} from "@/lib/pdf/resolve-map";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail, signingRequestEmail } from "@/lib/email";
import { WorksheetData } from "@/lib/fields/types";
import { signingUrl } from "@/lib/signing";
import { requireStaff } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNING_TOKEN_TTL_DAYS, generateToken, tokenExpiry } from "@/lib/tokens";

/**
 * Create an application from a reviewed worksheet: pick program → resolve
 * template → copy worksheet data (office overrides live on the application).
 */
export async function createApplication(input: {
  worksheetId: string;
  programCode: string;
}): Promise<{ applicationId: string }> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const { data: worksheet } = await supabase
    .from("worksheets")
    .select("id, org_id, data, status")
    .eq("id", input.worksheetId)
    .eq("org_id", staff.orgId)
    .single();
  if (!worksheet) throw new Error("Worksheet not found");
  if (worksheet.status !== "reviewed" && worksheet.status !== "submitted") {
    throw new Error("Worksheet must be submitted or reviewed first");
  }

  const { data: program } = await supabase
    .from("programs")
    .select("id, code, name")
    .eq("code", input.programCode)
    .eq("active", true)
    .single();
  if (!program) throw new Error("Unknown program");

  const { data: template } = await supabase
    .from("templates")
    .select("id, storage_path, version")
    .eq("program_id", program.id)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) throw new Error("No template configured for this program");

  // Office-set defaults from the dictionary (e.g. sales.rep_name).
  const { data: officeDefs } = await supabase
    .from("field_definitions")
    .select("key, validation")
    .eq("ask_customer", false);
  const defaults: WorksheetData = {};
  for (const def of officeDefs ?? []) {
    const d = (def.validation as { default?: unknown } | null)?.default;
    if (d !== undefined) defaults[def.key] = d;
  }

  const { data: application, error } = await supabase
    .from("applications")
    .insert({
      org_id: worksheet.org_id,
      worksheet_id: worksheet.id,
      program_id: program.id,
      template_id: template.id,
      data: { ...defaults, ...worksheet.data },
      status: "draft",
      created_by: staff.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create application: ${error.message}`);

  await logAuditEvent({
    event_type: "created",
    org_id: worksheet.org_id,
    worksheet_id: worksheet.id,
    application_id: application.id,
    meta: { program: program.code, by: staff.fullName },
  });

  await regenerateFilledPdf(application.id);

  revalidatePath("/admin/applications");
  return { applicationId: application.id };
}

/** Apply office overrides to the application data and refill the PDF. */
export async function updateApplicationData(input: {
  applicationId: string;
  data: WorksheetData;
}): Promise<{ ok: boolean; missingFields: string[] }> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const { data: application } = await supabase
    .from("applications")
    .select("id, org_id, data, status")
    .eq("id", input.applicationId)
    .eq("org_id", staff.orgId)
    .single();
  if (!application) throw new Error("Application not found");
  if (application.status !== "draft") {
    throw new Error("Only draft applications can be edited");
  }

  const { error } = await supabase
    .from("applications")
    .update({ data: { ...application.data, ...input.data } })
    .eq("id", input.applicationId);
  if (error) throw new Error(`Save failed: ${error.message}`);

  await logAuditEvent({
    event_type: "edited",
    org_id: application.org_id,
    application_id: application.id,
    meta: { action: "office_override", by: staff.fullName },
  });

  const result = await regenerateFilledPdf(input.applicationId);
  revalidatePath(`/admin/applications/${input.applicationId}`);
  return { ok: true, missingFields: result.missingFields };
}

/**
 * Upload the blank template PDF for a program (until the Phase 4 mapper UI).
 * Admin-only, mirroring the templates table's admin_write RLS policy, and
 * scoped to the caller's organization.
 */
export async function uploadTemplateBlank(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  if (staff.role !== "admin") {
    throw new Error("Only admins can replace template PDFs");
  }
  const supabase = createAdminClient();

  const file = formData.get("file");
  const templateId = formData.get("templateId");
  if (!(file instanceof File) || typeof templateId !== "string") {
    throw new Error("Missing file or template");
  }
  if (file.type !== "application/pdf") throw new Error("Upload a PDF");

  const { data: template } = await supabase
    .from("templates")
    .select("id, storage_path, programs(org_id)")
    .eq("id", templateId)
    .single();
  if (!template?.storage_path) throw new Error("Template not found");
  const templateOrg = (template.programs as unknown as { org_id: string })?.org_id;
  if (templateOrg !== staff.orgId) throw new Error("Template not found");

  const { error } = await supabase.storage
    .from("templates")
    .upload(template.storage_path, Buffer.from(await file.arrayBuffer()), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  revalidatePath("/admin/applications");
}

/**
 * Send the application for signature: regenerate the PDF one final time
 * (agreement dates = send date), create the signer + signing token, email
 * the signing link, status → sent.
 */
export async function sendForSignature(input: {
  applicationId: string;
  signerName: string;
  signerEmail: string;
}): Promise<{ link: string }> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const signerName = input.signerName.trim();
  const signerEmail = input.signerEmail.trim();
  if (!signerName || !signerEmail) throw new Error("Signer name and email are required");

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, org_id, status, filled_pdf_path, programs(code, name), templates(field_map, signature_placements), worksheets(customers(business_name))"
    )
    .eq("id", input.applicationId)
    .eq("org_id", staff.orgId)
    .single();
  if (!application) throw new Error("Application not found");
  if (application.status !== "draft") throw new Error("Application already sent");

  const { filled } = await regenerateFilledPdf(input.applicationId);
  if (!filled) {
    throw new Error("Upload the blank template PDF before sending for signature");
  }

  // Never send a document that cannot end up carrying a signature.
  const programCode = (application.programs as unknown as { code: string })?.code;
  const map = programCode
    ? resolveTemplateMap(
        application.templates as unknown as {
          field_map: unknown;
          signature_placements: unknown;
        },
        programCode
      )
    : undefined;
  if (!map || !hasStampableCustomerSignature(map)) {
    throw new Error(
      "This template has no customer signature placement — add one in the template mapping before sending"
    );
  }

  const { token, hash } = generateToken();
  const { data: signer, error: signerError } = await supabase
    .from("signers")
    .insert({
      application_id: application.id,
      name: signerName,
      email: signerEmail,
      sign_order: 1,
      status: "sent",
      token_hash: hash,
      token_expires_at: tokenExpiry(SIGNING_TOKEN_TTL_DAYS).toISOString(),
    })
    .select("id")
    .single();
  if (signerError) throw new Error(`Could not create signer: ${signerError.message}`);

  const { error } = await supabase
    .from("applications")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", application.id);
  if (error) throw new Error(`Could not update status: ${error.message}`);

  const businessName =
    (application.worksheets as unknown as { customers: { business_name: string } | null })
      ?.customers?.business_name ?? "your business";
  const documentName =
    (application.programs as unknown as { name: string })?.name ?? "ATM application";

  const email = signingRequestEmail({
    signerName,
    businessName,
    documentName,
    link: signingUrl(token),
    expiresDays: SIGNING_TOKEN_TTL_DAYS,
  });
  await sendEmail({
    to: signerEmail,
    ...email,
    template: "signing_request",
    org_id: application.org_id,
    application_id: application.id,
  });

  await logAuditEvent({
    event_type: "sent",
    org_id: application.org_id,
    application_id: application.id,
    signer_id: signer.id,
    meta: { by: staff.fullName, signer_email: signerEmail },
  });

  revalidatePath(`/admin/applications/${application.id}`);
  return { link: signingUrl(token) };
}

/** Void an application and invalidate its signing tokens. */
export async function voidApplication(applicationId: string): Promise<void> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const { data: application } = await supabase
    .from("applications")
    .select("id, org_id, status")
    .eq("id", applicationId)
    .eq("org_id", staff.orgId)
    .single();
  if (!application) throw new Error("Application not found");
  if (application.status === "completed") {
    throw new Error("Completed applications cannot be voided");
  }

  await supabase
    .from("applications")
    .update({ status: "voided", voided_at: new Date().toISOString() })
    .eq("id", applicationId);
  // Expire all signer tokens immediately.
  await supabase
    .from("signers")
    .update({ token_expires_at: new Date().toISOString() })
    .eq("application_id", applicationId);

  await logAuditEvent({
    event_type: "voided",
    org_id: application.org_id,
    application_id: applicationId,
    meta: { by: staff.fullName },
  });

  revalidatePath(`/admin/applications/${applicationId}`);
  revalidatePath("/admin/applications");
}

/** Revise & resend: void the old application, clone a fresh draft from it. */
export async function reviseAndResend(
  applicationId: string
): Promise<{ applicationId: string }> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const { data: old } = await supabase
    .from("applications")
    .select("id, org_id, worksheet_id, program_id, template_id, data, status")
    .eq("id", applicationId)
    .eq("org_id", staff.orgId)
    .single();
  if (!old) throw new Error("Application not found");

  if (old.status !== "voided" && old.status !== "completed") {
    await voidApplication(applicationId);
  }

  const { data: fresh, error } = await supabase
    .from("applications")
    .insert({
      org_id: old.org_id,
      worksheet_id: old.worksheet_id,
      program_id: old.program_id,
      template_id: old.template_id,
      data: old.data,
      status: "draft",
      revises_application_id: old.id,
      created_by: staff.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create revision: ${error.message}`);

  await logAuditEvent({
    event_type: "created",
    org_id: old.org_id,
    application_id: fresh.id,
    meta: { action: "revision", revises: old.id, by: staff.fullName },
  });

  await regenerateFilledPdf(fresh.id);
  revalidatePath("/admin/applications");
  return { applicationId: fresh.id };
}
