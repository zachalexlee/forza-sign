import { PDFDocument } from "pdf-lib";
import forge from "node-forge";
import { beforeAll, describe, expect, it } from "vitest";
import {
  digitalSigningConfigured,
  digitallySignIfConfigured,
} from "@/lib/pdf/digital-signature";

/** Self-signed P12 generated in-test — same shape as the production bundle. */
function makeTestP12(passphrase: string): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: "commonName", value: "Forza Sign Test Seal" },
    { name: "organizationName", value: "Forza Payments, Inc." },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: "3des",
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary").toString("base64");
}

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

describe("digital signature sealing", () => {
  beforeAll(() => {
    delete process.env.SIGNING_CERT_P12;
    delete process.env.SIGNING_CERT_PASSPHRASE;
  });

  it("passes bytes through untouched when no certificate is configured", async () => {
    const pdf = await blankPdf();
    expect(digitalSigningConfigured()).toBe(false);
    const out = await digitallySignIfConfigured(pdf, "test");
    expect(out).toBe(pdf);
  });

  it("embeds a PKCS#7 signature when a certificate is configured", async () => {
    process.env.SIGNING_CERT_P12 = makeTestP12("test-pass");
    process.env.SIGNING_CERT_PASSPHRASE = "test-pass";
    try {
      const pdf = await blankPdf();
      const signed = await digitallySignIfConfigured(pdf, "test seal");
      expect(signed).not.toBe(pdf);
      const text = Buffer.from(signed).toString("latin1");
      expect(text).toContain("/ByteRange");
      expect(text).toContain("/SubFilter /adbe.pkcs7.detached");
      // The signature contents must be non-empty hex, not the placeholder.
      const contents = text.match(/\/Contents\s*<([0-9a-fA-F]+)>/);
      expect(contents).toBeTruthy();
      expect(contents![1].replace(/0/g, "").length).toBeGreaterThan(0);
    } finally {
      delete process.env.SIGNING_CERT_P12;
      delete process.env.SIGNING_CERT_PASSPHRASE;
    }
  });
});
