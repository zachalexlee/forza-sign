import { beforeAll, describe, expect, it } from "vitest";
import { isEncrypted } from "@/lib/crypto";
import {
  encryptSensitiveValues,
  maskSensitiveValues,
} from "@/lib/fields/sensitive";
import { FieldDefinition, isMaskedValue } from "@/lib/fields/types";

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
});

const defs = [
  { key: "owner.ssn", sensitive: true },
  { key: "bank.account_number", sensitive: true },
  { key: "business.legal_name", sensitive: false },
] as FieldDefinition[];

describe("sensitive value round trip", () => {
  it("encrypts sensitive plaintext, leaves other fields alone", () => {
    const out = encryptSensitiveValues(defs, {
      "owner.ssn": "123-45-6789",
      "business.legal_name": "Acme LLC",
    });
    expect(isEncrypted(out["owner.ssn"])).toBe(true);
    expect(out["business.legal_name"]).toBe("Acme LLC");
  });

  it("masks ciphertext for the client with last4", () => {
    const stored = encryptSensitiveValues(defs, { "owner.ssn": "123-45-6789" });
    const masked = maskSensitiveValues(defs, stored);
    expect(isMaskedValue(masked["owner.ssn"])).toBe(true);
    expect((masked["owner.ssn"] as { last4: string }).last4).toBe("6789");
  });

  it("an echoed mask keeps the stored ciphertext", () => {
    const stored = encryptSensitiveValues(defs, { "owner.ssn": "123-45-6789" });
    const echoed = encryptSensitiveValues(
      defs,
      { "owner.ssn": { __masked: true, last4: "6789" } },
      stored
    );
    expect(echoed["owner.ssn"]).toBe(stored["owner.ssn"]);
  });

  it("a mask echoed with nothing stored drops the key", () => {
    const out = encryptSensitiveValues(defs, {
      "owner.ssn": { __masked: true, last4: "0000" },
    });
    expect("owner.ssn" in out).toBe(false);
  });

  it("does not double-encrypt already-encrypted values", () => {
    const once = encryptSensitiveValues(defs, { "owner.ssn": "123-45-6789" });
    const twice = encryptSensitiveValues(defs, once);
    expect(twice["owner.ssn"]).toBe(once["owner.ssn"]);
  });
});
