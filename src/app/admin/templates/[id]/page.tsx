import { notFound } from "next/navigation";
import { FieldDefinition } from "@/lib/fields/types";
import { DERIVED_RULE_NAMES } from "@/lib/pdf/derived";
import { inspectPdfFields } from "@/lib/pdf/fill";
import { templateMapForProgram } from "@/lib/pdf/maps";
import { MapEntry } from "@/lib/pdf/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { MapperEditor } from "./mapper";

export const dynamic = "force-dynamic";

export default async function TemplateMapperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: template } = await supabase
    .from("templates")
    .select("id, version, storage_path, field_map, programs(code, name)")
    .eq("id", id)
    .maybeSingle();
  if (!template) notFound();

  const program = template.programs as unknown as { code: string; name: string };

  const { data: defs } = await supabase
    .from("field_definitions")
    .select("key, label, section")
    .order("section")
    .order("sort_order");

  // Inspect the uploaded blank's AcroForm fields (if present).
  let pdfFields: { name: string; type: string }[] | null = null;
  if (template.storage_path) {
    const admin = createAdminClient();
    const { data: blank } = await admin.storage
      .from("templates")
      .download(template.storage_path);
    if (blank) {
      pdfFields = await inspectPdfFields(await blank.arrayBuffer());
    }
  }

  const suggested = program?.code ? templateMapForProgram(program.code) : undefined;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{program?.name} — field mapping</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Template v{template.version}. Assign each PDF form field a dictionary
          key, a constant, or a derived rule. Saved mappings take precedence
          over the built-in Appendix B map.
        </p>
      </div>
      <MapperEditor
        templateId={template.id}
        pdfFields={pdfFields}
        dictionary={(defs ?? []) as Pick<FieldDefinition, "key" | "label" | "section">[]}
        derivedRules={[...DERIVED_RULE_NAMES]}
        currentMap={(Array.isArray(template.field_map) ? template.field_map : []) as MapEntry[]}
        suggestedMap={suggested?.fields ?? []}
      />
    </div>
  );
}
