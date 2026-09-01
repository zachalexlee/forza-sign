/**
 * Dump a PDF's AcroForm fields with page number and widget position,
 * sorted top-to-bottom per page — the raw material for building a field map
 * against a real packet.
 *
 *   npx tsx scripts/dump-fields.ts <file.pdf>
 */
import { readFileSync } from "fs";
import { PDFDocument } from "pdf-lib";

async function main() {
  const [path] = process.argv.slice(2);
  const doc = await PDFDocument.load(new Uint8Array(readFileSync(path)));
  const pages = doc.getPages();

  const rows: { page: number; y: number; x: number; type: string; name: string }[] = [];
  for (const field of doc.getForm().getFields()) {
    const widgets = field.acroField.getWidgets();
    for (const w of widgets) {
      const rect = w.getRectangle();
      const ref = w.P();
      let pageIndex = pages.findIndex((p) => p.ref === ref);
      if (pageIndex === -1) pageIndex = 0;
      rows.push({
        page: pageIndex + 1,
        y: Math.round(rect.y),
        x: Math.round(rect.x),
        type: field.constructor.name.replace("PDF", ""),
        name: field.getName(),
      });
    }
  }

  rows.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  for (const r of rows) {
    console.log(
      `p${String(r.page).padStart(2)} y${String(r.y).padStart(4)} x${String(r.x).padStart(4)} ${r.type.padEnd(10)} ${r.name}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
