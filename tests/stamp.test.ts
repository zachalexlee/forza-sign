import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { appendCertificatePage, sha256Hex, stampAndFlatten } from "@/lib/pdf/stamp";
import { TemplateMap } from "@/lib/pdf/types";

/** Minimal 1x1 transparent PNG. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const map: TemplateMap = {
  code: "test-v1",
  programs: ["mo-ml"],
  name: "Test Packet",
  pageCount: 2,
  fields: [],
  signaturePlacements: [
    { kind: "signature", signer: "customer", page: 1, pdf: "Owner Signature" },
    { kind: "signature", signer: "customer", page: 2, pdf: "By X" },
    { kind: "signature", signer: "customer", page: 2, note: "no field yet" },
    { kind: "signature", signer: "forza", page: 1, pdf: "Sales Associate" },
  ],
};

async function fixturePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  const p1 = doc.addPage([612, 792]);
  const p2 = doc.addPage([612, 792]);
  form.createTextField("Owner Signature").addToPage(p1, { x: 50, y: 100, width: 180, height: 24 });
  form.createTextField("By X").addToPage(p2, { x: 50, y: 200, width: 180, height: 24 });
  form.createTextField("Sales Associate").addToPage(p1, { x: 300, y: 100, width: 180, height: 24 });
  form.createTextField("Some Data").addToPage(p1, { x: 50, y: 300, width: 180, height: 18 });
  return doc.save();
}

describe("stampAndFlatten", () => {
  it("stamps customer signature placements and flattens the form", async () => {
    const result = await stampAndFlatten({
      filledPdf: await fixturePdf(),
      map,
      signaturePng: new Uint8Array(TINY_PNG),
      signerName: "Jordan Smith",
      signedAt: new Date("2026-09-01T12:00:00Z"),
    });

    expect(result.stampedPlacements).toBe(2); // Owner Signature + By X
    expect(result.skippedPlacements).toBe(1); // the placement with no field

    // Forza-signer rectangle captured for the later countersign pass.
    expect(result.forzaPlacements).toHaveLength(1);
    expect(result.forzaPlacements[0].pageIndex).toBe(0);
    expect(result.forzaPlacements[0].x).toBeCloseTo(300, -1);
    expect(result.forzaPlacements[0].y).toBeCloseTo(100, -1);

    // Flattened: no interactive fields remain (§7.4 integrity).
    const doc = await PDFDocument.load(result.pdfBytes);
    expect(doc.getForm().getFields()).toHaveLength(0);
    expect(doc.getPageCount()).toBe(2);
  });

  it("countersigns the flattened document at the captured rectangles", async () => {
    const { stampCountersignature } = await import("@/lib/pdf/stamp");
    const stamped = await stampAndFlatten({
      filledPdf: await fixturePdf(),
      map,
      signaturePng: new Uint8Array(TINY_PNG),
      signerName: "Jordan Smith",
      signedAt: new Date("2026-09-01T12:00:00Z"),
    });
    const countersigned = await stampCountersignature(
      stamped.pdfBytes,
      stamped.forzaPlacements,
      new Uint8Array(TINY_PNG),
      new Date("2026-09-02T12:00:00Z")
    );
    expect(countersigned.length).toBeGreaterThan(stamped.pdfBytes.length);
    const doc = await PDFDocument.load(countersigned);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getForm().getFields()).toHaveLength(0); // still flat
  });
});

describe("hash + certificate", () => {
  it("computes a stable sha256 and prints it on an appended certificate page", async () => {
    const stamped = await stampAndFlatten({
      filledPdf: await fixturePdf(),
      map,
      signaturePng: new Uint8Array(TINY_PNG),
      signerName: "Jordan Smith",
      signedAt: new Date("2026-09-01T12:00:00Z"),
    });
    const hash = sha256Hex(stamped.pdfBytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(stamped.pdfBytes)).toBe(hash); // deterministic

    const withCert = await appendCertificatePage(stamped.pdfBytes, {
      documentTitle: "Test Packet — Acme Mart",
      applicationId: "00000000-0000-0000-0000-000000000042",
      sha256: hash,
      signer: { name: "Jordan Smith", email: "jordan@acmemart.com" },
      events: [
        { event_type: "sent", ts: "2026-09-01T10:00:00Z", ip: "1.2.3.4" },
        { event_type: "consented", ts: "2026-09-01T11:00:00Z", ip: "1.2.3.4" },
        { event_type: "signed", ts: "2026-09-01T12:00:00Z", ip: "1.2.3.4" },
      ],
    });

    const doc = await PDFDocument.load(withCert);
    expect(doc.getPageCount()).toBe(3); // 2 pages + certificate
  });

  it("overflows long event lists onto extra certificate pages", async () => {
    const stamped = await stampAndFlatten({
      filledPdf: await fixturePdf(),
      map,
      signaturePng: new Uint8Array(TINY_PNG),
      signerName: "Jordan Smith",
      signedAt: new Date(),
    });
    const events = Array.from({ length: 120 }, (_, i) => ({
      event_type: "opened",
      ts: new Date(Date.now() + i * 1000).toISOString(),
    }));
    const withCert = await appendCertificatePage(stamped.pdfBytes, {
      documentTitle: "Test",
      applicationId: "x",
      sha256: sha256Hex(stamped.pdfBytes),
      signer: { name: "A", email: "a@b.c" },
      events,
    });
    const doc = await PDFDocument.load(withCert);
    expect(doc.getPageCount()).toBeGreaterThan(3);
  });
});
