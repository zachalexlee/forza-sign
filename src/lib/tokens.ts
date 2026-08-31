import { createHash, randomBytes } from "crypto";

/**
 * Customer-facing access tokens (worksheet links, signing links).
 *
 * The raw token appears only in the emailed URL. The database stores its
 * SHA-256 hash, so a database leak does not leak usable links. Lookup is
 * by exact hash match; no timing-sensitive comparison is required.
 */

export const WORKSHEET_TOKEN_TTL_DAYS = 30;
export const SIGNING_TOKEN_TTL_DAYS = 14;

export interface GeneratedToken {
  /** base64url token to embed in the link (256 bits of entropy) */
  token: string;
  /** SHA-256 hex digest to store in the database */
  hash: string;
}

export function generateToken(): GeneratedToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenExpiry(ttlDays: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

export function isExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
