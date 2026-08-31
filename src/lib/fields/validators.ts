import { z } from "zod";

/**
 * Shared format validators for the field dictionary (build plan §6.1).
 * These back both the customer worksheet form and the admin edit form.
 */

/** ABA routing number checksum (mod-10 with 3-7-1 weights). */
export function isValidAbaRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    1 * (d[2] + d[5] + d[8]);
  return sum % 10 === 0 && sum > 0;
}

export const einSchema = z
  .string()
  .regex(/^\d{2}-\d{7}$/, "EIN must be in the format XX-XXXXXXX");

export const ssnSchema = z
  .string()
  .regex(/^\d{3}-?\d{2}-?\d{4}$/, "SSN must be 9 digits (XXX-XX-XXXX)");

export const zipSchema = z.string().regex(/^\d{5}$/, "ZIP must be 5 digits");

export const usPhoneSchema = z
  .string()
  .transform((v) => v.replace(/[^\d]/g, ""))
  .refine((v) => v.length === 10 || (v.length === 11 && v.startsWith("1")), {
    message: "Enter a 10-digit US phone number",
  });

export const routingSchema = z
  .string()
  .regex(/^\d{9}$/, "Routing number must be 9 digits")
  .refine(isValidAbaRouting, { message: "Invalid routing number (checksum failed)" });

export const accountNumberSchema = z
  .string()
  .regex(/^\d{4,17}$/, "Account number must be 4–17 digits");

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
] as const;

export const usStateSchema = z.enum(US_STATES);

/** Derived per Appendix C: business.open_date <= reference date. */
export function isAlreadyOpen(openDate: string, reference: Date = new Date()): boolean {
  return new Date(openDate).getTime() <= reference.getTime();
}

/** Derived per Appendix A #11: full years elapsed since the start date. */
export function yearsInBusiness(startDate: string, reference: Date = new Date()): number {
  const start = new Date(startDate);
  let years = reference.getFullYear() - start.getFullYear();
  const anniversary = new Date(start);
  anniversary.setFullYear(start.getFullYear() + years);
  if (anniversary.getTime() > reference.getTime()) years -= 1;
  return Math.max(0, years);
}
