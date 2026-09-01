import { WorksheetData } from "@/lib/fields/types";
import { fillPdf } from "@/lib/pdf/fill";
import { resolveTemplateMap } from "@/lib/pdf/resolve-map";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fill the template PDF from the application data. Internal server helper —
 * NOT a server action; callers (server actions) are responsible for
 * authenticating the staff user first. Returns missing PDF field names so
 * the UI can surface map gaps.
 */
export async function regenerateFilledPdf(
  applicationId: string
): Promise<{ missingFields: string[]; filled: boolean }> {
  const supabase = createAdminClient();

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, org_id, data, programs(code), templates(storage_path, field_map, signature_placements)"
    )
    .eq("id", applicationId)
    .single();
  if (!application) throw new Error("Application not found");

  const programCode = (application.programs as unknown as { code: string })?.code;
  const template = application.templates as unknown as {
    storage_path: string | null;
    field_map: unknown;
    signature_placements: unknown;
  } | null;
  const storagePath = template?.storage_path;
  const map = programCode ? resolveTemplateMap(template, programCode) : undefined;
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
