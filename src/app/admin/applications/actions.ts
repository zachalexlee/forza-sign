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
import { digitallySignIfConfigured } from "@/lib/pdf/digital-signature";
import { PlacementRect, appendCertificatePage, sha256Hex, stampCountersignature } from "@/lib/pdf/stamp";
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

/**
 * Forza countersignature: stamp the office signature over the Forza-signer
 * lines of a completed application, rebuild the certificate page with the
 * new content hash and the countersign event, re-seal, and replace the
 * executed copy. Works from the stored pre-certificate working copy — a
 * certificated or PKCS#7-sealed file cannot be edited in place.
 */
export async function countersignApplication(input: {
  applicationId: string;
  signaturePngDataUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const pngMatch = input.signaturePngDataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!pngMatch) return { ok: false, error: "Signature must be a PNG" };
  const signaturePng = new Uint8Array(Buffer.from(pngMatch[1], "base64"));

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, org_id, status, working_pdf_path, forza_placements, countersigned_at, programs(name), worksheets(customers(business_name)), signers(name, email, sign_order)"
    )
    .eq("id", input.applicationId)
    .single();
  if (!application || application.org_id !== staff.orgId) {
    return { ok: false, error: "Application not found" };
  }
  if (application.status !== "completed") {
    return { ok: false, error: "Only completed applications can be countersigned" };
  }
  const placements = (application.forza_placements ?? []) as PlacementRect[];
  if (!application.working_pdf_path || placements.length === 0) {
    return {
      ok: false,
      error:
        "This application predates countersign support — no Forza signature positions were captured when it was signed.",
    };
  }

  if (application.countersigned_at) {
    return { ok: false, error: "Already countersigned" };
  }

  // Claim the countersignature slot atomically: two concurrent staff
  // sessions must not both stamp and race to overwrite the executed copy.
  // The claim is a separate, EXPIRING lock — the real countersigned_at is
  // written only after the replacement document is stored, so a crash
  // mid-attempt never leaves the application permanently "countersigned"
  // with an unchanged PDF: the stale claim ages out and a retry proceeds.
  const signedAt = new Date();
  const claimTs = signedAt.toISOString();
  const staleCutoff = new Date(signedAt.getTime() - 10 * 60 * 1000).toISOString();
  const { data: claimed } = await supabase
    .from("applications")
    .update({ countersign_claimed_at: claimTs, countersigned_by: staff.userId })
    .eq("id", application.id)
    .is("countersigned_at", null)
    .or(`countersign_claimed_at.is.null,countersign_claimed_at.lt.${staleCutoff}`)
    .select("id");
  if (!claimed || claimed.length === 0) {
    return {
      ok: false,
      error: "Already countersigned, or a countersign attempt is in progress",
    };
  }
  const releaseClaim = () =>
    supabase
      .from("applications")
      .update({ countersign_claimed_at: null, countersigned_by: null })
      .eq("id", application.id)
      .eq("countersign_claimed_at", claimTs);

  try {
    const { data: working } = await supabase.storage
      .from("final")
      .download(application.working_pdf_path);
    if (!working) {
      await releaseClaim();
      return { ok: false, error: "Stored document not found" };
    }

    const countersigned = await stampCountersignature(
      await working.arrayBuffer(),
      placements,
      signaturePng,
      signedAt
    );
    const sha256 = sha256Hex(new Uint8Array(countersigned));

    // Certificate rebuilt from scratch: new hash + full history including
    // the countersign event (inserted into the audit table after the
    // uploads succeed, with this same timestamp). Newest 500 — capping an
    // ascending fetch would drop the completion tail, not old noise. A
    // failed read must abort: silently rebuilding from an empty list would
    // strip the certified history from the stored legal copy.
    const { data: eventsDesc, error: eventsError } = await supabase
      .from("audit_events")
      .select("event_type, ts, ip, meta")
      .eq("application_id", application.id)
      .order("ts", { ascending: false })
      .limit(500);
    if (eventsError) {
      await releaseClaim();
      return {
        ok: false,
        error: "Could not load the audit history — nothing was changed; try again.",
      };
    }
    const events = (eventsDesc ?? []).reverse();
    const countersignEvent = {
      event_type: "signed",
      ts: signedAt.toISOString(),
      ip: null,
      detail: `countersigned by ${staff.fullName}`,
    };
    const programName = (application.programs as unknown as { name: string } | null)?.name;
    const businessName =
      (application.worksheets as unknown as { customers: { business_name: string } | null } | null)
        ?.customers?.business_name ?? "the business";
    const signerRows = (application.signers ?? []) as { name: string; email: string; sign_order: number }[];
    const primarySigner = [...signerRows].sort((a, b) => a.sign_order - b.sign_order)[0];

    const certified = await appendCertificatePage(new Uint8Array(countersigned), {
      documentTitle: `${programName ?? "ATM Application"} — ${businessName}`,
      applicationId: application.id,
      sha256,
      signer: primarySigner ?? { name: "—", email: "—" },
      events: [
        ...events.map((e) => ({
          event_type: e.event_type as string,
          ts: e.ts as string,
          ip: e.ip as string | null,
          detail: (e.meta as { action?: string })?.action,
        })),
        countersignEvent,
      ],
    });

    let sealed: Uint8Array = certified;
    try {
      sealed = await digitallySignIfConfigured(
        certified,
        `Countersigned by ${staff.fullName} for Forza Payments`
      );
    } catch (err) {
      console.error("PKCS#7 sealing failed on countersign — storing unsealed", err);
    }

    // Attempt-specific object: an attempt whose lease expired must not be
    // able to overwrite the live executed copy after another session has
    // finalized — the path only becomes live through the conditional
    // finalize below, so an expired attempt just leaves an orphan.
    const finalPath = `applications/${application.id}/executed-${signedAt.getTime()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("final")
      .upload(finalPath, Buffer.from(sealed), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) {
      await releaseClaim();
      return { ok: false, error: `Store failed: ${uploadError.message}` };
    }

    // Finalize atomically in one database transaction (countersign_finalize,
    // migration 00008): the claim-conditional metadata update and the audit
    // event insert commit together or not at all — an attempt that lost its
    // lease can neither finalize nor leave a stray countersign event in the
    // immutable trail. Checked and retried once (Supabase returns errors
    // rather than throwing); false means the lease expired mid-attempt and
    // another session took over, with nothing recorded by this one.
    const finalize = () =>
      supabase.rpc("countersign_finalize", {
        p_application_id: application.id,
        p_claim_ts: claimTs,
        p_final_path: finalPath,
        p_sha256: sha256,
        p_org_id: application.org_id,
        p_meta: {
          action: "countersigned",
          by: staff.fullName,
          sha256_countersigned: sha256,
        },
      });
    let { data: finalized, error: metaError } = await finalize();
    if (metaError) {
      ({ data: finalized, error: metaError } = await finalize());
    }
    if (metaError) {
      console.error("Countersign finalization failed", metaError);
      await releaseClaim();
      return {
        ok: false,
        error:
          "Recording the countersignature failed — nothing was finalized; try again.",
      };
    }
    if (!finalized) {
      return {
        ok: false,
        error: "This countersign attempt expired and another session took over.",
      };
    }

    // Advance the working copy so any future rebuild starts from the
    // countersigned content. Only after finalizing — a failed attempt must
    // leave the pre-countersign copy in place for a clean re-stamp.
    const { error: advanceError } = await supabase.storage
      .from("final")
      .upload(application.working_pdf_path, Buffer.from(countersigned), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (advanceError) {
      console.error("Working-copy advance failed after countersign", advanceError);
    }

    revalidatePath(`/admin/applications/${application.id}`);
    return { ok: true };
  } catch (err) {
    await releaseClaim();
    throw err;
  }
}
