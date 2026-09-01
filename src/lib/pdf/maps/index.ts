import { MapEntry, TemplateMap } from "../types";

/**
 * Appendix B field maps (source of truth: docs/build-plan.md).
 *
 * PDF field names marked `note: "verify"` are best-effort readings of the
 * office manager's markup and MUST be checked against the real PDFs with
 * `npm run inspect:pdf -- <file>` once they're added to the repo — the fill
 * service reports any name that doesn't exist in the document.
 *
 * The office manager's 1–38 numbering appears in comments as #n.
 */

// ---------------------------------------------------------------------------
// Page 1 — Merchant Cover Sheet
// ---------------------------------------------------------------------------
const coverSheet: MapEntry[] = [
  { pdf: "Open Date", source: "business.open_date", transform: "date_us" }, // #1
  { pdf: "Already Open", derived: "already_open", checkbox: {} },
  { pdf: "Owners Name", source: "business.legal_name", note: "verify: may be plain 'Name'" }, // #2
  { pdf: "DBA", source: "business.dba" }, // #5
  { pdf: "Owner Name", source: "owner.legal_name", note: "verify" }, // #13
  { pdf: "Owners Cell Phone", source: "owner.cell_phone", transform: "phone_us" }, // #18
  { pdf: "Owners Email", source: "owner.email" }, // #23
  { pdf: "Managers Name", derived: "manager_name_title" }, // #24 + #25
  { pdf: "Managers Phone", source: "contact.phone", transform: "phone_us" }, // #26
  { pdf: "Email", source: "contact.email" }, // #27
  { pdf: "Store Address", source: "location.street", note: "verify" }, // #6
  { pdf: "Store City State Zip", derived: "business_city_state_zip", note: "verify" }, // #7-9
  { pdf: "Shippingmailing address if different", derived: "shipping_if_different" }, // #28
  { pdf: "Location Phone", source: "location.phone", transform: "phone_us" }, // #10
  { pdf: "Cash Loader Name If you are cash loading yourself", derived: "cash_loader_name" },
  { pdf: "Low Cash Alert Name", const: "N/A", note: "verify" },
  { pdf: "Low Cash Alert Phone", const: "N/A", note: "verify" },
  { pdf: "Wireless Box Yes", source: "install.wireless_box", checkbox: { equals: true }, note: "verify" }, // #30
  { pdf: "Wireless Box No", source: "install.wireless_box", checkbox: { equals: false }, note: "verify" },
  { pdf: "Wood", source: "install.subflooring", checkbox: { equals: "wood" }, note: "verify" }, // #29
  { pdf: "Cement", source: "install.subflooring", checkbox: { equals: "cement" }, note: "verify" },
];

// ---------------------------------------------------------------------------
// Page 2 — Application for ATM Processing
// ---------------------------------------------------------------------------
const processingApplication: MapEntry[] = [
  { pdf: "DBA Name", source: "business.dba", note: "verify" }, // #5
  { pdf: "Address", source: "location.street", note: "verify" }, // #6
  { pdf: "City", source: "location.city" }, // #7
  { pdf: "State", source: "location.state", note: "verify" }, // #8
  { pdf: "Zip", source: "location.zip", note: "verify" }, // #9
  { pdf: "Phone", source: "location.phone", transform: "phone_us", note: "verify" }, // #10
  { pdf: "Corp Name", source: "business.legal_name" }, // #2
  { pdf: "Corporate Email", source: "owner.email", note: "verify" }, // #23
  { pdf: "Years at This Location", source: "location.years_at_location", note: "verify" }, // #12
  { pdf: "Business Start Date", source: "business.start_date", transform: "date_us", note: "verify" }, // #11
  { pdf: "Federal Tax ID", source: "business.ein" }, // #3
  // Business type checkboxes (#4)
  { pdf: "Check Box Sole Prop", source: "business.classification", checkbox: { equals: "sole_prop" }, note: "verify" },
  { pdf: "Check Box Corp", source: "business.classification", checkbox: { equals: "corporation" }, note: "verify" },
  { pdf: "Check Box Partnership", source: "business.classification", checkbox: { equals: "partnership" }, note: "verify" },
  { pdf: "New Account", derived: "already_open", checkbox: {}, note: "verify: header checkbox" },
  // Primary owner
  { pdf: "Primary Owner Name", source: "owner.legal_name", note: "verify" }, // #13
  { pdf: "Equity", source: "owner.equity_pct" }, // #14
  { pdf: "Resident Address", source: "owner.home_street" }, // #19
  { pdf: "Owner City", source: "owner.home_city", note: "verify" }, // #20
  { pdf: "Owner State", source: "owner.home_state", note: "verify" }, // #21
  { pdf: "Owner Zip", source: "owner.home_zip", note: "verify" }, // #22
  { pdf: "Owner Phone", source: "owner.cell_phone", transform: "phone_us", note: "verify" }, // #18
  { pdf: "Date of Birth", source: "owner.dob", transform: "date_us" }, // #16
  { pdf: "Social Security", source: "owner.ssn" }, // #15 (decrypted at fill time only)
  { pdf: "Drivers License", source: "owner.drivers_license" }, // #17
  // Bank
  { pdf: "Bank Name", source: "bank.name", note: "verify" }, // #31
  { pdf: "Name of Account", source: "bank.account_name", note: "verify" }, // #32
  { pdf: "Routing", source: "bank.routing" }, // #33
  { pdf: "Account", source: "bank.account_number" }, // #34 (decrypted at fill time only)
  // ATM setup — office-set + defaults
  { pdf: "Surcharge Amount", source: "atm.surcharge", transform: "currency", note: "verify" },
  { pdf: "Rebate Amount", source: "atm.rebate", transform: "currency", note: "verify" },
  { pdf: "Max Withdrawal", const: "200", note: "verify: default $200" },
  { pdf: "Denomination 20", const: "Yes", checkbox: { equals: "Yes" }, note: "verify: $20 denom checkbox" },
  { pdf: "Wireless Fee", derived: "wireless_fee", note: "verify: monthly fees section" },
  { pdf: "Network Fee", const: "15", note: "verify: default $15/mo" },
  // Signature block print names (signatures themselves are M4 placements)
  { pdf: "Owner Print Name", source: "owner.legal_name", note: "verify" }, // #13
];

// ---------------------------------------------------------------------------
// Page 3 — Processing Agreement
// ---------------------------------------------------------------------------
const processingAgreement: MapEntry[] = [
  { pdf: "Merchant", source: "business.dba", note: "verify" }, // #5
  { pdf: "Merchant Address", source: "location.street", note: "verify" }, // #6
  { pdf: "Merchant City State Zip", derived: "business_city_state_zip", note: "verify" }, // #7-9
  { pdf: "Day", derived: "send_day" },
  { pdf: "Month", derived: "send_month" },
  { pdf: "Year", derived: "send_year" },
  { pdf: "Rebate", source: "atm.rebate", transform: "currency" },
  { pdf: "Surcharge", source: "atm.surcharge", transform: "currency" },
  { pdf: "Print Name", source: "owner.legal_name", note: "verify" }, // #13
];

// ---------------------------------------------------------------------------
// Page 4 — PAI Exhibit 3, ACH Authorization
// ---------------------------------------------------------------------------
const achAuthorization: MapEntry[] = [
  { pdf: "Vault Cash", const: "Yes", checkbox: { equals: "Yes" }, note: "verify: always checked" },
  { pdf: "Surcharge Checkbox", const: "Yes", checkbox: { equals: "Yes" }, note: "verify: always checked" },
  { pdf: "Wireless", derived: "wireless_selected", checkbox: {}, note: "verify" }, // #30
  { pdf: "Location Name", source: "business.dba" }, // #5
  { pdf: "Contact", source: "contact.name" }, // #24
  { pdf: "ACH Address", source: "location.street", note: "verify" }, // #6
  { pdf: "ACH City", source: "location.city", note: "verify" }, // #7
  { pdf: "ACH State", source: "location.state", note: "verify" }, // #8
  { pdf: "ACH Zip", source: "location.zip", note: "verify" }, // #9
  { pdf: "ACH Phone", source: "location.phone", transform: "phone_us", note: "verify" }, // #10
  { pdf: "ATM Operator", source: "bank.account_name", note: "verify: legal name of ATM Operator" }, // #32
  { pdf: "ACH Print Name", source: "owner.legal_name", note: "verify" }, // #13
  { pdf: "ACH Date", derived: "send_date_us", note: "verify: sign date at fill time" },
  { pdf: "Name on Account", source: "bank.account_name" }, // #32
  { pdf: "Bank Street", source: "bank.street", note: "verify" }, // #35
  { pdf: "Bank City", source: "bank.city", note: "verify" }, // #36
  { pdf: "Bank State", source: "bank.state", note: "verify" }, // #37
  { pdf: "Bank Zip", source: "bank.zip", note: "verify" }, // #38
  { pdf: "Bank Name ACH", source: "bank.name", note: "verify" }, // #31
  { pdf: "Checking", const: "Yes", checkbox: { equals: "Yes" }, note: "verify: default account type" },
  { pdf: "Lumped", const: "Yes", checkbox: { equals: "Yes" }, note: "verify: default accumulation" },
  { pdf: "ACH Routing", source: "bank.routing", note: "verify" }, // #33
  { pdf: "ACH Account", source: "bank.account_number", note: "verify" }, // #34
  { pdf: "PAI Reports Email", source: "owner.email", note: "verify" }, // #23
];

// ---------------------------------------------------------------------------
// Page 5 — IRS W-9 (per-digit TIN boxes; names from blank-app.pdf)
// ---------------------------------------------------------------------------
const w9DigitBoxes: MapEntry[] = [
  // SSN boxes: Text3.0.N.2024w9 — only filled for Sole Prop (#15)
  ...Array.from({ length: 9 }, (_, i) => ({
    pdf: `Text3.0.${i}.2024w9`,
    derived: "w9_tin_ssn",
    digitIndex: i,
    note: "verify: per-digit SSN box",
  })),
  // EIN boxes: Text3.1.N.2024w9 — everyone else (#3)
  ...Array.from({ length: 9 }, (_, i) => ({
    pdf: `Text3.1.${i}.2024w9`,
    derived: "w9_tin_ein",
    digitIndex: i,
    note: "verify: per-digit EIN box",
  })),
];

const w9: MapEntry[] = [
  { pdf: "W9 Line 1", source: "bank.account_name", note: "verify: must match bank account name" }, // #32
  { pdf: "W9 Line 2", source: "business.dba", note: "verify" }, // #5
  // Box 3a from business.classification (#4)
  { pdf: "W9 Individual", derived: "w9_class_individual", checkbox: {}, note: "verify" },
  { pdf: "W9 C Corp", derived: "w9_class_c_corp", checkbox: {}, note: "verify" },
  { pdf: "W9 Partnership", derived: "w9_class_partnership", checkbox: {}, note: "verify" },
  { pdf: "W9 LLC", derived: "w9_class_llc", checkbox: {}, note: "verify" },
  { pdf: "W9 LLC Tax Class", derived: "w9_llc_tax_code", note: "verify: S or C code box" },
  // W-9 address must match the BANK account address (#35-38), not business
  { pdf: "W9 Address", source: "bank.street", note: "verify" },
  { pdf: "W9 City State Zip", derived: "business_city_state_zip", note: "verify: should be bank city/state/zip — custom rule needed if separate fields" },
  { pdf: "W9 Date", derived: "send_date_us", note: "verify: sign date at fill time" },
  ...w9DigitBoxes,
];

// ---------------------------------------------------------------------------
// Page 6 — Purchase Order
// ---------------------------------------------------------------------------
const purchaseOrder: MapEntry[] = [
  { pdf: "ACH From Account on Record", const: "Yes", checkbox: { equals: "Yes" }, note: "verify: default payment method" },
  { pdf: "PO DBA", source: "business.dba", note: "verify" }, // #5
  { pdf: "Merchant Contact", source: "owner.legal_name" }, // #13
  { pdf: "PO Email", source: "owner.email", note: "verify" }, // #23
  { pdf: "Sales Representative", source: "sales.rep_name", note: "default 'Lee Boys/' seeded" },
  { pdf: "Depository Name", source: "bank.account_name" }, // #32
  { pdf: "PO Routing", source: "bank.routing", note: "verify" }, // #33
  { pdf: "PO Account", source: "bank.account_number", note: "verify" }, // #34
  { pdf: "PO Print Name", source: "owner.legal_name", note: "verify" },
  { pdf: "PO Date", derived: "send_date_us", note: "verify" },
];

// ---------------------------------------------------------------------------
// Pages 7–8 — Cash Loading Agreement + Schedule A (cash-loading variants only)
// ---------------------------------------------------------------------------
const cashLoadingAgreement: MapEntry[] = [
  { pdf: "CL Merchant", source: "business.dba", note: "verify" }, // #5
  { pdf: "CL Rebate", source: "atm.rebate", transform: "currency", note: "verify" },
  { pdf: "CL Surcharge", source: "atm.surcharge", transform: "currency", note: "verify" },
  { pdf: "CL Print Name", source: "owner.legal_name", note: "verify" }, // #13
  { pdf: "CL Date", derived: "send_date_us", note: "verify" },
];

const scheduleA: MapEntry[] = [
  { pdf: "Schedule A Header", source: "business.dba", note: "verify" }, // #5
  { pdf: "Schedule A Account Name", source: "business.dba", note: "verify" }, // #5
  { pdf: "Schedule A Address", source: "location.street", note: "verify" }, // #6
  { pdf: "Schedule A City State Zip", derived: "business_city_state_zip", note: "verify" }, // #7-9
  { pdf: "Schedule A ATM Count", source: "atm.count", note: "verify: office-set" },
  { pdf: "Schedule A Surcharge", source: "atm.surcharge", transform: "currency", note: "verify" },
  { pdf: "Schedule A Rebate", source: "atm.rebate", transform: "currency", note: "verify" },
];

// ---------------------------------------------------------------------------
// Signature placements (M4): customer signs pp. 2,3,4,5,6 (+7 CL);
// Forza countersigns pp. 2,3,6; initials on cover-sheet internet notice.
// ---------------------------------------------------------------------------
const sharedSignatures: TemplateMap["signaturePlacements"] = [
  { kind: "initials", signer: "customer", page: 1, note: "internet notice" },
  { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
  { kind: "signature", signer: "customer", page: 3, pdf: "By X" },
  { kind: "signature", signer: "customer", page: 4, note: "ACH authorization" },
  { kind: "signature", signer: "customer", page: 5, note: "W-9" },
  { kind: "signature", signer: "customer", page: 6, note: "Purchase Order" },
  { kind: "signature", signer: "forza", page: 2, note: "Sales Associate" },
  { kind: "signature", signer: "forza", page: 3 },
  { kind: "signature", signer: "forza", page: 6 },
];

const basePages = [
  ...coverSheet,
  ...processingApplication,
  ...processingAgreement,
  ...achAuthorization,
  ...w9,
  ...purchaseOrder,
];

/** ML packet — 7 pages, no Cash Loading Agreement / Schedule A. */
export const merchantLoadMap: TemplateMap = {
  code: "mo-ml-v1",
  programs: ["mo-ml"],
  name: "Merchant Owned / Merchant Load 2026",
  pageCount: 7,
  fields: basePages,
  signaturePlacements: sharedSignatures,
};

/** CL packet — 8 pages, shared by Merchant-Owned/CL and Placement/CL. */
export const cashLoadingMap: TemplateMap = {
  code: "cl-v1",
  programs: ["mo-cl", "pl-cl"],
  name: "Merchant Owned or Placement / Cash Loading",
  pageCount: 8,
  fields: [...basePages, ...cashLoadingAgreement, ...scheduleA],
  signaturePlacements: [
    ...sharedSignatures,
    { kind: "signature", signer: "customer", page: 7, note: "Cash Loading Agreement" },
  ],
};

export const templateMaps: TemplateMap[] = [merchantLoadMap, cashLoadingMap];

export function templateMapForProgram(programCode: string): TemplateMap | undefined {
  return templateMaps.find((t) => t.programs.includes(programCode));
}
