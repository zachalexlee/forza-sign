import { describe, expect, it } from "vitest";
import { isAllowedStaffEmail, safeNextPath } from "@/lib/auth-domain";

describe("isAllowedStaffEmail", () => {
  it("accepts Forza Payments addresses, case-insensitively", () => {
    expect(isAllowedStaffEmail("zach@forzapayments.com")).toBe(true);
    expect(isAllowedStaffEmail("Michelle@ForzaPayments.COM")).toBe(true);
  });

  it("rejects other domains and look-alikes", () => {
    expect(isAllowedStaffEmail("someone@gmail.com")).toBe(false);
    expect(isAllowedStaffEmail("x@forzapayments.com.evil.io")).toBe(false);
    expect(isAllowedStaffEmail("x@notforzapayments.com")).toBe(false);
    expect(isAllowedStaffEmail("x@mail.forzapayments.com")).toBe(false);
    expect(isAllowedStaffEmail("forzapayments.com")).toBe(false);
    expect(isAllowedStaffEmail("@forzapayments.com")).toBe(false);
    expect(isAllowedStaffEmail(null)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/admin/applications")).toBe("/admin/applications");
  });

  it("rejects anything that could leave the site", () => {
    expect(safeNextPath("https://evil.example")).toBe("/admin");
    expect(safeNextPath("//evil.example")).toBe("/admin");
    expect(safeNextPath("/\\evil.example")).toBe("/admin");
    expect(safeNextPath(null)).toBe("/admin");
  });
});
