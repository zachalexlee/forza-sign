/**
 * Seed the in-repo Appendix B field maps into the templates table, so the
 * DB is the runtime source of truth after deploy (the mapper UI edits it).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run sync:maps
 *
 * Only fills templates whose field_map is still empty — never overwrites a
 * mapping the office has edited.
 */
import { createClient } from "@supabase/supabase-js";
import { templateMaps } from "../src/lib/pdf/maps";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  const { data: templates, error } = await supabase
    .from("templates")
    .select("id, field_map, programs(code)");
  if (error) throw new Error(error.message);

  for (const t of templates ?? []) {
    const code = (t.programs as unknown as { code: string })?.code;
    const map = templateMaps.find((m) => m.programs.includes(code));
    if (!map) {
      console.log(`skip ${code}: no in-repo map`);
      continue;
    }
    if (Array.isArray(t.field_map) && t.field_map.length > 0) {
      console.log(`skip ${code}: already mapped (${t.field_map.length} fields)`);
      continue;
    }
    const { error: updateError } = await supabase
      .from("templates")
      .update({
        field_map: map.fields,
        signature_placements: map.signaturePlacements,
      })
      .eq("id", t.id);
    if (updateError) throw new Error(`${code}: ${updateError.message}`);
    console.log(`synced ${code}: ${map.fields.length} fields`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
