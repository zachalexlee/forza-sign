import { WorksheetData } from "@/lib/fields/types";

/**
 * Template field map (build plan §4): how one application variant's PDF form
 * fields are populated from the canonical dictionary. Stored as JSONB on the
 * templates table; authored in src/lib/pdf/maps/ until the Phase 4 mapper UI.
 */

export type Transform = "date_us" | "phone_us" | "currency" | "upper";

export interface MapEntry {
  /** AcroForm field name in the PDF */
  pdf: string;
  /** Dictionary key to pull the value from */
  source?: string;
  /** Constant value (e.g. "Forza Cash Loader") */
  const?: string;
  /** Named derived rule (Appendix C) resolved against the fill context */
  derived?: string;
  /** Post-resolution formatting */
  transform?: Transform;
  /**
   * Checkbox: check when the resolved value (source/derived) equals `equals`,
   * or is truthy when `equals` is omitted.
   */
  checkbox?: { equals?: unknown };
  /**
   * Per-digit boxes (IRS W-9 TIN): take character `digitIndex` of the
   * resolved value's digits.
   */
  digitIndex?: number;
  /**
   * Coordinate fallback for blanks with no AcroForm field (e.g. the cover
   * sheet's wireless question): draw the resolved value as text at this
   * position instead of filling a form field. `pdf` stays as the entry's
   * unique label. A checkbox-style entry draws "X" when it resolves true.
   */
  coord?: { page: number; x: number; y: number; size?: number };
  /** Human note for the mapper UI / debugging */
  note?: string;
}

export interface TemplateMap {
  /** Stable code, e.g. "mo-ml-v1" */
  code: string;
  /** Program codes this template serves */
  programs: string[];
  name: string;
  pageCount: number;
  fields: MapEntry[];
  /**
   * Signature/initial/date placements for M4, by AcroForm field name (or
   * page coordinates once real PDFs are inspected).
   */
  signaturePlacements: {
    kind: "signature" | "initials" | "date";
    signer: "customer" | "forza";
    /** AcroForm field whose widget rectangle hosts the stamp… */
    pdf?: string;
    /** …or explicit page coordinates for signature lines with no field. */
    x?: number;
    y?: number;
    page: number;
    note?: string;
  }[];
}

/** Everything a fill run needs besides the PDF itself. */
export interface FillContext {
  data: WorksheetData;
  programCode: string;
  /** Date the application is sent (agreement date stamps, already-open). */
  sendDate: Date;
}

export interface FillResult {
  pdfBytes: Uint8Array;
  /** PDF fields named by the map but missing from the document */
  missingFields: string[];
  /** Values applied, keyed by pdf field name (for tests/preview) */
  applied: Record<string, string | boolean>;
}
