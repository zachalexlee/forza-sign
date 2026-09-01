"use server";

import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit";
import { WorksheetData } from "@/lib/fields/types";
import { fillPdf } from "@/lib/pdf/fill";
import { templateMapForProgram } from "@/lib/pdf/maps";
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
 * Fill the template PDF from the application data. Returns missing PDF field
 * names (map entries the document doesn't have) so the UI can surface them.
 */
export async function regenerateFilledPdf(
  applicationId: string
): Promise<{ missingFields: string[]; filled: boolean }> {
  const supabase = createAdminClient();

  const { data: application } = await supabase
    .from("applications")
    .select("id, org_id, data, programs(code), templates(storage_path)")
    .eq("id", applicationId)
    .single();
  if (!application) throw new Error("Application not found");

  const programCode = (application.programs as unknown as { code: string })?.code;
  const storagePath = (application.templates as unknown as { storage_path: string | null })
    ?.storage_path;
  const map = programCode ? templateMapForProgram(programCode) : undefined;
  if (!map || !storagePath) return { missingFields: [], filled: false };

  const { data: blank } = await supabase.storage.from("templates").download(storagePath);
  if (!blank) return { missingFields: [], filled: false }; // blank PDF not uploaded yet

  const result = await fillPdf(await blank.arrayBuffer(), map, {
    data: application.data as WorksheetData,
    programCode,
    sendDate: new Date(),
  });

  const filledPath = `applications/${applicationId}/filled.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("filled")
    .upload(filledPath, Buffer.from(result.pdfBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) throw new Error(`Could not store filled PDF: ${uploadError.message}`);

  await supabase
    .from("applications")
    .update({ filled_pdf_path: filledPath })
    .eq("id", applicationId);

  return { missingFields: result.missingFields, filled: true };
}

/** Upload the blank template PDF for a program (until the Phase 4 mapper UI). */
export async function uploadTemplateBlank(formData: FormData): Promise<void> {
  await requireStaff();
  const supabase = createAdminClient();

  const file = formData.get("file");
  const templateId = formData.get("templateId");
  if (!(file instanceof File) || typeof templateId !== "string") {
    throw new Error("Missing file or template");
  }
  if (file.type !== "application/pdf") throw new Error("Upload a PDF");

  const { data: template } = await supabase
    .from("templates")
    .select("id, storage_path")
    .eq("id", templateId)
    .single();
  if (!template?.storage_path) throw new Error("Template not found");

  const { error } = await supabase.storage
    .from("templates")
    .upload(template.storage_path, Buffer.from(await file.arrayBuffer()), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  revalidatePath("/admin/applications");
}
