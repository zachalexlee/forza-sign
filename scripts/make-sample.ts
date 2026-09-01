/** Generate a sample filled packet with fixture data (manual QA). */
import { readFileSync, writeFileSync } from "fs";
import { encryptField } from "../src/lib/crypto";
import { fillPdf } from "../src/lib/pdf/fill";
import { templateMaps } from "../src/lib/pdf/maps";

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 5).toString("base64");

const data = {
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
  "install.cash_loader_name": "Jordan Smith",
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

async function main() {
  const outDir = process.argv[2] ?? ".";
  for (const map of templateMaps) {
    const blank = readFileSync(`templates/blanks/${map.code}.pdf`);
    const result = await fillPdf(new Uint8Array(blank), map, {
      data,
      programCode: map.programs[0],
      sendDate: new Date(),
    });
    const out = `${outDir}/sample-${map.code}-filled.pdf`;
    writeFileSync(out, result.pdfBytes);
    console.log(`${out} (missing: ${result.missingFields.length})`);
  }
}
main();
