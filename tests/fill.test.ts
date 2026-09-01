import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { encryptField } from "@/lib/crypto";
import { WorksheetData } from "@/lib/fields/types";
import { resolveDerived } from "@/lib/pdf/derived";
import { fillPdf, resolveEntry } from "@/lib/pdf/fill";
import { cashLoadingMap, merchantLoadMap, templateMapForProgram } from "@/lib/pdf/maps";
import { FillContext, TemplateMap } from "@/lib/pdf/types";

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

const SEND_DATE = new Date("2026-09-01T12:00:00Z");

function fixtureData(): WorksheetData {
  return {
    "business.open_date": "2024-05-01",
    "business.legal_name": "Acme Ventures LLC",
    "business.ein": "12-3456789",
    "business.classification": "llc_s",
    "business.dba": "Acme Mart",
    "location.street": "100 Main St",
    "location.city": "Atlanta",
    "location.state": "GA",
    "location.zip": "30301",
    "location.phone": "4045550100",
    "business.start_date": "2020-01-15",
    "location.years_at_location": 4,
    "owner.legal_name": "Jordan Smith",
    "owner.equity_pct": 100,
    "owner.ssn": encryptField("123-45-6789"),
    "owner.dob": "1985-03-10",
    "owner.drivers_license": "GA 123456789",
    "owner.cell_phone": "4045550101",
    "owner.home_street": "5 Oak Ln",
    "owner.home_city": "Decatur",
    "owner.home_state": "GA",
    "owner.home_zip": "30030",
    "owner.email": "jordan@acmemart.com",
    "contact.name": "Sam Lee",
    "contact.job_title": "Manager",
    "contact.phone": "4045550102",
    "contact.email": "sam@acmemart.com",
    "install.shipping_same_as_business": true,
    "install.subflooring": "cement",
    "install.wireless_box": true,
    "bank.name": "First Bank of Georgia",
    "bank.account_name": "Acme Ventures LLC",
    "bank.routing": "021000021",
    "bank.account_number": encryptField("000123456"),
    "bank.street": "100 Main St",
    "bank.city": "Atlanta",
    "bank.state": "GA",
    "bank.zip": "30301",
    "atm.surcharge": 3,
    "atm.rebate": 0.5,
    "atm.count": 1,
    "sales.rep_name": "Lee Boys/",
  };
}

function ctx(programCode: string, data = fixtureData()): FillContext {
  return { data, programCode, sendDate: SEND_DATE };
}

/** Build a blank fixture PDF containing every field the map names. */
async function fixturePdfFor(map: TemplateMap): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  let y = 780;
  for (const entry of map.fields) {
    y -= 4;
    if (y < 10) y = 780;
    if (entry.checkbox) {
      form.createCheckBox(entry.pdf).addToPage(page, { x: 5, y, width: 3, height: 3 });
    } else {
      form.createTextField(entry.pdf).addToPage(page, { x: 20, y, width: 60, height: 3 });
    }
  }
  return doc.save();
}

describe("derived rules (Appendix C)", () => {
  it("stamps agreement dates from the send date", () => {
    const c = ctx("mo-cl");
    expect(resolveDerived("send_day", c)).toBe("1");
    expect(resolveDerived("send_month", c)).toBe("September");
    expect(resolveDerived("send_year", c)).toBe("2026");
    expect(resolveDerived("send_date_us", c)).toBe("09/01/2026");
  });

  it("already_open from business.open_date vs send date", () => {
    expect(resolveDerived("already_open", ctx("mo-cl"))).toBe(true);
    const future = { ...fixtureData(), "business.open_date": "2027-01-01" };
    expect(resolveDerived("already_open", ctx("mo-cl", future))).toBe(false);
  });

  it("W-9 TIN: EIN digits for LLC, SSN digits (decrypted) for sole prop", () => {
    expect(resolveDerived("w9_tin_ein", ctx("mo-cl"))).toBe("123456789");
    expect(resolveDerived("w9_tin_ssn", ctx("mo-cl"))).toBe("");
    const soleProp = { ...fixtureData(), "business.classification": "sole_prop" };
    expect(resolveDerived("w9_tin_ssn", ctx("mo-cl", soleProp))).toBe("123456789");
    expect(resolveDerived("w9_tin_ein", ctx("mo-cl", soleProp))).toBe("");
  });

  it("W-9 LLC tax code S/C from classification", () => {
    expect(resolveDerived("w9_llc_tax_code", ctx("mo-cl"))).toBe("S");
    const llcC = { ...fixtureData(), "business.classification": "llc_c" };
    expect(resolveDerived("w9_llc_tax_code", ctx("mo-cl", llcC))).toBe("C");
  });

  it("shipping prints only when different from the business address", () => {
    expect(resolveDerived("shipping_if_different", ctx("mo-cl"))).toBe("");
    const different = {
      ...fixtureData(),
      "install.shipping_same_as_business": false,
      "install.shipping_address": "200 Warehouse Rd, Atlanta GA",
    };
    expect(resolveDerived("shipping_if_different", ctx("mo-cl", different))).toBe(
      "200 Warehouse Rd, Atlanta GA"
    );
  });

  it("cash loader name: constant for CL variants, merchant's own for ML", () => {
    expect(resolveDerived("cash_loader_name", ctx("mo-cl"))).toBe("Forza Cash Loader");
    expect(resolveDerived("cash_loader_name", ctx("pl-cl"))).toBe("Forza Cash Loader");
    const ml = { ...fixtureData(), "install.cash_loader_name": "Jordan Smith" };
    expect(resolveDerived("cash_loader_name", ctx("mo-ml", ml))).toBe("Jordan Smith");
  });

  it("wireless fee follows the wireless box answer", () => {
    expect(resolveDerived("wireless_fee", ctx("mo-cl"))).toBe("25.95");
    const noWireless = { ...fixtureData(), "install.wireless_box": false };
    expect(resolveDerived("wireless_fee", ctx("mo-cl", noWireless))).toBe("");
  });
});

describe("map entry resolution", () => {
  it("decrypts sensitive values only at fill time", () => {
    const value = resolveEntry(
      { pdf: "Social Security", source: "owner.ssn" },
      ctx("mo-cl")
    );
    expect(value).toBe("123-45-6789");
  });

  it("splits per-digit W-9 boxes", () => {
    const first = resolveEntry(
      { pdf: "Text3.1.0.2024w9", derived: "w9_tin_ein", digitIndex: 0 },
      ctx("mo-cl")
    );
    const last = resolveEntry(
      { pdf: "Text3.1.8.2024w9", derived: "w9_tin_ein", digitIndex: 8 },
      ctx("mo-cl")
    );
    expect(first).toBe("1");
    expect(last).toBe("9");
  });

  it("formats transforms", () => {
    expect(
      resolveEntry({ pdf: "x", source: "owner.dob", transform: "date_us" }, ctx("mo-cl"))
    ).toBe("03/10/1985");
    expect(
      resolveEntry(
        { pdf: "x", source: "location.phone", transform: "phone_us" },
        ctx("mo-cl")
      )
    ).toBe("(404) 555-0100");
    expect(
      resolveEntry(
        { pdf: "x", source: "atm.surcharge", transform: "currency" },
        ctx("mo-cl")
      )
    ).toBe("3.00");
  });

  it("checkbox equals-matching", () => {
    expect(
      resolveEntry(
        { pdf: "Cement", source: "install.subflooring", checkbox: { equals: "cement" } },
        ctx("mo-cl")
      )
    ).toBe(true);
    expect(
      resolveEntry(
        { pdf: "Wood", source: "install.subflooring", checkbox: { equals: "wood" } },
        ctx("mo-cl")
      )
    ).toBe(false);
  });
});

describe("template selection", () => {
  it("routes programs to the right packet", () => {
    expect(templateMapForProgram("mo-ml")?.code).toBe("mo-ml-v1");
    expect(templateMapForProgram("mo-cl")?.code).toBe("cl-v1");
    expect(templateMapForProgram("pl-cl")?.code).toBe("cl-v1");
    expect(templateMapForProgram("nope")).toBeUndefined();
  });
});

describe("fillPdf end-to-end (per-template)", () => {
  for (const map of [merchantLoadMap, cashLoadingMap]) {
    it(`fills every mapped field for ${map.code}`, async () => {
      const blank = await fixturePdfFor(map);
      const result = await fillPdf(blank, map, ctx(map.programs[0]));
      expect(result.missingFields).toEqual([]);

      // Re-read the produced PDF and assert values landed.
      const doc = await PDFDocument.load(result.pdfBytes);
      const form = doc.getForm();
      expect(form.getTextField("Corp Name").getText()).toBe("Acme Ventures LLC");
      expect(form.getTextField("Federal Tax ID").getText()).toBe("12-3456789");
      expect(form.getTextField("Routing").getText()).toBe("021000021");
      expect(form.getTextField("Account").getText()).toBe("000123456");
      expect(form.getTextField("Day").getText()).toBe("1");
      expect(form.getTextField("Month").getText()).toBe("September");
      expect(form.getTextField("Surcharge").getText()).toBe("3.00");
      expect(form.getCheckBox("Already Open").isChecked()).toBe(true);
      expect(form.getCheckBox("Cement").isChecked()).toBe(true);
      expect(form.getCheckBox("Wood").isChecked()).toBe(false);
      expect(form.getCheckBox("Wireless").isChecked()).toBe(true);
      // W-9: LLC → EIN boxes filled, SSN boxes empty
      expect(form.getTextField("Text3.1.0.2024w9").getText()).toBe("1");
      expect(form.getTextField("Text3.1.8.2024w9").getText()).toBe("9");
      expect(form.getTextField("Text3.0.0.2024w9").getText() ?? "").toBe("");

      if (map.code === "cl-v1") {
        expect(
          form.getTextField("Cash Loader Name If you are cash loading yourself").getText()
        ).toBe("Forza Cash Loader");
      }
    });
  }

  it("reports fields missing from the PDF instead of throwing", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const blank = await doc.save();
    const result = await fillPdf(blank, merchantLoadMap, ctx("mo-ml"));
    expect(result.missingFields.length).toBeGreaterThan(0);
  });
});
