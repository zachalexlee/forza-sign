import { describe, expect, it } from "vitest";
import { generateToken, hashToken, isExpired, tokenExpiry } from "@/lib/tokens";

describe("tokens", () => {
  it("generates unique 256-bit base64url tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toEqual(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("stores only a sha256 hash that matches the raw token", () => {
    const { token, hash } = generateToken();
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toEqual(hash);
  });

  it("computes expiries and detects expiration", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const exp = tokenExpiry(30, from);
    expect(exp.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(isExpired(exp, new Date("2026-01-30T23:59:59Z"))).toBe(false);
    expect(isExpired(exp, new Date("2026-01-31T00:00:00Z"))).toBe(true);
  });
});
