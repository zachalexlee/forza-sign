import { createHash } from "crypto";
import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { TemplateMap } from "./types";

/**
 * Signing-time PDF operations (build plan §6.3/§7):
 * stamp signature images over the customer signature fields, stamp dates,
 * flatten so nothing is editable, hash, and append the audit certificate.
 */

export interface StampInput {
  filledPdf: Uint8Array | ArrayBuffer;
  map: TemplateMap;
  /** PNG bytes of the adopted signature */
  signaturePng: Uint8Array;
  signerName: string;
  signedAt: Date;
}

export interface StampResult {
  pdfBytes: Uint8Array;
  /** Placements that could not be stamped (no named field in the PDF) */
  skippedPlacements: number;
  stampedPlacements: number;
}

/**
 * Stamp the adopted signature over every customer signature placement that
 * names an AcroForm field (the widget rectangle gives the position), then
 * flatten the whole form. Placements without a field name are skipped and
 * counted — they need coordinates once the real PDFs are inspected.
 */
export async function stampAndFlatten(input: StampInput): Promise<StampResult> {
  const doc = await PDFDocument.load(input.filledPdf);
  const form = doc.getForm();
  const png = await doc.embedPng(input.signaturePng);
  const helv = await doc.embedFont(StandardFonts.Helvetica);

  let skipped = 0;

  // Pass 1: capture widget rectangles + host pages while the form still
  // exists. Drawing must wait until after flatten(), which appends field
  // appearance streams to the page content — anything drawn earlier can be
  // covered by an opaque field background.
  const targets: { pageIndex: number; rect: { x: number; y: number; width: number; height: number } }[] = [];
  for (const placement of input.map.signaturePlacements) {
    if (placement.signer !== "customer" || placement.kind !== "signature") continue;
    if (!placement.pdf) {
      skipped += 1;
      continue;
    }
    try {
      const field = form.getField(placement.pdf);
      const widget = field.acroField.getWidgets()[0];
      const rect = widget.getRectangle();
      const ref = widget.P();
      let pageIndex = doc.getPages().findIndex((p) => p.ref === ref);
      if (pageIndex === -1 && placement.page) pageIndex = placement.page - 1;
      if (pageIndex < 0 || pageIndex >= doc.getPageCount()) {
        skipped += 1;
        continue;
      }
      targets.push({ pageIndex, rect });
    } catch {
      skipped += 1;
    }
  }

  // Pass 2: flatten — form fields become static page content (§7.4).
  form.flatten();

  // Pass 3: draw signatures + dates on top of the flattened content.
  for (const { pageIndex, rect } of targets) {
    const page = doc.getPage(pageIndex);
    const height = Math.max(rect.height, 18);
    const scale = height / png.height;
    const width = Math.min(png.width * scale, rect.width || 160);
    page.drawImage(png, { x: rect.x, y: rect.y, width, height });
    page.drawText(input.signedAt.toLocaleDateString("en-US"), {
      x: rect.x + width + 8,
      y: rect.y + 2,
      size: 8,
      font: helv,
      color: rgb(0.2, 0.2, 0.2),
    });
  }

  return {
    pdfBytes: await doc.save(),
    stampedPlacements: targets.length,
    skippedPlacements: skipped,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface CertificateInfo {
  documentTitle: string;
  applicationId: string;
  sha256: string;
  signer: { name: string; email: string };
  events: { event_type: string; ts: string; ip?: string | null; detail?: string }[];
}

/** Append the audit-trail certificate page to an executed PDF (§7.3). */
export async function appendCertificatePage(
  pdfBytes: Uint8Array,
  info: CertificateInfo
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);

  const drawLine = (
    p: PDFPage,
    text: string,
    y: number,
    opts: { bold?: boolean; size?: number; x?: number } = {}
  ) => {
    p.drawText(text, {
      x: opts.x ?? 48,
      y,
      size: opts.size ?? 9,
      font: opts.bold ? helvBold : helv,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: 516,
    });
  };

  let y = 744;
  drawLine(page, "Signature Certificate", y, { bold: true, size: 16 });
  y -= 18;
  drawLine(page, "Forza Sign — Forza Payments, Inc.", y, { size: 9 });
  y -= 24;
  drawLine(page, `Document: ${info.documentTitle}`, y);
  y -= 14;
  drawLine(page, `Reference: ${info.applicationId}`, y);
  y -= 14;
  drawLine(page, `SHA-256 (executed document, excluding this certificate):`, y);
  y -= 12;
  drawLine(page, info.sha256, y, { size: 8 });
  y -= 20;
  drawLine(page, `Signer: ${info.signer.name} <${info.signer.email}>`, y);
  y -= 24;
  drawLine(page, "Event history", y, { bold: true, size: 11 });
  y -= 16;

  let currentPage = page;
  for (const e of info.events) {
    if (y < 60) {
      currentPage = doc.addPage([612, 792]);
      y = 744;
    }
    const when = new Date(e.ts).toISOString();
    const parts = [when, e.event_type, e.ip ? `IP ${e.ip}` : null, e.detail]
      .filter(Boolean)
      .join("  ·  ");
    drawLine(currentPage, parts, y, { size: 8 });
    y -= 12;
  }

  y -= 12;
  if (y < 60) {
    currentPage = doc.addPage([612, 792]);
    y = 744;
  }
  drawLine(
    currentPage,
    "This document was executed electronically via Forza Sign. The signer consented to conduct business",
    y,
    { size: 7 }
  );
  y -= 10;
  drawLine(
    currentPage,
    "electronically (ESIGN/UETA). The hash above can be used to verify document integrity.",
    y,
    { size: 7 }
  );

  return doc.save();
}
