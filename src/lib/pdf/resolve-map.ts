import { templateMapForProgram } from "./maps";
import { MapEntry, TemplateMap } from "./types";

/**
 * Where a template's field map comes from (build plan §4):
 * - templates.field_map JSONB, once the office has mapped the PDF in the
 *   admin mapper UI (or a sync script seeded it) — takes precedence;
 * - otherwise the in-repo Appendix B map for the program.
 *
 * Signature placements follow the same rule.
 */

export interface TemplateRowMaps {
  field_map: unknown;
  signature_placements: unknown;
}

function isMapEntryArray(v: unknown): v is MapEntry[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as MapEntry).pdf === "string" &&
        ((e as MapEntry).source !== undefined ||
          (e as MapEntry).const !== undefined ||
          (e as MapEntry).derived !== undefined)
    )
  );
}

/**
 * A document can only be legitimately executed if at least one customer
 * signature placement names a PDF field to stamp — otherwise stampAndFlatten
 * would flatten with zero signatures while the flow still "completes".
 */
export function hasStampableCustomerSignature(map: TemplateMap): boolean {
  return map.signaturePlacements.some(
    (p) =>
      p.signer === "customer" &&
      p.kind === "signature" &&
      (!!p.pdf || (p.x !== undefined && p.y !== undefined))
  );
}

export function resolveTemplateMap(
  row: TemplateRowMaps | null | undefined,
  programCode: string
): TemplateMap | undefined {
  const fallback = templateMapForProgram(programCode);
  if (!row) return fallback;

  const dbFields = isMapEntryArray(row.field_map) ? row.field_map : undefined;
  if (!dbFields) return fallback;

  const dbPlacements = Array.isArray(row.signature_placements)
    ? (row.signature_placements as TemplateMap["signaturePlacements"])
    : [];

  return {
    code: fallback?.code ?? `db-${programCode}`,
    programs: [programCode],
    name: fallback?.name ?? programCode,
    pageCount: fallback?.pageCount ?? 0,
    fields: dbFields,
    signaturePlacements:
      dbPlacements.length > 0 ? dbPlacements : fallback?.signaturePlacements ?? [],
  };
}
