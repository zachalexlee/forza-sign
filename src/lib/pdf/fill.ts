import { PDFCheckBox, PDFDocument, PDFTextField, StandardFonts } from "pdf-lib";
import { decryptField, isEncrypted } from "@/lib/crypto";
import { resolveDerived } from "./derived";
import { FillContext, FillResult, MapEntry, TemplateMap, Transform } from "./types";

/**
 * The prefill engine (build plan §4): blank fillable PDF + field map +
 * reviewed data → filled PDF. Adding a program variant means adding a
 * template + map, never code.
 */

function applyTransform(value: string, transform: Transform | undefined): string {
  if (!value || !transform) return value;
  switch (transform) {
    case "date_us": {
      // ISO yyyy-mm-dd → mm/dd/yyyy
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? `${m[2]}/${m[3]}/${m[1]}` : value;
    }
    case "phone_us": {
      const d = value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : value;
    }
    case "currency": {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : value;
    }
    case "upper":
      return value.toUpperCase();
  }
}

/** Resolve one map entry to the value that lands in the PDF. */
export function resolveEntry(
  entry: MapEntry,
  ctx: FillContext
): string | boolean | undefined {
  let raw: unknown;
  if (entry.const !== undefined) {
    raw = entry.const;
  } else if (entry.derived !== undefined) {
    raw = resolveDerived(entry.derived, ctx);
  } else if (entry.source !== undefined) {
    raw = ctx.data[entry.source];
    if (typeof raw === "string" && isEncrypted(raw)) raw = decryptField(raw);
  } else {
    return undefined;
  }

  if (entry.checkbox) {
    if ("equals" in entry.checkbox && entry.checkbox.equals !== undefined) {
      return raw === entry.checkbox.equals;
    }
    return raw === true;
  }

  if (raw === undefined || raw === null || raw === false) return undefined;
  let value = typeof raw === "boolean" ? (raw ? "Yes" : "No") : String(raw);
  value = applyTransform(value, entry.transform);

  if (entry.digitIndex !== undefined) {
    return value[entry.digitIndex] ?? "";
  }
  return value;
}

export async function fillPdf(
  blankPdf: Uint8Array | ArrayBuffer,
  map: TemplateMap,
  ctx: FillContext
): Promise<FillResult> {
  const doc = await PDFDocument.load(blankPdf);
  const form = doc.getForm();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const missingFields: string[] = [];
  const applied: Record<string, string | boolean> = {};

  for (const entry of map.fields) {
    const value = resolveEntry(entry, ctx);
    if (value === undefined || value === "") continue;

    // Coordinate entries draw text directly — for blanks without a form field.
    if (entry.coord) {
      if (value === false) continue; // unchecked checkbox-style entry: draw nothing
      const pageIndex = entry.coord.page - 1;
      if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
        missingFields.push(entry.pdf);
        continue;
      }
      const text = value === true ? "X" : String(value);
      doc.getPage(pageIndex).drawText(text, {
        x: entry.coord.x,
        y: entry.coord.y,
        size: entry.coord.size ?? 10,
        font: helv,
      });
      applied[entry.pdf] = text;
      continue;
    }

    let field;
    try {
      field = form.getField(entry.pdf);
    } catch {
      missingFields.push(entry.pdf);
      continue;
    }

    if (field instanceof PDFCheckBox) {
      if (value === true) {
        field.check();
        applied[entry.pdf] = true;
      }
    } else if (field instanceof PDFTextField) {
      const text = value === true ? "Yes" : String(value);
      field.setText(text);
      applied[entry.pdf] = text;
    } else {
      // Radio groups / dropdowns: select by option value when present.
      try {
        (field as unknown as { select: (v: string) => void }).select(String(value));
        applied[entry.pdf] = String(value);
      } catch {
        missingFields.push(entry.pdf);
      }
    }
  }

  const pdfBytes = await doc.save();
  return { pdfBytes, missingFields, applied };
}

/** List a PDF's AcroForm fields (name + type) — used by the inspector. */
export async function inspectPdfFields(
  pdf: Uint8Array | ArrayBuffer
): Promise<{ name: string; type: string }[]> {
  const doc = await PDFDocument.load(pdf);
  return doc
    .getForm()
    .getFields()
    .map((f) => ({ name: f.getName(), type: f.constructor.name }));
}
