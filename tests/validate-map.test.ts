import { describe, expect, it } from "vitest";
import {
  hasStampableCustomerSignature,
  resolveTemplateMap,
} from "@/lib/pdf/resolve-map";
import { validateMapEntries } from "@/lib/pdf/validate-map";

const keys = new Set(["business.dba", "owner.ssn", "bank.routing"]);

describe("validateMapEntries (mapper save validation)", () => {
  it("accepts and sanitizes a clean map", () => {
    const { errors, entries } = validateMapEntries(
      [
        { pdf: "DBA", source: "business.dba", junk: "stripped", note: "n" },
        { pdf: "Const", const: "Yes", checkbox: { equals: "Yes" } },
        { pdf: "Day", derived: "send_day" },
        { pdf: "SSN0", derived: "w9_tin_ssn", digitIndex: 0 },
        { pdf: "Phone", source: "bank.routing", transform: "phone_us" },
      ],
      keys
    );
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(5);
    expect("junk" in entries[0]).toBe(false);
  });

  it.each([
    [[{ pdf: "X", derived: "typo_rule" }], "unknown derived rule"],
    [[{ pdf: "X", source: "not.a.key" }], "unknown dictionary key"],
    [[{ pdf: "X", source: "business.dba", transform: "shout" }], "unknown transform"],
    [[{ pdf: "X", source: "business.dba", digitIndex: 1.5 }], "digitIndex"],
    [[{ pdf: "X", source: "business.dba", checkbox: "yes" }], "checkbox"],
    [[{ pdf: "X" }], "exactly one"],
    [[{ pdf: "X", source: "business.dba", const: "both" }], "exactly one"],
    [[{ pdf: "X", source: "business.dba" }, { pdf: "X", const: "dup" }], "more than once"],
    [["not-an-object"], "not an object"],
    ["garbage", "must be an array"],
  ])("rejects invalid input %#", (input, needle) => {
    const { errors, entries } = validateMapEntries(input, keys);
    expect(errors.join("\n")).toContain(needle);
    expect(entries).toEqual([]);
  });
});

describe("hasStampableCustomerSignature (execution guard)", () => {
  it("requires at least one customer signature with a named PDF field", () => {
    const base = { field_map: [{ pdf: "F", const: "x" }] };
    const noPlacements = resolveTemplateMap(
      { ...base, signature_placements: [] },
      "unknown-program"
    );
    // Unknown program + DB map → placements empty → not stampable.
    expect(noPlacements && hasStampableCustomerSignature(noPlacements)).toBe(false);

    const forzaOnly = resolveTemplateMap(
      {
        ...base,
        signature_placements: [{ kind: "signature", signer: "forza", page: 2, pdf: "S" }],
      },
      "unknown-program"
    );
    expect(forzaOnly && hasStampableCustomerSignature(forzaOnly)).toBe(false);

    const good = resolveTemplateMap(
      {
        ...base,
        signature_placements: [
          { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
        ],
      },
      "unknown-program"
    );
    expect(good && hasStampableCustomerSignature(good)).toBe(true);
  });

  it("Appendix B maps are stampable out of the box", () => {
    for (const code of ["mo-ml", "mo-cl", "pl-cl"]) {
      const map = resolveTemplateMap(null, code);
      expect(map && hasStampableCustomerSignature(map)).toBe(true);
    }
  });
});
