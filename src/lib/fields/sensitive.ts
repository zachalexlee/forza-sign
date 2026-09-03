import { decryptField, encryptField, isEncrypted, lastFour } from "@/lib/crypto";
import { FieldDefinition, WorksheetData, isMaskedValue } from "./types";

/**
 * Sensitive dictionary fields (owner.ssn, bank.account_number) are encrypted
 * before they reach the JSONB and only ever leave the server masked.
 */

/** Incoming plaintext → ciphertext. Masked sentinels mean "keep stored value". */
export function encryptSensitiveValues(
  defs: FieldDefinition[],
  incoming: WorksheetData,
  existing: WorksheetData = {}
): WorksheetData {
  const out: WorksheetData = { ...incoming };
  for (const def of defs) {
    if (!def.sensitive) continue;
    const value = out[def.key];
    if (value === undefined) continue;
    if (isMaskedValue(value)) {
      // Client echoed the mask back — keep whatever is already stored.
      if (existing[def.key] !== undefined) out[def.key] = existing[def.key];
      else delete out[def.key];
      continue;
    }
    if (typeof value === "string" && value.length > 0 && !isEncrypted(value)) {
      out[def.key] = encryptField(value);
    }
  }
  return out;
}

/**
 * Plaintext view for validation: incoming values overlaid on the stored blob,
 * with stored ciphertext masked (= already provided). An incoming masked
 * sentinel is dropped from the overlay rather than trusted — it only counts
 * as provided when real ciphertext exists underneath, so a crafted mask for a
 * never-stored required field still fails validation.
 */
export function validationView(
  defs: FieldDefinition[],
  incoming: WorksheetData,
  existing: WorksheetData
): WorksheetData {
  const overlay: WorksheetData = { ...incoming };
  for (const def of defs) {
    if (def.sensitive && isMaskedValue(overlay[def.key])) delete overlay[def.key];
  }
  return { ...maskSensitiveValues(defs, existing), ...overlay };
}

/** Stored blob → safe-to-send blob (ciphertext replaced by masked sentinel). */
export function maskSensitiveValues(
  defs: FieldDefinition[],
  data: WorksheetData
): WorksheetData {
  const out: WorksheetData = { ...data };
  for (const def of defs) {
    if (!def.sensitive) continue;
    const value = out[def.key];
    if (typeof value === "string" && isEncrypted(value)) {
      out[def.key] = { __masked: true, last4: lastFour(decryptField(value)) };
    }
  }
  return out;
}
