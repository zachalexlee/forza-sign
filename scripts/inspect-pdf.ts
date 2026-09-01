/**
 * Verify template maps against a real PDF's AcroForm fields.
 *
 *   npm run inspect:pdf -- path/to/blank-app.pdf [template-code]
 *
 * Lists every field in the PDF, then reports which mapped names are missing
 * from the document and which document fields are unmapped. Run this as soon
 * as the real packet PDFs land in the repo (Linear FOR-13 / FOR-17).
 */
import { readFileSync } from "fs";
import { inspectPdfFields } from "../src/lib/pdf/fill";
import { templateMaps } from "../src/lib/pdf/maps";

async function main() {
  const [path, code] = process.argv.slice(2);
  if (!path) {
    console.error("Usage: npm run inspect:pdf -- <file.pdf> [template-code]");
    process.exit(1);
  }

  const bytes = readFileSync(path);
  const fields = await inspectPdfFields(new Uint8Array(bytes));
  console.log(`\n${path}: ${fields.length} AcroForm fields\n`);
  for (const f of fields) {
    console.log(`  ${f.type.padEnd(16)} ${f.name}`);
  }

  const maps = code ? templateMaps.filter((m) => m.code === code) : templateMaps;
  const names = new Set(fields.map((f) => f.name));
  for (const map of maps) {
    // coord entries draw text at coordinates — they never match a form field.
    const mapped = new Set(map.fields.filter((e) => !e.coord).map((e) => e.pdf));
    const missing = [...mapped].filter((n) => !names.has(n));
    const unmapped = [...names].filter((n) => !mapped.has(n));
    console.log(`\n=== ${map.code} (${map.name}) ===`);
    console.log(`mapped: ${mapped.size}, missing from PDF: ${missing.length}, in PDF but unmapped: ${unmapped.length}`);
    if (missing.length) {
      console.log("\nMapped names NOT found in the PDF (fix these in src/lib/pdf/maps):");
      missing.forEach((n) => console.log(`  ✗ ${n}`));
    }
    if (unmapped.length) {
      console.log("\nPDF fields with no mapping (decide: map or ignore):");
      unmapped.forEach((n) => console.log(`  ? ${n}`));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
