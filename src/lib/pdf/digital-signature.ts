import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import signpdf from "@signpdf/signpdf";
import { PDFDocument } from "pdf-lib";

/**
 * Cryptographic (PKCS#7) signature on the executed PDF, so viewers like
 * Adobe verify integrity from the file itself — the counterpart to the
 * sha256 recorded in the audit trail, which verifies against our records.
 *
 * Optional at runtime: configured via
 *   SIGNING_CERT_P12        base64 of a PKCS#12 bundle (cert + private key)
 *   SIGNING_CERT_PASSPHRASE its passphrase
 * Without them the executed PDF is stored unchanged, exactly as before.
 */
export function digitalSigningConfigured(): boolean {
  return Boolean(process.env.SIGNING_CERT_P12 && process.env.SIGNING_CERT_PASSPHRASE);
}

export async function digitallySignIfConfigured(
  pdfBytes: Uint8Array,
  reason: string
): Promise<Uint8Array> {
  if (!digitalSigningConfigured()) return pdfBytes;

  const p12 = Buffer.from(process.env.SIGNING_CERT_P12!, "base64");
  const doc = await PDFDocument.load(pdfBytes);
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason,
    contactInfo: "sign@forzapayments.com",
    name: "Forza Payments, Inc.",
    location: "Lakewood, WA",
  });
  const withPlaceholder = await doc.save({ useObjectStreams: false });

  const signer = new P12Signer(p12, {
    passphrase: process.env.SIGNING_CERT_PASSPHRASE!,
  });
  const signed = await signpdf.sign(Buffer.from(withPlaceholder), signer);
  return new Uint8Array(signed);
}
