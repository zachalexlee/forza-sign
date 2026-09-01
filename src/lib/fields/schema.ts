import { z } from "zod";
import {
  accountNumberSchema,
  einSchema,
  routingSchema,
  ssnSchema,
  usPhoneSchema,
  usStateSchema,
  zipSchema,
} from "./validators";
import {
  FieldDefinition,
  WorksheetData,
  isFieldVisible,
  isMaskedValue,
} from "./types";

/**
 * Builds validation from the field dictionary, so the customer form, the
 * admin edit form, and the API all share one source of truth (build plan §3).
 */

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Invalid date" });

function baseSchemaFor(def: FieldDefinition): z.ZodTypeAny {
  switch (def.field_type) {
    case "email":
      return z.string().trim().pipe(z.email("Enter a valid email address"));
    case "phone":
      return usPhoneSchema;
    case "ein":
      return einSchema;
    case "ssn":
      return ssnSchema;
    case "zip":
      return zipSchema;
    case "state":
      return usStateSchema;
    case "routing":
      return routingSchema;
    case "account_number":
      return accountNumberSchema;
    case "date": {
      let schema = dateSchema;
      const minAge = def.validation?.min_age as number | undefined;
      if (minAge) {
        schema = schema.refine(
          (v) => {
            const dob = new Date(v);
            const cutoff = new Date();
            cutoff.setFullYear(cutoff.getFullYear() - minAge);
            return dob.getTime() <= cutoff.getTime();
          },
          { message: `Must be at least ${minAge} years old` }
        );
      }
      return schema;
    }
    case "number":
    case "currency": {
      let schema = z.coerce.number({ error: "Enter a number" });
      const min = def.validation?.min as number | undefined;
      const max = def.validation?.max as number | undefined;
      if (min !== undefined) schema = schema.min(min, `Must be at least ${min}`);
      if (max !== undefined) schema = schema.max(max, `Must be at most ${max}`);
      return schema;
    }
    case "boolean":
      return z.boolean({ error: "Select an option" });
    case "select": {
      const values = (def.options ?? []).map((o) => o.value);
      return values.length
        ? z.enum(values as [string, ...string[]])
        : z.string().min(1);
    }
    case "file":
      // Value in the data blob is the storage path set by the upload route.
      return z.string().min(1, "Upload required");
    case "textarea":
    case "text":
    default:
      return z.string().trim().min(1, "Required");
  }
}

export function schemaForField(def: FieldDefinition): z.ZodTypeAny {
  const base = baseSchemaFor(def);
  if (!def.required) {
    // Optional fields accept absent / empty values.
    return z
      .union([base, z.literal(""), z.null(), z.undefined()])
      .transform((v) => (v === "" || v === null ? undefined : v));
  }
  return base;
}

export interface ValidationIssue {
  key: string;
  message: string;
}

/**
 * Validate a worksheet data blob against the dictionary.
 *
 * - Hidden fields (visible_if unmet) are skipped.
 * - Masked sentinels for sensitive fields count as "already provided".
 * - `partial` validates only present keys (save-and-resume); full validation
 *   also enforces required fields (submit).
 */
export function validateWorksheetData(
  defs: FieldDefinition[],
  data: WorksheetData,
  { partial = false }: { partial?: boolean } = {}
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const def of defs) {
    if (!def.ask_customer) continue;
    if (!isFieldVisible(def, data)) continue;

    const value = data[def.key];
    const missing = value === undefined || value === null || value === "";

    if (missing) {
      if (!partial && def.required) {
        issues.push({ key: def.key, message: `${def.label} is required` });
      }
      continue;
    }

    if (def.sensitive && isMaskedValue(value)) continue; // stored earlier

    const result = schemaForField(def).safeParse(value);
    if (!result.success) {
      issues.push({
        key: def.key,
        message: result.error.issues[0]?.message ?? "Invalid value",
      });
    }
  }

  return issues;
}

/** Keys that may be written by the customer form (whitelist for the API). */
export function customerWritableKeys(defs: FieldDefinition[]): Set<string> {
  return new Set(defs.filter((d) => d.ask_customer).map((d) => d.key));
}
