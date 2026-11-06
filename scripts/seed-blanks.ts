/**
 * Production post-build step: make sure every template row's blank PDF is
 * in the "templates" storage bucket, uploading it from templates/blanks/
 * when it is missing, then sync the in-repo field maps (sync-maps). Runs
 * only on Vercel production builds (VERCEL_ENV=production) or when
 * FORCE_SEED_BLANKS=1; CI and local builds skip it. Never fails the build.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... FORCE_SEED_BLANKS=1 npx tsx scripts/seed-blanks.ts
 */
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

async function main() {
  if (process.env.VERCEL_ENV !== "production" && process.env.FORCE_SEED_BLANKS !== "1") {
    console.log("seed-blanks: not a production build, skipping");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("seed-blanks: Supabase env not set, skipping");
    return;
  }
  const supabase = createClient(url, key);

  const { data: templates, error } = await supabase
    .from("templates")
    .select("id, storage_path, variant, programs(code)")
    .eq("active", true);
  if (error) throw new Error(error.message);

  for (const t of templates ?? []) {
    const code = (t.programs as unknown as { code: string } | null)?.code ?? "?";
    if (!t.storage_path) continue;
    const dir = t.storage_path.split("/").slice(0, -1).join("/");
    const name = t.storage_path.split("/").pop()!;
    const { data: files, error: listError } = await supabase.storage.from("templates").list(dir);
    if (listError) throw new Error(`${code}: ${listError.message}`);
    if ((files ?? []).some((f) => f.name === name)) {
      console.log(`seed-blanks: ${code}/${t.variant} already in storage (${t.storage_path})`);
      continue;
    }
    const local = path.resolve(process.cwd(), "templates/blanks", name);
    if (!existsSync(local)) {
      console.log(`seed-blanks: ${code}/${t.variant} missing in storage and no local blank at ${local}`);
      continue;
    }
    // Never overwrite a blank the office uploaded: upsert stays false.
    const { error: uploadError } = await supabase.storage
      .from("templates")
      .upload(t.storage_path, readFileSync(local), { contentType: "application/pdf", upsert: false });
    if (uploadError) throw new Error(`${code}: ${uploadError.message}`);
    console.log(`seed-blanks: uploaded ${t.storage_path} for ${code}/${t.variant}`);
  }
}

main()
  .then(() => {
    if (process.env.VERCEL_ENV !== "production" && process.env.FORCE_SEED_BLANKS !== "1") return;
    // Seed the in-repo field maps too (sync-maps exits non-zero on error,
    // which must not fail the build).
    const result = spawnSync("npx", ["tsx", "scripts/sync-maps.ts"], { stdio: "inherit" });
    if (result.status !== 0) console.error("seed-blanks: map sync failed (see above); continuing");
  })
  .catch((err) => {
    // A seeding problem must not take down the deploy; the admin UI can
    // still upload blanks by hand.
    console.error("seed-blanks: skipped after error:", err instanceof Error ? err.message : err);
  });
