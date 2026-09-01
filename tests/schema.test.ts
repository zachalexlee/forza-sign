import { describe, expect, it } from "vitest";
import {
  customerWritableKeys,
  validateWorksheetData,
} from "@/lib/fields/schema";
import { FieldDefinition, isFieldVisible } from "@/lib/fields/types";

function def(overrides: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: "x",
    key: "test.key",
    legacy_num: null,
    label: "Test",
    section: "business",
    field_type: "text",
    required: false,
    ask_customer: true,
    sensitive: false,
    options: null,
    validation: null,
    help_text: null,
    sort_order: 0,
    ...overrides,
  };
}

describe("validateWorksheetData", () => {
  const defs: FieldDefinition[] = [
    def({ key: "business.legal_name", required: true }),
    def({ key: "owner.email", field_type: "email", required: true }),
    def({ key: "bank.routing", field_type: "routing", required: true }),
    def({
      key: "owner.equity_pct",
      field_type: "number",
      validation: { min: 0, max: 100 },
    }),
    def({
      key: "business.classification",
      field_type: "select",
      required: true,
      options: [
        { value: "llc_s", label: "LLC – S Corp" },
        { value: "sole_prop", label: "Sole Proprietor" },
      ],
    }),
    def({ key: "owner.ssn", field_type: "ssn", required: true, sensitive: true }),
    def({ key: "install.wireless_box", field_type: "boolean", required: true }),
    def({
      key: "install.shipping_address",
      required: true,
      validation: { visible_if: { "install.shipping_same_as_business": false } },
    }),
    def({ key: "office.only", ask_customer: false, required: true }),
  ];

  const validData = {
    "business.legal_name": "Acme LLC",
    "owner.email": "owner@acme.com",
    "bank.routing": "021000021",
    "business.classification": "llc_s",
    "owner.ssn": "123-45-6789",
    "install.wireless_box": false,
    "install.shipping_same_as_business": true,
  };

  it("passes a fully valid submission", () => {
    expect(validateWorksheetData(defs, validData)).toEqual([]);
  });

  it("reports missing required fields on full validation only", () => {
    const partial = validateWorksheetData(defs, {}, { partial: true });
    expect(partial).toEqual([]);
    const full = validateWorksheetData(defs, {});
    expect(full.map((i) => i.key)).toContain("business.legal_name");
    expect(full.map((i) => i.key)).toContain("owner.ssn");
  });

  it("never validates office-only fields for the customer", () => {
    const full = validateWorksheetData(defs, validData);
    expect(full.map((i) => i.key)).not.toContain("office.only");
  });

  it("validates formats on present values even in partial mode", () => {
    const issues = validateWorksheetData(
      defs,
      { "bank.routing": "021000022" },
      { partial: true }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe("bank.routing");
  });

  it("skips hidden conditional fields, requires them when visible", () => {
    expect(validateWorksheetData(defs, validData)).toEqual([]);
    const shippingVisible = {
      ...validData,
      "install.shipping_same_as_business": false,
    };
    const issues = validateWorksheetData(defs, shippingVisible);
    expect(issues.map((i) => i.key)).toContain("install.shipping_address");
  });

  it("accepts a masked sentinel for a stored sensitive value", () => {
    const withMask = {
      ...validData,
      "owner.ssn": { __masked: true, last4: "6789" },
    };
    expect(validateWorksheetData(defs, withMask)).toEqual([]);
  });

  it("rejects select values outside the options", () => {
    const issues = validateWorksheetData(defs, {
      ...validData,
      "business.classification": "nonsense",
    });
    expect(issues.map((i) => i.key)).toContain("business.classification");
  });

  it("enforces numeric ranges", () => {
    const issues = validateWorksheetData(
      defs,
      { "owner.equity_pct": 150 },
      { partial: true }
    );
    expect(issues.map((i) => i.key)).toContain("owner.equity_pct");
  });
});

describe("visibility + writability helpers", () => {
  it("customerWritableKeys excludes office fields", () => {
    const keys = customerWritableKeys([
      def({ key: "a" }),
      def({ key: "b", ask_customer: false }),
    ]);
    expect(keys.has("a")).toBe(true);
    expect(keys.has("b")).toBe(false);
  });

  it("isFieldVisible honors visible_if", () => {
    const d = def({ validation: { visible_if: { "x": false } } });
    expect(isFieldVisible(d, { x: false })).toBe(true);
    expect(isFieldVisible(d, { x: true })).toBe(false);
    expect(isFieldVisible(d, {})).toBe(false);
  });
});
