import { MapEntry, TemplateMap } from "../types";

/**
 * Field maps VERIFIED against the real packet PDFs in templates/blanks/
 * (uploaded by Zach; inspected with scripts/dump-fields.ts). The office
 * manager's 1–38 numbering appears in comments as #n.
 *
 * Two facts about these packets drive the shape of the maps:
 *
 * 1. Fields are SHARED across pages by name — one "DBA" field has widgets on
 *    seven pages, so each field is mapped exactly once and lands everywhere.
 *    Sharing also forces one choice where the build plan wanted different
 *    values per page: "Corp Name" serves Corporate Name (p2), ATM Operator +
 *    Name on Account (ACH), W-9 line 1, Depository Name (PO), and Schedule A
 *    Account Name → mapped to bank.account_name (#32), which the dictionary
 *    designates for the ACH/W-9/depository locations. "Corp Address"/City/
 *    State/Zip serve the corporate address AND the ACH/W-9 bank-account
 *    address → mapped to bank.* per the office rule ("Exhibit 3 and W-9 must
 *    match data on bank account", printed on the ACH form itself). The
 *    office can override either on the review screen.
 *
 * 2. A few blanks have no AcroForm field at all (cover-sheet wireless answer
 *    and subflooring, the ACH/W-9/PO signature lines) — those use `coord`
 *    entries and coordinate signature placements.
 */

/**
 * Bump when the in-repo maps change: `npm run sync:maps` re-seeds any
 * template row whose stored map came from the repo (map_source 'repo' or
 * legacy NULL) and is older than this. Office-edited maps ('custom') are
 * never auto-updated.
 */
export const MAP_VERSION = 2;

// ---------------------------------------------------------------------------
// Shared fields — identical names in both packets (cover sheet, application,
// processing agreement, ACH, W-9 TIN boxes, purchase order).
// ---------------------------------------------------------------------------
const shared: MapEntry[] = [
  // Cover sheet (p1)
  { pdf: "Open Date", source: "business.open_date", transform: "date_us" }, // #1
  { pdf: "Already Open", derived: "already_open", note: "text blank; prints Yes when open" },
  { pdf: "Corp Name", source: "bank.account_name", note: "shared: corporate name, ATM Operator, W-9 line 1, name on account, depository, Schedule A — dictionary #32 feeds the ACH/W-9/depository widgets, which outnumber the corporate-name one; account name ≈ legal name for these merchants and the office can override" }, // #32
  { pdf: "DBA", source: "business.dba" }, // #5
  { pdf: "Owners Name", source: "owner.legal_name", note: "shared: owner, print-name blocks, ACH contact" }, // #13
  { pdf: "Owners Cell Phone", source: "owner.cell_phone", transform: "phone_us" }, // #18
  { pdf: "Owners Email", source: "owner.email", note: "shared: owner, corporate + location email, PAI reports, PO email" }, // #23
  { pdf: "Managers Name", derived: "manager_name_title" }, // #24+#25
  { pdf: "Managers Phone", source: "contact.phone", transform: "phone_us" }, // #26
  { pdf: "Email", source: "contact.email" }, // #27
  { pdf: "Location Address 1", source: "location.street", note: "shared across cover/application/agreement/ACH" }, // #6
  { pdf: "Location Address 2", derived: "business_city_state_zip" }, // #7-9
  { pdf: "Shippingmailing address if different", derived: "shipping_if_different" }, // #28
  { pdf: "Location Phone", source: "location.phone", transform: "phone_us" }, // #10
  { pdf: "Cash Loader Name If you are cash loading yourself", derived: "cash_loader_name" },
  // Cover-sheet blanks with no form field (coordinates measured from the PDF):
  { pdf: "__wireless_answer", derived: "wireless_yes_no", coord: { page: 1, x: 270, y: 230 }, note: "'Do you require wireless ATM Cellular Box?' written answer" }, // #30
  { pdf: "__subflooring_wood", source: "install.subflooring", checkbox: { equals: "wood" }, coord: { page: 1, x: 58, y: 172 } }, // #29
  { pdf: "__subflooring_cement", source: "install.subflooring", checkbox: { equals: "cement" }, coord: { page: 1, x: 58, y: 155 } },

  // Application (p2) — header
  { pdf: "Date", derived: "send_date_us", note: "shared: application header + PO date" },
  { pdf: "Check Box2.0", const: "Yes", checkbox: { equals: "Yes" }, note: "New Account (default)" },
  // Location + corporate columns
  { pdf: "City", source: "location.city" }, // #7 (also ACH city)
  { pdf: "State", source: "location.state" }, // #8 (also ACH + agreement 'a __ corporation')
  { pdf: "Zip", source: "location.zip" }, // #9
  { pdf: "Corp Address", source: "bank.street", note: "shared: corporate + ACH/W-9 account address — must match bank (#35)" },
  { pdf: "Corp City", source: "bank.city" }, // #36
  { pdf: "Corp State", source: "bank.state" }, // #37
  { pdf: "Corp Zip", source: "bank.zip" }, // #38
  { pdf: "Years at This Location", source: "location.years_at_location" }, // #12
  { pdf: "Business Start Date", source: "business.start_date", transform: "date_us" }, // #11
  { pdf: "Federal Tax ID", source: "business.ein" }, // #3
  { pdf: "Business Type", derived: "business_type_label" }, // #4
  // Business-type checkboxes: Sole Prop / Corporation / Partnership / Other
  { pdf: "Check Box1.1.2121212", source: "business.classification", checkbox: { equals: "sole_prop" } },
  { pdf: "Check Box1.1.2", source: "business.classification", checkbox: { equals: "corporation" } },
  { pdf: "Check Box1.0.1", source: "business.classification", checkbox: { equals: "partnership" } },
  { pdf: "Check Box1.0.2", derived: "w9_class_llc", checkbox: {}, note: "LLC → Other box" },
  { pdf: "Other", derived: "business_type_other_label", note: "LLC classification on the Other line" },
  // Primary owner
  { pdf: "Title", const: "Owner", note: "owner title + signature-block title" },
  { pdf: "Equity", source: "owner.equity_pct" }, // #14
  { pdf: "Resident Address", source: "owner.home_street" }, // #19
  { pdf: "City_3", source: "owner.home_city" }, // #20
  { pdf: "State_3", source: "owner.home_state" }, // #21
  { pdf: "Zip_3", source: "owner.home_zip" }, // #22
  { pdf: "Date of Birth", source: "owner.dob", transform: "date_us" }, // #16
  { pdf: "Social Security", source: "owner.ssn" }, // #15 (decrypted at fill time only)
  { pdf: "Drivers License", source: "owner.drivers_license" }, // #17
  // Bank row (Name of Account = shared Corp Name)
  { pdf: "Bank Name", source: "bank.name" }, // #31
  { pdf: "Routing", source: "bank.routing" }, // #33 (also ACH + PO)
  { pdf: "Account", source: "bank.account_number" }, // #34 (decrypted at fill time only)
  // ATM setup (office-set) + defaults
  { pdf: "Surcharge", source: "atm.surcharge", transform: "currency", note: "shared: application + agreements" },
  { pdf: "Rebate", source: "atm.rebate", transform: "currency" },
  { pdf: "Check Box4.1", const: "Yes", checkbox: { equals: "Yes" }, note: "$20 denomination (default)" },
  { pdf: "ATM MakeModel", source: "atm.make_model" },
  { pdf: "Wireless Box", derived: "wireless_fee", note: "$25.95 monthly fee when wireless box required" },
  { pdf: "Forza Rep", source: "sales.rep_name" },

  // Processing agreement (CL p3 / ML p4)
  { pdf: "Day", derived: "send_day", note: "shared with cash-loading agreement date (CL)" },
  { pdf: "Month", derived: "send_month" },
  { pdf: "Year", derived: "send_year" },

  // ACH Authorization (CL p4 / ML p5)
  { pdf: "Check Box33", const: "Yes", checkbox: { equals: "Yes" }, note: "Vault Cash (always)" },
  { pdf: "Check Box34", const: "Yes", checkbox: { equals: "Yes" }, note: "Surcharge (always)" },
  { pdf: "Check Box35", derived: "wireless_selected", checkbox: {}, note: "Wireless" }, // #30
  { pdf: "Check Box41111.1", const: "Yes", checkbox: { equals: "Yes" }, note: "Changing existing account? No (default)" },
  { pdf: "Check Box36", const: "Yes", checkbox: { equals: "Yes" }, note: "Account Type: Checking (default)" },
  { pdf: "Check Box38", const: "Yes", checkbox: { equals: "Yes" }, note: "Accumulation: Lumped (default)" },

  // W-9 (CL p5 / ML p6) — classification per 2024 revision
  { pdf: "Check Box15.0.0", source: "business.classification", checkbox: { equals: "sole_prop" }, note: "Individual/sole proprietor" },
  { pdf: "Check Box15.0.1", source: "business.classification", checkbox: { equals: "corporation" }, note: "C corporation" },
  { pdf: "Check Box15.1.3", source: "business.classification", checkbox: { equals: "partnership" } },
  { pdf: "Check Box15.1.0", derived: "w9_class_llc", checkbox: {}, note: "LLC" },
  { pdf: "Text161.2", derived: "w9_llc_tax_code", note: "LLC tax classification code (S/C)" },
  { pdf: "Text42024w935235", derived: "send_date_us", note: "W-9 date" },

  // Purchase order (CL p6 / ML p7)
  { pdf: "ACH from Account on Record", const: "Yes", checkbox: { equals: "Yes" }, note: "default payment method" },
  { pdf: "Select one", const: "X", note: "PO ACH section: Checking (default)" },
  { pdf: "# of ATMs", source: "atm.count", note: "shared: PO + Schedule A (CL)" },
];

// W-9 per-digit TIN boxes. The field names are NOT in visual order — the
// mapping below is by measured x-position on the page (dump-fields.ts).
// Sole Prop → SSN digits; everyone else → EIN digits (Appendix C).
const w9SsnBoxOrder = ["3.0.0", "3.0.1", "3.0.2", "3.0.4", "3.0.5", "3.0.6", "3.0.7", "3.0.8", "3.0.9"];
const w9EinBoxOrder = ["3.1.0", "3.1.1", "3.1.3", "3.0.3", "3.1.5", "3.1.6", "3.1.7", "3.1.8", "3.1.9"];
const w9DigitBoxes: MapEntry[] = [
  ...w9SsnBoxOrder.map((suffix, i) => ({
    pdf: `Text${suffix}2024w9`,
    derived: "w9_tin_ssn",
    digitIndex: i,
  })),
  ...w9EinBoxOrder.map((suffix, i) => ({
    pdf: `Text${suffix}2024w9`,
    derived: "w9_tin_ein",
    digitIndex: i,
  })),
];

// ---------------------------------------------------------------------------
// CL packet extras: cash-loading agreement (p7) + Schedule A (p8), and its
// W-9 city/state/zip line.
// ---------------------------------------------------------------------------
const clOnly: MapEntry[] = [
  { pdf: "Text161.4", derived: "bank_city_state_zip", note: "W-9 line 6 — must match bank" },
  { pdf: "AutomatedTeller Machines in the", source: "atm.count", note: "cash-loading agreement: number of ATMs" },
  { pdf: "Cash Loader Name", source: "business.dba", note: "Schedule A header (per office markup)" },
  // Schedule A row 1 reuses shared Corp Name / Corp Address / # of ATMs /
  // Surcharge / Rebate; rows 2-4 stay office-filled.
];

// ---------------------------------------------------------------------------
// ML packet extras: ATM Source of Funds form (p3 — the merchant loads their
// own cash) and its two-line W-9 address fields.
// ---------------------------------------------------------------------------
const mlOnly: MapEntry[] = [
  { pdf: "EIN", source: "business.ein", note: "source-of-funds lines 5 & 21" },
  { pdf: "6 Type of Business (Sole Proprietor, Partnership, LLC, Corp, Financial Institution)", derived: "business_type_label" },
  { pdf: "11 Applicant F rst Name", derived: "owner_first_name" },
  { pdf: "12 Applicant Last Name", derived: "owner_last_name" },
  { pdf: "13 Applicant Home Physical Street Address", source: "owner.home_street" }, // #19
  { pdf: "14 Applicant Home C ty State Zip", derived: "owner_home_city_state_zip" }, // #20-22
  { pdf: "SSN", const: "Yes", checkbox: { equals: "Yes" }, note: "applicant ID number type: SSN" },
  { pdf: "15 Applicant Social Security Number", source: "owner.ssn" }, // #15
  { pdf: "16 Applicant Date of Birth mmddyyyy", source: "owner.dob", transform: "date_us" }, // #16
  { pdf: "17 Applicant Home or Mobile Phone Number", source: "owner.cell_phone", transform: "phone_us" }, // #18
  { pdf: "Business TaxID", derived: "tin_is_ein", checkbox: {}, note: "company TIN type: EIN unless sole prop" },
  { pdf: "22. Company Date of Incorporation", source: "business.start_date", transform: "date_us", note: "approximated by business start date — office verifies" },
  { pdf: "23. Company State of Incorporation", source: "location.state", note: "approximated by business state — office verifies" },
  // W-9 address lines (ML uses two fields where CL uses one + Text161.4)
  { pdf: "Corp Address 1", source: "bank.street", note: "W-9 line 5 + source-of-funds corp address — must match bank" },
  { pdf: "Corp Address 2", derived: "bank_city_state_zip", note: "W-9 line 6" },
];

// ---------------------------------------------------------------------------
// Signature placements. pdf-named where the packet has a field; measured
// coordinates where the signature line has none. Initials on the cover-sheet
// internet notice (x≈450, y≈255 p1) stay deferred with the M4 initials work.
// ---------------------------------------------------------------------------
const clSignatures: TemplateMap["signaturePlacements"] = [
  { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
  { kind: "signature", signer: "customer", page: 3, pdf: "By X", note: "processing agreement" },
  { kind: "signature", signer: "customer", page: 4, x: 95, y: 262, note: "ACH authorization" },
  { kind: "signature", signer: "customer", page: 5, x: 150, y: 196, note: "W-9" },
  { kind: "signature", signer: "customer", page: 6, x: 125, y: 104, note: "purchase order" },
  { kind: "signature", signer: "customer", page: 7, pdf: "Merchant Signature3", note: "cash-loading agreement" },
  { kind: "signature", signer: "forza", page: 2, pdf: "Sales Associate Signature" },
  { kind: "signature", signer: "forza", page: 3, pdf: "By X_2" },
  { kind: "signature", signer: "forza", page: 7, pdf: "LBS Signature2" },
];

const mlSignatures: TemplateMap["signaturePlacements"] = [
  { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
  { kind: "signature", signer: "customer", page: 3, pdf: "Signature", note: "source of funds — ATM operator" },
  { kind: "signature", signer: "customer", page: 4, pdf: "By X", note: "processing agreement" },
  { kind: "signature", signer: "customer", page: 5, x: 95, y: 262, note: "ACH authorization" },
  { kind: "signature", signer: "customer", page: 6, x: 150, y: 196, note: "W-9" },
  { kind: "signature", signer: "customer", page: 7, x: 125, y: 104, note: "purchase order" },
  { kind: "signature", signer: "forza", page: 2, pdf: "Sales Associate Signature" },
  { kind: "signature", signer: "forza", page: 3, pdf: "Signature_2" },
  { kind: "signature", signer: "forza", page: 4, pdf: "By X_2" },
];

/** ML packet — 13 pages (7 with form fields), includes Source of Funds. */
export const merchantLoadMap: TemplateMap = {
  code: "mo-ml-v1",
  programs: ["mo-ml"],
  name: "Merchant Owned / Merchant Load 2026",
  pageCount: 13,
  fields: [...shared, ...w9DigitBoxes, ...mlOnly],
  signaturePlacements: mlSignatures,
};

/** CL packet — 15 pages (8 with form fields), shared by MO/CL and PL/CL. */
export const cashLoadingMap: TemplateMap = {
  code: "cl-v1",
  programs: ["mo-cl", "pl-cl"],
  name: "Merchant Owned or Placement / Cash Loading",
  pageCount: 15,
  fields: [...shared, ...w9DigitBoxes, ...clOnly],
  signaturePlacements: clSignatures,
};

export const templateMaps: TemplateMap[] = [merchantLoadMap, cashLoadingMap];

export function templateMapForProgram(programCode: string): TemplateMap | undefined {
  return templateMaps.find((t) => t.programs.includes(programCode));
}
