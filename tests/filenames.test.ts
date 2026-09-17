import { describe, expect, it } from "vitest";
import { contentDisposition, executedPdfFilename } from "@/lib/filenames";

describe("executedPdfFilename", () => {
  it("brands the executed copy with the business name", () => {
    expect(executedPdfFilename("Danny's Brisket, LLC")).toBe(
      "Danny's Brisket, LLC (Forza Payments ATM App).pdf"
    );
  });

  it("strips filesystem-hostile characters and collapses whitespace", () => {
    expect(executedPdfFilename('A/B\\C:D*E?F"G<H>I|J  Mart')).toBe(
      "ABCDEFGHIJ Mart (Forza Payments ATM App).pdf"
    );
  });

  it("falls back when the business name is missing or empty", () => {
    expect(executedPdfFilename(undefined)).toBe("Application (Forza Payments ATM App).pdf");
    expect(executedPdfFilename("  ")).toBe("Application (Forza Payments ATM App).pdf");
  });
});

describe("contentDisposition", () => {
  it("quotes an ASCII fallback and RFC 5987-encodes the real name", () => {
    const header = contentDisposition("attachment", "Café Núñez (Forza Payments ATM App).pdf");
    expect(header).toContain('attachment; filename="Caf_ N__ez (Forza Payments ATM App).pdf"');
    expect(header).toContain("filename*=UTF-8''Caf%C3%A9%20N%C3%BA%C3%B1ez");
  });
});
