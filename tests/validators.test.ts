import { describe, expect, it } from "vitest";
import {
  einSchema,
  isAlreadyOpen,
  isValidAbaRouting,
  routingSchema,
  ssnSchema,
  usPhoneSchema,
  yearsInBusiness,
  zipSchema,
} from "@/lib/fields/validators";

describe("ABA routing checksum", () => {
  // Well-known valid routing numbers
  it.each(["011000015", "021000021", "111000025", "122105155"])(
    "accepts valid routing number %s",
    (r) => expect(isValidAbaRouting(r)).toBe(true)
  );

  it.each(["021000022", "123456789", "000000000", "12345678", "abcdefghi"])(
    "rejects invalid routing number %s",
    (r) => expect(isValidAbaRouting(r)).toBe(false)
  );

  it("zod schema reports checksum failures", () => {
    expect(routingSchema.safeParse("021000021").success).toBe(true);
    expect(routingSchema.safeParse("021000022").success).toBe(false);
  });
});

describe("format validators", () => {
  it("EIN", () => {
    expect(einSchema.safeParse("12-3456789").success).toBe(true);
    expect(einSchema.safeParse("123456789").success).toBe(false);
  });

  it("SSN", () => {
    expect(ssnSchema.safeParse("123-45-6789").success).toBe(true);
    expect(ssnSchema.safeParse("123456789").success).toBe(true);
    expect(ssnSchema.safeParse("123-456-789").success).toBe(false);
  });

  it("ZIP", () => {
    expect(zipSchema.safeParse("30301").success).toBe(true);
    expect(zipSchema.safeParse("3030").success).toBe(false);
  });

  it("US phone normalizes punctuation", () => {
    const parsed = usPhoneSchema.safeParse("(404) 555-0123");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe("4045550123");
    expect(usPhoneSchema.safeParse("555-0123").success).toBe(false);
  });
});

describe("derived logic (Appendix C)", () => {
  it("already_open compares open date to the send date", () => {
    const sendDate = new Date("2026-08-31");
    expect(isAlreadyOpen("2026-08-01", sendDate)).toBe(true);
    expect(isAlreadyOpen("2026-09-15", sendDate)).toBe(false);
  });

  it("years in business counts full years", () => {
    const ref = new Date("2026-08-31");
    expect(yearsInBusiness("2020-08-31", ref)).toBe(6);
    expect(yearsInBusiness("2020-09-01", ref)).toBe(5);
    expect(yearsInBusiness("2026-01-01", ref)).toBe(0);
  });
});
