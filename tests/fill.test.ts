import { readFileSync } from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { encryptField } from "@/lib/crypto";
import { WorksheetData } from "@/lib/fields/types";
import { resolveDerived } from "@/lib/pdf/derived";
import { fillPdf, resolveEntry } from "@/lib/pdf/fill";
import { cashLoadingMap, merchantLoadMap, templateMapForProgram } from "@/lib/pdf/maps";
import { stampAndFlatten } from "@/lib/pdf/stamp";
import { FillContext } from "@/lib/pdf/types";

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

const SEND_DATE = new Date("2026-09-01T12:00:00Z");

const blankFor = (code: string) =>
  new Uint8Array(
    readFileSync(path.resolve(__dirname, `../templates/blanks/${code}.pdf`))
  );

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
    "atm.make_model": "Hyosung Halo II",
    "sales.rep_name": "Lee Boys/",
  };
}

function ctx(programCode: string, data = fixtureData()): FillContext {
  return { data, programCode, sendDate: SEND_DATE };
}

describe("derived rules (Appendix C + packet-verified)", () => {
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

  it("business type labels for the application's type row", () => {
    expect(resolveDerived("business_type_label", ctx("mo-cl"))).toBe("LLC - S Corp");
    expect(resolveDerived("business_type_other_label", ctx("mo-cl"))).toBe("LLC - S Corp");
    const corp = { ...fixtureData(), "business.classification": "corporation" };
    expect(resolveDerived("business_type_label", ctx("mo-cl", corp))).toBe("Corporation");
    expect(resolveDerived("business_type_other_label", ctx("mo-cl", corp))).toBe("");
  });

  it("owner name split for the source-of-funds form", () => {
    expect(resolveDerived("owner_first_name", ctx("mo-ml"))).toBe("Jordan");
    expect(resolveDerived("owner_last_name", ctx("mo-ml"))).toBe("Smith");
    const threePart = { ...fixtureData(), "owner.legal_name": "Mary Jo Kline" };
    expect(resolveDerived("owner_first_name", ctx("mo-ml", threePart))).toBe("Mary Jo");
    expect(resolveDerived("owner_last_name", ctx("mo-ml", threePart))).toBe("Kline");
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

  it("wireless fee and written answer follow the wireless box answer", () => {
    expect(resolveDerived("wireless_fee", ctx("mo-cl"))).toBe("25.95");
    expect(resolveDerived("wireless_yes_no", ctx("mo-cl"))).toBe("Yes");
    const noWireless = { ...fixtureData(), "install.wireless_box": false };
    expect(resolveDerived("wireless_fee", ctx("mo-cl", noWireless))).toBe("");
    expect(resolveDerived("wireless_yes_no", ctx("mo-cl", noWireless))).toBe("No");
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
});

describe("template selection", () => {
  it("routes programs to the right packet", () => {
    expect(templateMapForProgram("mo-ml")?.code).toBe("mo-ml-v1");
    expect(templateMapForProgram("mo-cl")?.code).toBe("cl-v1");
    expect(templateMapForProgram("pl-cl")?.code).toBe("cl-v1");
    expect(templateMapForProgram("nope")).toBeUndefined();
  });
});

describe("fillPdf against the REAL packet PDFs", () => {
  it("CL packet: every mapped field exists and key values land", async () => {
    const result = await fillPdf(blankFor("cl-v1"), cashLoadingMap, ctx("mo-cl"));
    expect(result.missingFields).toEqual([]);

    const doc = await PDFDocument.load(result.pdfBytes);
    const form = doc.getForm();
    expect(form.getTextField("Corp Name").getText()).toBe("Acme Ventures LLC");
    // Shared field carries the BANK ACCOUNT name (#32) per the ACH/W-9 rule.
    const differentAccount = await fillPdf(
      blankFor("cl-v1"),
      cashLoadingMap,
      ctx("mo-cl", { ...fixtureData(), "bank.account_name": "Acme Holdings Inc" })
    );
    const diffForm = (await PDFDocument.load(differentAccount.pdfBytes)).getForm();
    expect(diffForm.getTextField("Corp Name").getText()).toBe("Acme Holdings Inc");
    expect(form.getTextField("DBA").getText()).toBe("Acme Mart");
    expect(form.getTextField("Federal Tax ID").getText()).toBe("12-3456789");
    expect(form.getTextField("Routing").getText()).toBe("021000021");
    expect(form.getTextField("Account").getText()).toBe("000123456");
    expect(form.getTextField("Social Security").getText()).toBe("123-45-6789");
    expect(form.getTextField("Day").getText()).toBe("1");
    expect(form.getTextField("Month").getText()).toBe("September");
    expect(form.getTextField("Surcharge").getText()).toBe("3.00");
    expect(form.getTextField("Location Address 2").getText()).toBe("Atlanta, GA, 30301");
    expect(
      form.getTextField("Cash Loader Name If you are cash loading yourself").getText()
    ).toBe("Forza Cash Loader");
    expect(form.getTextField("Wireless Box").getText()).toBe("25.95");
    // LLC → Other box + label, not the named boxes
    expect(form.getCheckBox("Check Box1.0.2").isChecked()).toBe(true);
    expect(form.getCheckBox("Check Box1.1.2121212").isChecked()).toBe(false);
    expect(form.getTextField("Other").getText()).toBe("LLC - S Corp");
    // W-9: LLC box + S code + EIN digits in visual order
    expect(form.getCheckBox("Check Box15.1.0").isChecked()).toBe(true);
    expect(form.getTextField("Text161.2").getText()).toBe("S");
    expect(form.getTextField("Text3.1.0" + "2024w9").getText()).toBe("1");
    expect(form.getTextField("Text3.0.3" + "2024w9").getText()).toBe("4"); // 4th EIN digit by position
    expect(form.getTextField("Text3.0.0" + "2024w9").getText() ?? "").toBe("");
    // ACH defaults
    expect(form.getCheckBox("Check Box33").isChecked()).toBe(true);
    expect(form.getCheckBox("Check Box35").isChecked()).toBe(true); // wireless yes
  });

  it("ML packet: every mapped field exists and the source-of-funds page fills", async () => {
    const data = { ...fixtureData(), "install.cash_loader_name": "Jordan Smith" };
    const result = await fillPdf(blankFor("mo-ml-v1"), merchantLoadMap, ctx("mo-ml", data));
    expect(result.missingFields).toEqual([]);

    const doc = await PDFDocument.load(result.pdfBytes);
    const form = doc.getForm();
    expect(form.getTextField("11 Applicant F rst Name").getText()).toBe("Jordan");
    expect(form.getTextField("12 Applicant Last Name").getText()).toBe("Smith");
    expect(form.getTextField("14 Applicant Home C ty State Zip").getText()).toBe(
      "Decatur, GA, 30030"
    );
    expect(form.getTextField("15 Applicant Social Security Number").getText()).toBe(
      "123-45-6789"
    );
    expect(form.getTextField("EIN").getText()).toBe("12-3456789");
    expect(form.getCheckBox("Business TaxID").isChecked()).toBe(true);
    expect(form.getTextField("Corp Address 2").getText()).toBe("Atlanta, GA, 30301");
    expect(
      form.getTextField("Cash Loader Name If you are cash loading yourself").getText()
    ).toBe("Jordan Smith");
  });

  for (const [code, map, program] of [
    ["cl-v1", cashLoadingMap, "mo-cl"],
    ["mo-ml-v1", merchantLoadMap, "mo-ml"],
  ] as const) {
    it(`${code}: stampAndFlatten stamps every customer placement and flattens`, async () => {
      const { pdfBytes } = await fillPdf(blankFor(code), map, ctx(program));
      // 1x1 transparent-ish PNG
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );
      const result = await stampAndFlatten({
        filledPdf: pdfBytes,
        map,
        signaturePng: new Uint8Array(png),
        signerName: "Jordan Smith",
        signedAt: SEND_DATE,
      });
      const expected = map.signaturePlacements.filter(
        (p) => p.signer === "customer" && p.kind === "signature"
      ).length;
      expect(result.stampedPlacements).toBe(expected);
      expect(result.skippedPlacements).toBe(0);
      // Flattened: no form fields remain editable.
      const doc = await PDFDocument.load(result.pdfBytes);
      expect(doc.getForm().getFields()).toHaveLength(0);
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
