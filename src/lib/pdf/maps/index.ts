import { MapEntry, TemplateMap } from "../types";

/**
 * Field maps VERIFIED against the real packet PDFs in templates/blanks/
 * (inspected with scripts/dump-fields.ts). The office manager's 1–38
 * numbering appears in comments as #n.
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
 *
 * The PAI and DNS packets are the same forms except for the ACH page (PAI
 * Exhibit 3 vs. the DNS ACH Authorization Agreement) and, for merchant-
 * loaded ATMs, the source-of-funds pages (PAI Exhibit 2 vs. Security First
 * Bank's two-page SOFP agreement): 168 of the field names are identical
 * across all of them, so the maps below are built from shared pieces.
 */

/**
 * Bump when the in-repo maps change: `npm run sync:maps` re-seeds any
 * template row whose stored map came from the repo (map_source 'repo' or
 * legacy NULL) and is older than this. Office-edited maps ('custom') are
 * never auto-updated.
 */
export const MAP_VERSION = 6;

// ---------------------------------------------------------------------------
// Shared fields — identical names in every packet (cover sheet, application,
// processing agreement, W-9 TIN boxes, purchase order).
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
  // Cover-sheet blanks with no form field (coordinates measured from the PDF;
  // the DNS cover sheet has the same layout):
  { pdf: "__wireless_answer", derived: "wireless_yes_no", coord: { page: 1, x: 270, y: 230 }, note: "'Do you require wireless ATM Cellular Box?' written answer" }, // #30
  { pdf: "__subflooring_wood", source: "install.subflooring", checkbox: { equals: "wood" }, coord: { page: 1, x: 58, y: 172 } }, // #29
  { pdf: "__subflooring_cement", source: "install.subflooring", checkbox: { equals: "cement" }, coord: { page: 1, x: 58, y: 155 } },

  // Application (p2) — header
  { pdf: "Date", derived: "send_date_us", note: "shared: application header + PO date (+ DNS ACH date)" },
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

  // Processing agreement (CL p3 / ML p4–5)
  { pdf: "Day", derived: "send_day", align: "center", note: "shared with cash-loading agreement date (CL)" },
  { pdf: "Month", derived: "send_month" },
  { pdf: "Year", derived: "send_year", align: "center", note: "blank is pre-printed 20__" },

  // W-9 — classification per 2024 revision
  { pdf: "Check Box15.0.0", source: "business.classification", checkbox: { equals: "sole_prop" }, note: "Individual/sole proprietor" },
  { pdf: "Check Box15.0.1", source: "business.classification", checkbox: { equals: "corporation" }, note: "C corporation" },
  { pdf: "Check Box15.1.3", source: "business.classification", checkbox: { equals: "partnership" } },
  { pdf: "Check Box15.1.0", derived: "w9_class_llc", checkbox: {}, note: "LLC" },
  { pdf: "Text161.2", derived: "w9_llc_tax_code", note: "LLC tax classification code (S/C)" },
  { pdf: "Text42024w935235", derived: "send_date_us", note: "W-9 date" },

  // Purchase order
  { pdf: "ACH from Account on Record", const: "Yes", checkbox: { equals: "Yes" }, note: "default payment method" },
  { pdf: "Select one", const: "X", note: "PO ACH section: Checking (default)" },
  { pdf: "# of ATMs", source: "atm.count", note: "shared: PO + Schedule A (CL)" },
  { pdf: "Item DescriptionRow1", source: "atm.make_model", note: "PO item line" },
  { pdf: "Price PerRow1", source: "atm.price", transform: "currency", note: "PO unit price — office-set" },
  { pdf: "AmountRow1", derived: "atm_amount", note: "PO line total: count × price" },
];

// PAI Exhibit 3 — ACH Authorization Form checkboxes.
const paiAch: MapEntry[] = [
  { pdf: "Check Box33", const: "Yes", checkbox: { equals: "Yes" }, note: "Vault Cash (always)" },
  { pdf: "Check Box34", const: "Yes", checkbox: { equals: "Yes" }, note: "Surcharge (always)" },
  { pdf: "Check Box35", derived: "wireless_selected", checkbox: {}, note: "Wireless" }, // #30
  { pdf: "Check Box41111.1", const: "Yes", checkbox: { equals: "Yes" }, note: "Changing existing account? No (default)" },
  { pdf: "Check Box36", const: "Yes", checkbox: { equals: "Yes" }, note: "Account Type: Checking (default)" },
  { pdf: "Check Box38", const: "Yes", checkbox: { equals: "Yes" }, note: "Accumulation: Lumped (default)" },
];

// DNS — ACH Authorization Agreement (its own form; the shared "Date" field
// also has a widget on it). Bank contact / branch / telephone stay with the
// office — the dictionary has no such fields. The cash-loading packets carry
// form fields on this page; the merchant-loaded packet's copy of the same
// page has none, so it takes the same values at the measured positions.
const dnsAchFields: MapEntry[] = [
  { pdf: "Text1.0", source: "business.legal_name", note: "DNS ACH: Business Name" },
  { pdf: "Text1.1", source: "bank.name", note: "DNS ACH: Bank Name" }, // #31
  { pdf: "Text1.3", const: "Checking", note: "DNS ACH: Account Type (default)" },
  { pdf: "Text1.7", source: "bank.account_name", note: "DNS ACH: Name on Account" }, // #32
  { pdf: "Text1.4", source: "bank.routing", note: "DNS ACH: Transit / ABA Number" }, // #33
  { pdf: "Text1.8", source: "bank.account_number", note: "DNS ACH: Account Number" }, // #34
];
const dnsAchCoords = (page: number): MapEntry[] => [
  { pdf: "__dns_ach_business_name", source: "business.legal_name", coord: { page, x: 112, y: 627, size: 9 }, note: "DNS ACH: Business Name (no field)" },
  { pdf: "__dns_ach_bank_name", source: "bank.name", coord: { page, x: 103, y: 603, size: 9 }, note: "DNS ACH: Bank Name" },
  { pdf: "__dns_ach_account_type", const: "Checking", coord: { page, x: 282, y: 555, size: 9 }, note: "DNS ACH: Account Type (default)" },
  { pdf: "__dns_ach_account_name", source: "bank.account_name", coord: { page, x: 369, y: 531, size: 9 }, note: "DNS ACH: Name on Account" },
  { pdf: "__dns_ach_routing", source: "bank.routing", coord: { page, x: 138, y: 508, size: 9 }, note: "DNS ACH: Transit / ABA Number" },
  { pdf: "__dns_ach_account_number", source: "bank.account_number", coord: { page, x: 352, y: 507, size: 9 }, note: "DNS ACH: Account Number" },
];
// The DNS blanks shipped with "Saving" pre-checked on the application's bank
// row; a const that resolves false clears it in case a re-upload brings it
// back.
const dnsCommon: MapEntry[] = [
  { pdf: "Saving", const: "No", checkbox: { equals: "Yes" }, note: "application bank row: never pre-check Savings" },
];
// The shared "Date" field also has a 69pt-wide widget on the DNS ACH page,
// where the auto-sized date clips to "11/06/" — pin its size.
const dnsShared = (fields: MapEntry[]): MapEntry[] =>
  fields.map((e) => (e.pdf === "Date" ? { ...e, fontSize: 9 } : e));

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

// W-9 address lines come in two flavours across the packets: one combined
// city/state/zip field (PAI CL, DNS CL) or two address fields (PAI ML, DNS
// ML, PAI tiered). Both must match the BANK account address (#35–38).
const w9AddressOneLine: MapEntry[] = [
  { pdf: "Text161.4", derived: "bank_city_state_zip", note: "W-9 line 6 — must match bank" },
];
const w9AddressTwoLines: MapEntry[] = [
  { pdf: "Corp Address 1", source: "bank.street", note: "W-9 line 5 (+ source-of-funds corp address) — must match bank" },
  { pdf: "Corp Address 2", derived: "bank_city_state_zip", note: "W-9 line 6" },
];

// ---------------------------------------------------------------------------
// Cash-loading packets: ATM Cash Loading Agreement + Schedule A.
// ---------------------------------------------------------------------------
const cashLoading: MapEntry[] = [
  { pdf: "AutomatedTeller Machines in the", source: "atm.count", note: "cash-loading agreement: number of ATMs" },
  { pdf: "years", source: "atm.loading_term_years", align: "center", note: "cash-loading agreement: initial term (blank pre-printed 2)" },
  { pdf: "Cash Loader Name", source: "business.dba", note: "Schedule A header (per office markup)" },
  // Schedule A row 1 reuses shared Corp Name / Corp Address / # of ATMs /
  // Surcharge / Rebate; rows 2-4 stay office-filled.
];

// PAI placement, flat rebate (pl-cl-v2): the processing agreement's "After
// Installation" item 1 and the cash-loading agreement's rebate paragraph
// carry blanks for the retained transaction count (100 / 150 / 200, the
// office's choice), the rebate and the surcharge.
const placementFlat: MapEntry[] = [
  { pdf: "Retained Transactions 1", derived: "retained_transactions_words", fontSize: 7.5, note: "p3 item 1: no rebate on the first N transactions" },
  { pdf: "Retained Transactions 2", derived: "retained_transactions_words", fontSize: 7.5, note: "p3 item 1: rebate starts after the first N" },
  { pdf: "Rebate p3", source: "atm.rebate", transform: "currency", fontSize: 8 },
  { pdf: "Surcharge p3", source: "atm.surcharge", transform: "currency", fontSize: 8 },
  { pdf: "Rebate p7", source: "atm.rebate", transform: "currency", fontSize: 11, note: "cash-loading agreement rebate paragraph" },
  { pdf: "Surcharge p7", source: "atm.surcharge", transform: "currency", fontSize: 11 },
];

// PAI placement, tiered-rebate variant: the flat-rebate paragraph is
// replaced by three volume bands on the processing agreement (p3) and the
// cash-loading agreement (p7). "Tier2 Rebate p3" is the 250–499 blank on p3,
// which the packet shipped as a widget of the shared "Surcharge" field; it
// was split into its own field when the blank was prepared.
const tiered: MapEntry[] = [
  { pdf: "Rebate234234.0.0", source: "atm.surcharge", transform: "currency", note: "p3 tiered paragraph: surcharge" },
  { pdf: "Rebate234234.0.1", source: "atm.rebate_tier1", transform: "currency", note: "p3: 1–249 transactions" },
  { pdf: "Tier2 Rebate p3", source: "atm.rebate_tier2", transform: "currency", note: "p3: 250–499 transactions" },
  { pdf: "Rebate234234.1.0", source: "atm.rebate_tier3", transform: "currency", note: "p3: 500+ transactions" },
  { pdf: "Text1345354tw34rtg.0.0", source: "atm.surcharge", transform: "currency", note: "p7 tiered paragraph: surcharge" },
  { pdf: "Text1345354tw34rtg.0.1", source: "atm.rebate_tier1", transform: "currency", note: "p7: 1–249 transactions" },
  { pdf: "Text1345354tw34rtg.1.1", source: "atm.rebate_tier2", transform: "currency", note: "p7: 250–499 transactions" },
  { pdf: "Text1345354tw34rtg.1.0", source: "atm.rebate_tier3", transform: "currency", note: "p7: 500+ transactions" },
];

// ---------------------------------------------------------------------------
// Merchant-loaded packets: the merchant is the ATM operator and source of
// funds, so the sponsor bank's form is included.
// ---------------------------------------------------------------------------

// PAI Exhibit 2 — ATM Operator / Source of Funds Provider Declaration (p3).
const paiSourceOfFunds: MapEntry[] = [
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
];

// Security First Bank — ATM Operator / Source of Funds Provider Agreement
// (DNS merchant-loaded, pp. 3–4). Terminal ID, FI number and merchandise
// sold stay with the office.
const sfbSourceOfFunds: MapEntry[] = [
  { pdf: "Group1", derived: "sofp_applicant_individual", note: "radio: Applicant is an Individual / Sole Proprietor (Section C)" },
  { pdf: "Group2", derived: "sofp_applicant_company", note: "radio: Applicant is a Company (Section D)" },
  { pdf: "Group3", const: "Choice3", note: "radio: Both ATM Operator and ATM Source of Funds Provider" },
  { pdf: "1 Name of Location Doing Business As", source: "business.dba" }, // #5
  { pdf: "2 Physical Street Address of Location", source: "location.street" }, // #6
  { pdf: "3 City State Zip of Location", derived: "business_city_state_zip" }, // #7-9
  { pdf: "4 Location Phone Number", source: "location.phone", transform: "phone_us" }, // #10
  { pdf: "5 Business Tax ID Number of Merchant", source: "business.ein" }, // #3
  { pdf: "Text1", derived: "business_type_label", note: "6. Type of Business" }, // #4
  { pdf: "10 Processor of deployed terminal", const: "Digital Network Solutions" },
  { pdf: "11 Applicant First Name", derived: "owner_first_name" },
  { pdf: "12 Applicant Last Name", derived: "owner_last_name" },
  { pdf: "13 Applicant Home Physical Street Address", source: "owner.home_street" }, // #19
  { pdf: "14 Applicant Home City State Zip", derived: "owner_home_city_state_zip" }, // #20-22
  { pdf: "15 Applicant Social Security Number", source: "owner.ssn" }, // #15
  { pdf: "16 Applicant Date of Birth MMDDYYYY", source: "owner.dob", transform: "date_us" }, // #16
  { pdf: "17 Applicant Home or Mobile Phone Number", source: "owner.cell_phone", transform: "phone_us" }, // #18
  { pdf: "18 Company Legal Name as stated on Articles of Incorporation", source: "business.legal_name" }, // #2
  { pdf: "19 Company Address as stated on Articles of Incorporation", source: "location.street", note: "approximated by business address — office verifies against the Articles" },
  { pdf: "20 Company City State Zip as stated on Articles of Incorporation", derived: "business_city_state_zip" },
  { pdf: "21 Company Federal Employer Identification Number FEIN", source: "business.ein" }, // #3
  // Section E signature block (p4): operator on the left, ISO on the right.
  { pdf: "Name", source: "owner.legal_name", note: "Section E: ATM Operator print name" },
  { pdf: "TitleDate", derived: "owner_title_date", note: "Section E: Title/Date" },
  { pdf: "Name_1", const: "Forza Payments, Inc.", note: "Section E: ISO print name" },
];

// ---------------------------------------------------------------------------
// Signature placements. pdf-named where the packet has a field; measured
// coordinates where the signature line has none. Initials on the cover-sheet
// internet notice (x≈450, y≈255 p1) stay deferred with the M4 initials work.
// ---------------------------------------------------------------------------
const paiClSignatures: TemplateMap["signaturePlacements"] = [
  { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
  { kind: "signature", signer: "customer", page: 3, pdf: "By X", note: "processing agreement" },
  { kind: "signature", signer: "customer", page: 4, x: 95, y: 244, note: "ACH authorization" },
  { kind: "signature", signer: "customer", page: 5, x: 150, y: 196, note: "W-9" },
  { kind: "signature", signer: "customer", page: 6, x: 160, y: 104, width: 140, note: "purchase order" },
  { kind: "signature", signer: "customer", page: 7, pdf: "Merchant Signature3", note: "cash-loading agreement" },
  { kind: "signature", signer: "forza", page: 2, pdf: "Sales Associate Signature" },
  { kind: "signature", signer: "forza", page: 3, pdf: "By X_2" },
  { kind: "signature", signer: "forza", page: 7, pdf: "LBS Signature2" },
];

const paiMlSignatures: TemplateMap["signaturePlacements"] = [
  { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
  { kind: "signature", signer: "customer", page: 3, pdf: "Signature", note: "source of funds — ATM operator" },
  { kind: "signature", signer: "customer", page: 4, pdf: "By X", note: "processing agreement" },
  { kind: "signature", signer: "customer", page: 5, x: 95, y: 244, note: "ACH authorization" },
  { kind: "signature", signer: "customer", page: 6, x: 150, y: 196, note: "W-9" },
  { kind: "signature", signer: "customer", page: 7, x: 160, y: 104, width: 140, note: "purchase order" },
  { kind: "signature", signer: "forza", page: 2, pdf: "Sales Associate Signature" },
  { kind: "signature", signer: "forza", page: 3, pdf: "Signature_2" },
  { kind: "signature", signer: "forza", page: 4, pdf: "By X_2" },
];

// DNS ACH Authorization Agreement: "Owner/Officer Signature: ____" has no
// field; line measured at x≈194–430, baseline y≈167.
const dnsAchSignature = { x: 196, y: 166, width: 220, note: "DNS ACH authorization" };

const dnsClSignatures: TemplateMap["signaturePlacements"] = [
  { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
  { kind: "signature", signer: "customer", page: 3, pdf: "By X", note: "processing agreement" },
  { kind: "signature", signer: "customer", page: 4, ...dnsAchSignature },
  { kind: "signature", signer: "customer", page: 5, x: 150, y: 196, note: "W-9" },
  { kind: "signature", signer: "customer", page: 6, x: 160, y: 104, width: 140, note: "purchase order" },
  { kind: "signature", signer: "customer", page: 7, pdf: "Merchant Signature3", note: "cash-loading agreement" },
  { kind: "signature", signer: "forza", page: 2, pdf: "Sales Associate Signature" },
  { kind: "signature", signer: "forza", page: 3, pdf: "By X_2" },
  { kind: "signature", signer: "forza", page: 7, pdf: "LBS Signature2" },
];

const dnsMlSignatures: TemplateMap["signaturePlacements"] = [
  { kind: "signature", signer: "customer", page: 2, pdf: "Owner Signature" },
  { kind: "signature", signer: "customer", page: 4, pdf: "Signature", note: "SFB source of funds — ATM operator" },
  { kind: "signature", signer: "customer", page: 5, pdf: "By X", note: "processing agreement" },
  { kind: "signature", signer: "customer", page: 6, ...dnsAchSignature },
  { kind: "signature", signer: "customer", page: 7, x: 150, y: 196, note: "W-9" },
  { kind: "signature", signer: "customer", page: 8, x: 160, y: 104, width: 140, note: "purchase order" },
  { kind: "signature", signer: "forza", page: 2, pdf: "Sales Associate Signature" },
  { kind: "signature", signer: "forza", page: 4, pdf: "Signature_1", note: "SFB source of funds — ISO" },
  { kind: "signature", signer: "forza", page: 5, pdf: "By X_2" },
];

// ---------------------------------------------------------------------------
// The maps.
// ---------------------------------------------------------------------------

/** PAI merchant-loaded packet — 7 pages, includes Exhibit 2 Source of Funds. */
export const merchantLoadMap: TemplateMap = {
  code: "mo-ml-v1",
  programs: ["mo-ml"],
  name: "PAI – Merchant-Owned / Merchant-Loaded 2026",
  pageCount: 7,
  fields: [...shared, ...paiAch, ...w9DigitBoxes, ...paiSourceOfFunds, ...w9AddressTwoLines],
  signaturePlacements: paiMlSignatures,
};

/** PAI merchant-owned, Forza-loaded packet — 8 pages. */
export const cashLoadingMap: TemplateMap = {
  code: "cl-v1",
  programs: ["mo-cl"],
  name: "PAI – Merchant-Owned / Third-Party Cash Loading",
  pageCount: 8,
  fields: [...shared, ...paiAch, ...w9DigitBoxes, ...w9AddressOneLine, ...cashLoading],
  signaturePlacements: paiClSignatures,
};

/**
 * PAI placement, flat rebate — 8 pages. Built from the tiered packet (the
 * only PAI packet with the placement agreement) with the flat paragraphs
 * and fillable blanks, so it shares that packet's W-9 layout.
 */
export const placementMap: TemplateMap = {
  code: "pl-cl-v2",
  programs: ["pl-cl"],
  name: "PAI – Placement / Cash Loading",
  pageCount: 8,
  fields: [...shared, ...paiAch, ...w9DigitBoxes, ...w9AddressTwoLines, ...cashLoading, ...placementFlat],
  signaturePlacements: paiClSignatures,
};

/** PAI placement, tiered-rebate variant — 8 pages. */
export const tieredCashLoadingMap: TemplateMap = {
  code: "pl-cl-tiered-v1",
  programs: ["pl-cl"],
  variant: "tiered",
  name: "PAI – Placement / Cash Loading (tiered rebate)",
  pageCount: 8,
  fields: [...shared, ...paiAch, ...w9DigitBoxes, ...w9AddressTwoLines, ...cashLoading, ...tiered],
  signaturePlacements: paiClSignatures,
};

/**
 * DNS placement packet — 8 pages. Its equipment row prints the wireless-box
 * fee as text ("if needed, $25.95 monthly"), so there is no "Wireless Box"
 * field to fill.
 */
export const dnsPlacementMap: TemplateMap = {
  code: "dns-pl-cl-v1",
  programs: ["dns-pl-cl"],
  name: "DNS – Placement / Cash Loading",
  pageCount: 8,
  fields: [
    ...dnsShared(shared.filter((e) => e.pdf !== "Wireless Box")),
    ...dnsCommon,
    ...dnsAchFields,
    ...w9DigitBoxes,
    ...w9AddressOneLine,
    ...cashLoading,
  ],
  signaturePlacements: dnsClSignatures,
};

/** DNS merchant-owned, Forza-loaded packet — 8 pages. */
export const dnsMerchantOwnedCashLoadingMap: TemplateMap = {
  code: "dns-mo-cl-v1",
  programs: ["dns-mo-cl"],
  name: "DNS – Merchant-Owned / Third-Party Cash Loading",
  pageCount: 8,
  fields: [...dnsShared(shared), ...dnsCommon, ...dnsAchFields, ...w9DigitBoxes, ...w9AddressOneLine, ...cashLoading],
  signaturePlacements: dnsClSignatures,
};

/** DNS merchant-loaded packet — 8 pages, includes Security First Bank's SOFP agreement. */
export const dnsMerchantLoadMap: TemplateMap = {
  code: "dns-mo-ml-v1",
  programs: ["dns-mo-ml"],
  name: "DNS – Merchant-Owned / Merchant-Loaded",
  pageCount: 8,
  fields: [...dnsShared(shared), ...dnsCommon, ...dnsAchCoords(6), ...w9DigitBoxes, ...w9AddressTwoLines, ...sfbSourceOfFunds],
  signaturePlacements: dnsMlSignatures,
};

export const templateMaps: TemplateMap[] = [
  merchantLoadMap,
  cashLoadingMap,
  placementMap,
  tieredCashLoadingMap,
  dnsPlacementMap,
  dnsMerchantOwnedCashLoadingMap,
  dnsMerchantLoadMap,
];

/** The in-repo map for a program's template variant ("standard" unless the row says otherwise). */
export function templateMapForProgram(
  programCode: string,
  variant: string = "standard"
): TemplateMap | undefined {
  return templateMaps.find(
    (t) => t.programs.includes(programCode) && (t.variant ?? "standard") === variant
  );
}
