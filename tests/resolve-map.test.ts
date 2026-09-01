import { describe, expect, it } from "vitest";
import { DERIVED_RULE_NAMES, resolveDerived } from "@/lib/pdf/derived";
import { resolveTemplateMap } from "@/lib/pdf/resolve-map";

describe("resolveTemplateMap (DB map vs Appendix B fallback)", () => {
  const dbMap = [
    { pdf: "Custom Field", source: "business.dba" },
    { pdf: "Custom Const", const: "Hello" },
  ];

  it("prefers a non-empty DB field_map", () => {
    const map = resolveTemplateMap(
      { field_map: dbMap, signature_placements: [] },
      "mo-ml"
    );
    expect(map?.fields).toHaveLength(2);
    expect(map?.fields[0].pdf).toBe("Custom Field");
    // Placements fall back to the in-repo map when the DB has none.
    expect(map?.signaturePlacements.length).toBeGreaterThan(0);
  });

  it("falls back to the in-repo map when the DB map is empty or missing", () => {
    for (const row of [
      undefined,
      null,
      { field_map: [], signature_placements: [] },
      { field_map: "garbage", signature_placements: null },
      { field_map: [{ nonsense: true }], signature_placements: [] },
    ]) {
      const map = resolveTemplateMap(row, "mo-cl");
      expect(map?.code).toBe("cl-v1");
      expect(map!.fields.length).toBeGreaterThan(50);
    }
  });

  it("returns undefined for unknown programs with no DB map", () => {
    expect(resolveTemplateMap(null, "nope")).toBeUndefined();
  });

  it("uses DB signature placements when present", () => {
    const map = resolveTemplateMap(
      {
        field_map: dbMap,
        signature_placements: [
          { kind: "signature", signer: "customer", page: 1, pdf: "Sig" },
        ],
      },
      "mo-ml"
    );
    expect(map?.signaturePlacements).toHaveLength(1);
  });
});

describe("DERIVED_RULE_NAMES", () => {
  it("every advertised rule actually resolves", () => {
    const ctx = {
      data: { "business.classification": "sole_prop" },
      programCode: "mo-cl",
      sendDate: new Date("2026-09-01"),
    };
    for (const rule of DERIVED_RULE_NAMES) {
      expect(() => resolveDerived(rule, ctx)).not.toThrow();
    }
  });
});
