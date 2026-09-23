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

  it("rejects control characters the URL parser would strip", () => {
    // URLSearchParams decodes /%09/evil.example to "/\t/evil.example",
    // which new URL() resolves to https://evil.example/.
    for (const raw of ["/%09/evil.example", "/%0a/evil.example", "/%0d/evil.example"]) {
      const next = new URLSearchParams(`next=${raw}`).get("next");
      expect(safeNextPath(next)).toBe("/admin");
    }
  });

  it("keeps query strings on same-site paths", () => {
    expect(safeNextPath("/admin?status=draft")).toBe("/admin?status=draft");
  });
});
