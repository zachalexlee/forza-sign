import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * App-layer encryption for sensitive dictionary fields (owner.ssn,
 * bank.account_number). Values are encrypted before they reach the
 * worksheet/application JSONB and only decrypted server-side at PDF-fill
 * time. The UI shows the stored last-4 instead.
 *
 * Format: "enc:v1:<iv b64url>:<ciphertext b64url>:<tag b64url>"
 */

const PREFIX = "enc:v1:";

function key(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error("FIELD_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }
  return buf;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv, ct, tag].map((b) => b.toString("base64url")).join(":")
  );
}

export function decryptField(value: string): string {
  if (!isEncrypted(value)) throw new Error("value is not an encrypted field");
  const [ivB64, ctB64, tagB64] = value.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Last 4 characters for masked display, e.g. "•••• 1234". */
export function lastFour(plaintext: string): string {
  const digits = plaintext.replace(/\D/g, "");
  return digits.slice(-4);
}
