"use server";

import { revalidatePath } from "next/cache";
import { regenerateFilledPdf } from "@/lib/applications";
import { logAuditEvent } from "@/lib/audit";
import { WorksheetData } from "@/lib/fields/types";
import { requireStaff } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

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
