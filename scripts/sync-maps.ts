/**
 * Seed / update the in-repo field maps in the templates table, so the DB is
 * the runtime source of truth after deploy (the mapper UI edits it).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run sync:maps
 *
 * Update policy (templates.map_source / map_version):
 * - empty map, or map_source 'repo' (or legacy NULL) with map_version older
 *   than MAP_VERSION → overwritten with the current in-repo map
 * - map_source 'custom' (edited in the mapper UI) → never touched
 */
import { createClient } from "@supabase/supabase-js";
import { MAP_VERSION, templateMaps } from "../src/lib/pdf/maps";

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
    .select("id, field_map, map_source, map_version, programs(code)");
  if (error) throw new Error(error.message);

  for (const t of templates ?? []) {
    const code = (t.programs as unknown as { code: string })?.code;
    const map = templateMaps.find((m) => m.programs.includes(code));
    if (!map) {
      console.log(`skip ${code}: no in-repo map`);
      continue;
    }

    const hasMap = Array.isArray(t.field_map) && t.field_map.length > 0;
    if (hasMap && t.map_source === "custom") {
      console.log(`skip ${code}: custom mapping (edited in the mapper UI)`);
      continue;
    }
    if (hasMap && (t.map_version ?? 0) >= MAP_VERSION) {
      console.log(`skip ${code}: already at map version ${MAP_VERSION}`);
      continue;
    }

    const { error: updateError } = await supabase
      .from("templates")
      .update({
        field_map: map.fields,
        signature_placements: map.signaturePlacements,
        map_source: "repo",
        map_version: MAP_VERSION,
      })
      .eq("id", t.id);
    if (updateError) throw new Error(`${code}: ${updateError.message}`);
    console.log(
      `synced ${code}: ${map.fields.length} fields (v${t.map_version ?? 0} → v${MAP_VERSION})`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
