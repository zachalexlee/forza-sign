/** Row shape of the field_definitions table (the canonical dictionary). */
export interface FieldDefinition {
  id: string;
  key: string;
  legacy_num: number | null;
  label: string;
  section: string;
  field_type:
    | "text"
    | "textarea"
    | "date"
    | "select"
    | "number"
    | "currency"
    | "phone"
    | "email"
    | "ein"
    | "ssn"
    | "zip"
    | "state"
    | "routing"
    | "account_number"
    | "boolean"
    | "file";
  required: boolean;
  ask_customer: boolean;
  sensitive: boolean;
  options: { value: string; label: string }[] | null;
  validation: Record<string, unknown> | null;
  help_text: string | null;
  sort_order: number;
}

/** Worksheet data blob: dictionary key → value. */
export type WorksheetData = Record<string, unknown>;

export const SECTION_ORDER = ["business", "owner", "contact", "install", "bank"] as const;

export const SECTION_LABELS: Record<string, string> = {
  business: "Business Information",
  owner: "Business Owner's Information",
  contact: "Store Contact Information",
  install: "ATM Installation Information",
  bank: "Bank Account Information",
  office: "Office-Set Fields",
};

/** Sentinel the server sends in place of a stored sensitive value. */
export interface MaskedValue {
  __masked: true;
  last4: string;
}

export function isMaskedValue(v: unknown): v is MaskedValue {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as MaskedValue).__masked === true &&
    typeof (v as MaskedValue).last4 === "string"
  );
}

/**
 * Conditional visibility (Appendix A/C): a field with
 * validation.visible_if = {"other.key": value} renders and validates only
 * when the current data matches.
 */
export function isFieldVisible(def: FieldDefinition, data: WorksheetData): boolean {
  const cond = def.validation?.visible_if as Record<string, unknown> | undefined;
  if (!cond) return true;
  return Object.entries(cond).every(([key, expected]) => data[key] === expected);
}
