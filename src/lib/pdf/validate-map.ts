import { DERIVED_RULE_NAMES } from "./derived";
import { MapEntry, Transform } from "./types";

const TRANSFORMS: Transform[] = ["date_us", "phone_us", "currency", "upper"];

/**
 * Validate and sanitize a field map before it is persisted (the mapper's
 * raw-JSON editor can submit arbitrary values). Returns per-entry errors
 * and, when clean, entries stripped to exactly the supported properties —
 * a typo'd derived rule or transform must fail here, not at the next PDF
 * regeneration.
 */
export function validateMapEntries(
  input: unknown,
  validSourceKeys: Set<string>
): { errors: string[]; entries: MapEntry[] } {
  const errors: string[] = [];
  const entries: MapEntry[] = [];

  if (!Array.isArray(input)) {
    return { errors: ["Field map must be an array of entries"], entries: [] };
  }

  const seen = new Set<string>();
  for (const [i, raw] of input.entries()) {
    const label = `Row ${i + 1}`;
    if (typeof raw !== "object" || raw === null) {
      errors.push(`${label}: not an object`);
      continue;
    }
    const e = raw as Record<string, unknown>;
    const pdf = typeof e.pdf === "string" ? e.pdf.trim() : "";
    if (!pdf) {
      errors.push(`${label}: missing PDF field name`);
      continue;
    }
    if (seen.has(pdf)) errors.push(`${pdf}: mapped more than once`);
    seen.add(pdf);

    const sources = [e.source, e.const, e.derived].filter(
      (v) => v !== undefined && v !== ""
    );
    if (sources.length !== 1) {
      errors.push(`${pdf}: set exactly one of dictionary key / constant / derived rule`);
      continue;
    }

    const entry: MapEntry = { pdf };
    if (e.source !== undefined && e.source !== "") {
      if (typeof e.source !== "string" || !validSourceKeys.has(e.source)) {
        errors.push(`${pdf}: unknown dictionary key "${String(e.source)}"`);
        continue;
      }
      entry.source = e.source;
    } else if (e.const !== undefined) {
      if (typeof e.const !== "string") {
        errors.push(`${pdf}: constant must be a string`);
        continue;
      }
      entry.const = e.const;
    } else {
      if (
        typeof e.derived !== "string" ||
        !(DERIVED_RULE_NAMES as readonly string[]).includes(e.derived)
      ) {
        errors.push(`${pdf}: unknown derived rule "${String(e.derived)}"`);
        continue;
      }
      entry.derived = e.derived;
    }

    if (e.transform !== undefined && e.transform !== "") {
      if (!TRANSFORMS.includes(e.transform as Transform)) {
        errors.push(`${pdf}: unknown transform "${String(e.transform)}"`);
        continue;
      }
      entry.transform = e.transform as Transform;
    }

    if (e.checkbox !== undefined) {
      if (typeof e.checkbox !== "object" || e.checkbox === null) {
        errors.push(`${pdf}: checkbox must be an object like {} or {"equals": value}`);
        continue;
      }
      const equals = (e.checkbox as { equals?: unknown }).equals;
      entry.checkbox = equals === undefined ? {} : { equals };
    }

    if (e.coord !== undefined) {
      const c = e.coord as { page?: unknown; x?: unknown; y?: unknown; size?: unknown };
      const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
      if (
        typeof e.coord !== "object" ||
        e.coord === null ||
        !num(c.page) ||
        !num(c.x) ||
        !num(c.y) ||
        (c.size !== undefined && !num(c.size)) ||
        (c.page as number) < 1
      ) {
        errors.push(`${pdf}: coord must be {page>=1, x, y, size?} numbers`);
        continue;
      }
      entry.coord = {
        page: c.page as number,
        x: c.x as number,
        y: c.y as number,
        ...(c.size !== undefined ? { size: c.size as number } : {}),
      };
    }

    if (e.digitIndex !== undefined) {
      if (
        typeof e.digitIndex !== "number" ||
        !Number.isInteger(e.digitIndex) ||
        e.digitIndex < 0 ||
        e.digitIndex > 40
      ) {
        errors.push(`${pdf}: digitIndex must be an integer between 0 and 40`);
        continue;
      }
      entry.digitIndex = e.digitIndex;
    }

    if (typeof e.note === "string" && e.note) entry.note = e.note;
    entries.push(entry);
  }

  return { errors, entries: errors.length === 0 ? entries : [] };
}
