import { beforeAll, describe, expect, it } from "vitest";
import { decryptField, encryptField, isEncrypted, lastFour } from "@/lib/crypto";

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("field encryption", () => {
  it("round-trips a value", () => {
    const ct = encryptField("123-45-6789");
    expect(ct).toMatch(/^enc:v1:/);
    expect(ct).not.toContain("6789");
    expect(decryptField(ct)).toBe("123-45-6789");
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    expect(encryptField("same")).not.toEqual(encryptField("same"));
  });

  it("rejects tampered ciphertext", () => {
    const ct = encryptField("secret");
    const parts = ct.split(":");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    expect(() => decryptField(parts.join(":"))).toThrow();
  });

  it("identifies encrypted values", () => {
    expect(isEncrypted(encryptField("x"))).toBe(true);
    expect(isEncrypted("plain")).toBe(false);
    expect(isEncrypted(42)).toBe(false);
  });

  it("extracts last four digits for masking", () => {
    expect(lastFour("123-45-6789")).toBe("6789");
    expect(lastFour("000123456")).toBe("3456");
  });
});
