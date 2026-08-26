# Build Plan: Forza Application & E-Signature Platform

**Project codename:** `forza-sign`
**Owner:** Zach Lee, Forza Payments, Inc.
**Goal:** Replace the current worksheet → manual re-entry → SignNow workflow with a single self-hosted web app: customers fill a worksheet online, the office reviews/corrects it, the data auto-populates the correct ATM application variant, and the customer signs it through Forza's own embedded e-signature flow. No per-document fees, no SignNow subscription.

---

## 1. Current Workflow (what we're replacing)

1. Office emails a fillable PDF worksheet (no signature fields) to the customer.
2. Customer fills it out — often with mistakes or missing info — and emails it back.
3. Office manager manually re-types the worksheet data into one of **4–6 fillable ATM application PDFs** (the variant depends on which ATM program the customer chose).
4. Office uploads the filled application to SignNow and sends it out for signature.

**Pain points:** double data entry, worksheet errors discovered late, manual variant selection, SignNow costs, no single source of truth.

## 2. Target Workflow

1. Office (or the website) sends the customer a unique link to a **web worksheet form** on Forza's site. Strong inline validation catches most errors at entry time.
2. Submission appears in an **admin dashboard**. Office reviews the data, edits/corrects any field, and can add internal-only fields the customer doesn't see.
3. Office picks the **ATM program**, and the app auto-populates the matching application template from the worksheet data. Office previews the filled application and can override any field before sending.
4. One click sends the customer a signing link. The customer opens an **embedded signing page** (on Forza's domain), consents to e-signature, reviews the filled application, signs/initials/dates, and submits.
5. The app flattens the final PDF, appends an audit-trail certificate page, stores it, and emails the executed copy to the customer and the office. Status is tracked end to end (draft → sent → viewed → signed → completed).

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | **Next.js 14+ (App Router, TypeScript)** | Single app: public forms, signing pages, admin dashboard, API routes |
| Database / Auth / Storage | **Supabase** | Postgres + RLS, Supabase Auth for office staff, Storage buckets for PDFs |
| Hosting | **Vercel** | Custom domain, e.g. `apply.forzapayments.com`; embeddable/linkable from the main site |
| PDF generation | **pdf-lib** | Fill AcroForm fields of existing fillable PDFs AND/OR draw onto coordinates; flatten on completion |
| Signature capture | **signature_pad** | Draw-to-sign canvas; also offer typed signature (cursive font render) |
| Email | **Resend** (or existing SMTP) | Worksheet invites, signing requests, reminders, executed copies |
| Validation | **Zod** | Shared schemas between customer form, admin edit form, and API |

Everything above is free/open-source or free-tier friendly; the only recurring costs are hosting (likely $0–20/mo) and email volume.

## 4. Core Design: One Field Dictionary, Many Templates

This is the key architectural decision. Do **not** hard-code 6 separate forms.

- Define a **canonical field dictionary** — every piece of data Forza collects, once, with a stable key: `business.legal_name`, `business.dba`, `business.ein`, `owner.first_name`, `owner.ssn_last4`, `location.address`, `bank.routing_number`, `atm.program_type`, `atm.surcharge_amount`, etc. (Exact inventory comes from the sample documents — see §10.)
- The **worksheet** is a web form whose questions map 1:1 to dictionary keys.
- Each **application variant** (4–6 ATM programs) is a `template` record: a stored fillable PDF + a JSON **field map** of `{ pdf_field_name → dictionary_key }` (or `{x, y, page}` coordinates for non-AcroForm PDFs), plus its signature/initial/date placements.
- Prefill = take the reviewed worksheet data, run it through the variant's field map, fill the PDF. Adding a 7th program later means uploading a PDF and creating a mapping in the admin UI — **no code changes**.
- Include an admin **template mapper screen** (stretch goal, Phase 4): render the PDF, list its detected form fields, and let staff assign dictionary keys via dropdowns. Until then, mappings live in seeded JSON.

## 5. Data Model (Supabase / Postgres)

```
organizations        -- future-proofing; single row "Forza" for now
staff_users          -- Supabase Auth users; role: admin | staff
customers            -- business name, contact name, email, phone
programs             -- the 4-6 ATM programs (name, description, active)
templates            -- program_id, version, storage_path (blank PDF), field_map JSONB,
                        signature_placements JSONB, active
field_definitions    -- canonical dictionary: key, label, type, validation rules,
                        required_for (which programs), section, help_text
worksheets           -- customer_id, status (sent|in_progress|submitted|reviewed),
                        data JSONB (keyed by dictionary keys), submitted_at,
                        review_notes, edited_by, edited_at
worksheet_links      -- worksheet_id, token (unique, expiring), opened_at
applications         -- worksheet_id, program_id, template_id,
                        data JSONB (worksheet data + office overrides),
                        status (draft|sent|viewed|signed|completed|voided|declined),
                        filled_pdf_path, final_pdf_path, sha256_final
signers              -- application_id, name, email, order, status,
                        signing token (unique, expiring), consent_given_at,
                        signed_at, signature_image_path, ip, user_agent
audit_events         -- application_id, signer_id?, event_type
                        (created|sent|email_delivered|opened|consented|field_signed|
                         signed|completed|edited|voided), ip, user_agent, ts, meta JSONB
email_log            -- what was sent, to whom, when, provider message id
```

**RLS:** staff tables locked to authenticated staff. Customer-facing access (worksheet fill, signing) happens **only** through server-side routes that validate the unguessable token — customers never get Supabase credentials. Storage buckets are private; files served via short-lived signed URLs.

## 6. Feature Spec by Surface

### 6.1 Customer worksheet form (public, token-gated)
- Clean multi-step form (grouped sections: Business Info, Owner Info, Location, Banking, ATM Preferences), mobile-friendly, Forza-branded.
- Inline validation from `field_definitions`: EIN format, routing number checksum (ABA mod-10), phone/email formats, ZIP lookup, required fields per program if known. This alone kills most of the "customer filled it out wrong" problem.
- Save-and-resume (progress persisted per token), review-before-submit summary screen.
- On submit: status → `submitted`, office notified by email.

### 6.2 Admin dashboard (staff login)
- Queue views: new worksheet submissions, applications awaiting signature, completed.
- **Worksheet review screen:** every submitted value shown in an editable form (same validation), diff-style highlight of fields the office changed, review notes, mark as `reviewed`.
- **Create application:** pick program → app selects the template → auto-populate → side-by-side preview (live-filled PDF viewer) with an editable field panel → send for signature.
- Customer record page: all worksheets, applications, statuses, timeline of audit events.
- Manual entry path: office can create a worksheet on the customer's behalf (paper/phone customers).
- Resend link, void application, and "revise & resend" (creates new version, voids old).

### 6.3 Signing experience (public, token-gated, on Forza's domain)
- Landing: what the document is, who requested it, **ESIGN consent** checkbox with disclosure text (required before viewing/signing; logged with timestamp/IP).
- Document viewer: the filled PDF rendered page by page; required signature/initial/date fields flagged and navigable ("Start" → jump to next field).
- Signature modal: draw (signature_pad) or type (rendered in cursive font); saved and reusable across fields in the same session.
- Finish: "adopt and sign" confirmation → server stamps signature images + dates into the PDF, flattens it, computes SHA-256, appends an **audit certificate page** (document hash, all events, IPs, timestamps, signer emails), stores final PDF.
- Completion screen with download; executed copy emailed to signer and office.
- Optional decline-with-reason.

### 6.4 Notifications & automation
- Emails: worksheet invite, worksheet received (to office), signing request, reminder (auto after N days, configurable), completed (both parties).
- All emails from Forza's domain (SPF/DKIM via Resend), branded template.

## 7. E-Signature Legal Compliance (ESIGN / UETA)

Build these in as first-class requirements, not afterthoughts:
1. **Consent:** explicit consent-to-do-business-electronically disclosure, checkbox, logged.
2. **Intent & attribution:** unique emailed signing token per signer; every action logged with IP + user agent + timestamp.
3. **Audit trail:** immutable `audit_events` for the full lifecycle; rendered as a certificate page appended to the executed PDF.
4. **Integrity:** final PDF flattened (fields no longer editable), SHA-256 hash stored and printed on the certificate.
5. **Retention & access:** executed copy emailed to signer and permanently downloadable via their link; indefinite storage in Supabase.
6. Signer name/email confirmation step before signing ("I am [Name]").

*(Note for Zach: this covers standard US ESIGN/UETA practice — the same basis SignNow relies on — but have your processor/bank sponsor confirm they'll accept applications signed this way before fully cutting over. Not legal advice.)*

## 8. Build Phases (for Claude Code)

### Phase 0 — Foundation (½ day)
- Next.js + TypeScript project, Supabase project, schema migrations for §5, RLS policies, Supabase Auth for staff, Storage buckets (`templates`, `filled`, `final`, `signatures`), Vercel deploy, env setup.
- Seed: Forza org, 1 admin user, the 4–6 programs.

### Phase 1 — Worksheet pipeline (the biggest immediate win)
- Field dictionary + Zod schemas — **already specified in Appendix A**; implement as seed data.
- Customer worksheet form with token links, validation, save/resume, submit.
- Admin dashboard: auth, submission queue, review/edit screen, manual-entry path.
- Email: invite + submission notifications.
- **Deliverable checkpoint:** office stops re-typing worksheet data. (If needed, a temporary "download filled application PDF" button lets the office keep using SignNow for signing until Phase 3 ships.)

### Phase 2 — Template engine & prefill
- Template storage + field-map JSON per program variant — **the first two variants (ML and CL packets) are fully mapped in Appendix B**, including PDF AcroForm field names, constants, defaults, and conditional logic (Appendix C).
- pdf-lib fill service: inspect AcroForm fields, apply mapping, generate filled PDF; coordinate-based fallback for flat PDFs.
- Program selection → auto-populate → preview screen with override panel.
- Map all 4–6 application variants; unit tests asserting every mapped field lands correctly for each template.

### Phase 3 — E-signature
- Signer records, signing tokens, consent flow, PDF viewer with field navigation, signature_pad capture, typed-signature option.
- Server-side stamping, flattening, hashing, audit certificate page, final storage.
- Status lifecycle + audit events + completion emails. Reminder cron (Vercel cron).
- **Deliverable checkpoint:** SignNow cancelled.

### Phase 4 — Polish & leverage
- Admin template mapper UI (upload new PDF, map fields visually).
- Multi-signer support (e.g., Forza countersignature), user roles, dashboards/metrics, webhook or Zapier-style notifications, optional embed of the worksheet form on the main Forza site via iframe/link.

## 9. Testing & Verification (each phase)
- Zod schema unit tests; ABA routing checksum tests.
- Per-template snapshot tests: fill with fixture data → assert PDF field values (pdf-lib re-read) or rendered-page image diff.
- E2E (Playwright): worksheet fill → office edit → prefill → sign → verify final PDF exists, is flattened, hash matches, audit page present.
- Security checks: expired/used tokens rejected; RLS verified with anon key; no PDF accessible without signed URL.

## 10. Source Documents (received — analyzed in Appendices A–C)
Zach provided three PDFs, which are the source of truth for Appendices A–C:
1. **`worksheet.pdf`** — "Information Required for ATM Application" (2 pages, AcroForm, 34 fields). The customer-facing worksheet.
2. **`blank-app.pdf`** — "Forza PAI Merchant Owned / Merchant Load Agreement 2026" (7 pages, AcroForm, 228 fields). One full application variant, blank.
3. **`mapped-app.pdf`** — "Merchant Owned or Placement / Cash Loading" application (8 pages, scanned) hand-annotated by the office manager: she numbered every worksheet field **1–38** and wrote those numbers onto every application blank where that data lands. This numbering is adopted as the canonical reference below.

Still needed from Zach (non-blocking — placeholders fine until then):
- The remaining program-variant PDFs and the definitive list of program names (known so far: *Merchant Owned / Merchant Load*, *Merchant Owned / Cash Loading*, *Placement / Cash Loading* — the two cash-loading variants appear to share the same application per the office manager's note).
- Consent/disclosure language for the signing page (use standard ESIGN boilerplate as placeholder).
- Sending email address/domain (e.g., `sign@forzapayments.com`).

---

## Appendix A — Canonical Field Dictionary (from the actual worksheet)

Numbers are the office manager's canonical IDs (keep them in the DB as `legacy_num` — the office thinks in these numbers). **Important design change:** the paper worksheet collects addresses as single lines; the web form must collect them as **components** (street / city / state / zip) because the applications need them split (#6–9, #19–22, #35–38).

### Business Information
| # | Key | Label | Type / Validation |
|---|---|---|---|
| 1 | `business.open_date` | Business Opening Date | date; if future → "opening soon" flag; app cover sheet also has "Already Open" checkbox (derive: open_date ≤ today) |
| 2 | `business.legal_name` | Full Legal Name of Business | text, required |
| 3 | `business.ein` | Tax I.D. / EIN # | EIN format `XX-XXXXXXX` (or SSN for sole prop — see W-9 logic, App. C) |
| 4 | `business.classification` | Business Classification | select: LLC–S Corp, LLC–C Corp, Corporation, Partnership, Sole Proprietor (drives app checkboxes + W-9 box 3a) |
| 5 | `business.dba` | DBA Name of Business | text, required |
| 6 | `location.street` | Business Address — street | text, required |
| 7 | `location.city` | Business Address — city | text, required |
| 8 | `location.state` | Business Address — state | US state select |
| 9 | `location.zip` | Business Address — zip | 5-digit zip |
| 10 | `location.phone` | Business Phone Number | US phone |
| 11 | `business.start_date` | Business Start Date | date — *office manager renamed this from "Years in Business" on the worksheet; the web form should ask for the start date and derive years in business* |
| 12 | `location.years_at_location` | Years at Location | number |

### Business Owner's Information
| # | Key | Label | Type / Validation |
|---|---|---|---|
| 13 | `owner.legal_name` | Owner's Legal Name | text, required (also used as signer name + print-name on every signature block) |
| 14 | `owner.equity_pct` | Percentage of Ownership | number 0–100 |
| 15 | `owner.ssn` | Owner's SSN | SSN format — **encrypt at rest, mask in UI (show last 4), exclude from emails/logs** |
| 16 | `owner.dob` | Owner's Date of Birth | date, 18+ |
| 17 | `owner.drivers_license` | Driver's License # and State Issued | text |
| 18 | `owner.cell_phone` | Owner's Mobile Number | US phone |
| 19 | `owner.home_street` | Owner's Home Address — street | text |
| 20 | `owner.home_city` | — city | text |
| 21 | `owner.home_state` | — state | US state select |
| 22 | `owner.home_zip` | — zip | 5-digit zip |
| 23 | `owner.email` | Owner's Email Address | email, required (signing link goes here) |

### Store Contact Information
| # | Key | Label | Type / Validation |
|---|---|---|---|
| 24 | `contact.name` | Store Contact's Name | text |
| 25 | `contact.job_title` | Store Contact's Job Title | text |
| 26 | `contact.phone` | Store Contact's Phone Number | US phone |
| 27 | `contact.email` | Store Contact's Email | email |

### ATM Installation Information
| # | Key | Label | Type / Validation |
|---|---|---|---|
| 28 | `install.shipping_address` | Shipping Address for ATM | text; web form: "same as business address" checkbox (app prints it only "if different") |
| 29 | `install.subflooring` | Type of subflooring | select: Wood / Cement (app has checkboxes) |
| — | `install.surcharge_suggestion` | Desired ATM surcharge | currency; **customer-suggested only — office manager's note: "They can suggest this, but I don't want it added."** Never auto-populates the application; shown to office as a suggestion next to the office-set `atm.surcharge` field |
| — | `install.floor_level` | Ground level / upstairs / downstairs | select (info-only; not mapped to app) |
| — | `install.internet_ready` | Has internet been run to the ATM location | yes/no (info-only; not mapped) |
| 30 | `install.wireless_box` | Do you require a wireless box? | yes/no, required (drives $25.95/mo wireless fee on app) |

### Bank Account Information
| # | Key | Label | Type / Validation |
|---|---|---|---|
| 31 | `bank.name` | Name of Bank | text, required |
| 32 | `bank.account_name` | Name on Bank Account | text, required — also used as "legal name of ATM Operator" on ACH form and W-9 line 1 |
| 33 | `bank.routing` | Routing Number | 9 digits + ABA checksum, required |
| 34 | `bank.account_number` | Account Number | numeric — **encrypt at rest, mask in UI** |
| 35 | `bank.street` | Address for Account — street | text |
| 36 | `bank.city` | — city | text |
| 37 | `bank.state` | — state | US state select |
| 38 | `bank.zip` | — zip | 5-digit zip |
| — | (upload) `bank.voided_check` | Copy of voided check | file upload, required — add to web worksheet (paper form says REQUIRED but has no field) |

### Office-set fields (never asked of the customer; set on the review/prefill screen)
`atm.surcharge` (#—, office decides; customer suggestion shown alongside), `atm.rebate` (Merchant Surcharge Rebate), `atm.make_model`, `atm.count`, `equipment.*` (signage, vault lock, totals, lease terms), `program` (variant selection), `sales.rep_name` (default "Lee Boys/" per Purchase Order), agreement dates, and app defaults: Max Withdrawal $200, Denomination $20, Network Fee $15/mo, Account Type Checking, Accumulation Lumped, New Account ✓.

---

## Appendix B — Worksheet → Application Field Map (Merchant Owned / Placement / Cash Loading variant, per office manager's markup)

The 8-page application packet and where each worksheet number lands. PDF AcroForm field names (from `blank-app.pdf`) in `code`.

**Page 1 — Merchant Cover Sheet:** Open Date←1 (`Open Date`, `Already Open` derived), Name←2 (`Owners Name`… n.b. PDF field is `Name`-equivalent; verify at build time), DBA←5 (`DBA`), Owner's Name←13, Owner Cell←18 (`Owners Cell Phone`), Owner Email←23 (`Owners Email`), Manager Name←24+25 (`Managers Name` — name + title combined), Manager Phone←26 (`Managers Phone`), Manager Email←27 (`Email`), Store location address←6,7,8,9, Shipping if different←28 (`Shippingmailing address if different`, blank when same), Store Phone←10 (`Location Phone`), Cash Loader Name←constant **"Forza Cash Loader"** for cash-loading variants (`Cash Loader Name If you are cash loading yourself`), Low-cash alert fields←"N/A", Wireless box←30, Subflooring←29 (Wood/Cement checkboxes).

**Page 2 — Application for ATM Processing:** DBA←5, Address←6, City←7 (`City`), State←8, Zip←9, Phone←10, Corporate Name←2 (`Corp Name`), Corporate Email←23, Years at This Location←12, Business Start Date←11, Federal Tax ID←3 (`Federal Tax ID`), Business Type←4 (checkboxes `Check Box…` Sole Prop/Corp/Partnership/Other), Primary Owner: Name←13, % Equity←14 (`Equity`), Resident Address←19 (`Resident Address`), City←20, State←21, Zip←22, Phone←18, DOB←16 (`Date of Birth`), SSN←15 (`Social Security`), DL←17 (`Drivers License`); Bank: BANK NAME←31, Name of Account←32, Routing←33 (`Routing`), Account←34 (`Account`); ATM Setup: Surcharge & Rebate = office-set; defaults: Max $200, Denom $20 ✓; signature block: Owner Name←13, Owner Signature = **customer sign field**, Sales Associate = office.

**Page 3 — Processing Agreement:** Merchant←5, address←6,7,8,9, day/month/year = send date (`Day`,`Month`,`Year`), Merchant Rebate & Surcharge rate = office-set (`Rebate`,`Surcharge`), By X = **customer sign field** (`By X`), Print Name←13.

**Page 4 — PAI Exhibit 3, ACH Authorization:** checkboxes Vault Cash + Surcharge ✓ (Wireless if #30=yes), Location Name←5, Contact←24, Address←6, City←7, State←8, Zip←9, Phone←10, ATM Operator legal name←**32**, Print Name←13, Date=sign date, Signature=**customer sign field**, Name on Account←32, Address←35, City←36, State←37, Zip←38, Bank Name←31, Account Type: Checking ✓, Accumulation: Lumped ✓, Routing←33, Account←34, PAI Reports: User Name (office/blank), Email←23.

**Page 5 — IRS W-9:** Line 1←**32** (must match bank account name), Line 2←5, Box 3a←derived from 4 (LLC-S → LLC+"S", LLC-C → LLC+"C", Corporation → C corp, Partnership, Sole Prop → Individual/sole proprietor), Address←35/36/37/38 (W-9 must match bank data — office manager's rule), Part I: **if Sole Prop → SSN←15, else EIN←3** (fields `Text3.0.*2024w9` = SSN boxes, `Text3.1.*2024w9` = EIN boxes — per-digit boxes), Signature=**customer sign field**, Date=sign date.

**Page 6 — Purchase Order:** Method: ACH from Account on Record ✓ (default), DBA←5, Merchant Contact←13, Email←23, Sales Representative←"Lee Boys/" default, line items/tax/total = office-set, Depository Name←32, ACH Routing←33, Account←34, Merchant Signature=**customer sign field**, Title/Print/Date.

**Page 7 — ATM Cash Loading Agreement** *(cash-loading variants only)*: Merchant←5, rebate/surcharge/term = office-set, Merchant Signature=**customer sign field**, Print Name←13, date=sign date.

**Page 8 — Schedule A** *(cash-loading variants only)*: Header←5, Row 1: Account Name←5, Address←6,7,8,9, # of ATMs / Surcharge / Merchants Rebate = office-set.

**Variant note:** the uploaded blank `Merchant Owned / Merchant Load` packet is the same packet minus pages 7–8 (no Cash Loading Agreement/Schedule A) and with the ML processing agreement (merchant loads own cash; clause differences only). Office manager's annotation confirms Merchant-Owned/Cash-Loading and Placement/Cash-Loading use the **same application**. So the initial template set is likely: (a) ML packet – 7 pages, (b) CL packet – 8 pages; more variants drop in via the template system.

**Signature/initial placements per packet:** customer signs on pages 2, 3, 4, 5 (W-9), 6, 7 + merchant initials on cover-sheet internet notice; Forza countersigns pages 2, 3, 6 (supports the multi-signer flow in Phase 4, or office pre-fills its side).

---

## Appendix C — Conditional & Derived Logic (build as rules, not code)
- `already_open` = business.open_date ≤ send date → check "Already Open" (p1) / "New Account" (p2 header).
- W-9 TIN: business.classification = Sole Prop → use owner SSN (#15) in SSN boxes; otherwise EIN (#3) in EIN boxes. W-9 line 1 and address must match the **bank account** name/address (#32, #35–38), not the business address.
- Shipping address prints only if different from business address.
- Wireless box (#30) = yes → check "Wireless" on ACH form, add $25.95/mo wireless fee on p2 Monthly Fees + PO note.
- Surcharge: customer suggestion is displayed to office but **never** auto-fills; office enters final surcharge + rebate at prefill review.
- Cash Loader Name: "Forza Cash Loader" constant for placement/CL variants; merchant's own loader name (ask in worksheet, conditional question) for ML variant.
- Agreement dates (day/month/year fields on pp. 3, 7) = date of sending, auto-stamped.
- Store contact = also the "Manager" on the cover sheet and "Contact" on the ACH form.
