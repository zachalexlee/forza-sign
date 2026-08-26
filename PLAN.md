# Forza Sign — Implementation Plan

This is the execution plan for building the Forza Application & E-Signature Platform
described in the build plan (`docs/build-plan.md`). It translates the four build
phases into concrete milestones, records the technical decisions I'll take by
default, and lists exactly what is needed from Zach and when.

## 1. Review of the build plan

The build plan is in good shape to build from directly. Its strongest asset is
Appendices A–C: the canonical field dictionary (with the office manager's 1–38
numbering preserved as `legacy_num`), the per-page PDF field maps for the ML and
CL packets, and the conditional logic (W-9 TIN selection, wireless fee,
shipping-if-different, etc.). That means the data model and prefill engine can be
seeded from spec rather than reverse-engineered.

Things the plan leaves open that I'm resolving here (see §2 for the decisions):

- **Sensitive-field encryption mechanics.** The plan says "encrypt at rest" for
  SSN and bank account number but worksheet data lives in a JSONB blob. Those two
  fields need app-layer encryption before they ever reach the JSONB, plus masking
  rules everywhere they surface.
- **Token security.** Worksheet and signing tokens are the entire auth model for
  customers. They must be generated with a CSPRNG, stored **hashed**, expiring,
  and single-purpose.
- **Audit immutability.** `audit_events` needs insert-only enforcement at the
  database level (no UPDATE/DELETE grants, not just convention), since the audit
  certificate is the legal backbone.
- **The source PDFs are not in the repo yet.** Appendix B gives AcroForm field
  names, but Phase 2 cannot be *verified* until the actual `worksheet.pdf`,
  ML packet, and CL packet PDFs are provided as template fixtures. The plan
  itself flags one field name as "verify at build time."
- **Local development.** The plan assumes a hosted Supabase project from day one.
  I'll build against the Supabase CLI local stack (Postgres in Docker, migrations
  as SQL files in-repo) so everything is testable in CI without credentials;
  the hosted project is just a deploy target.

## 2. Default technical decisions

Taken unless Zach objects — none are hard to change later:

| Area | Decision |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript, React Server Components), single app |
| Styling | Tailwind CSS + shadcn/ui (fast, clean, Forza-brandable via CSS variables) |
| DB migrations | Supabase CLI (`supabase/migrations/*.sql`), checked into repo; local stack for dev/test |
| Field encryption | AES-256-GCM at the app layer for `owner.ssn` and `bank.account_number`, key in env (`FIELD_ENCRYPTION_KEY`); ciphertext stored in JSONB; last-4 stored alongside for display; both fields stripped from all emails, logs, and audit metadata |
| Tokens | 256-bit random, base64url in the link, **SHA-256 hash stored in DB**, per-purpose (worksheet vs. signing), expiring (worksheet 30 days, signing 14 days, both configurable), invalidated on void/revise |
| Audit trail | `audit_events` insert-only (RLS + revoked UPDATE/DELETE); hash chain not needed for v1 — the flattened PDF's SHA-256 printed on the certificate covers integrity |
| PDF fill | `pdf-lib` AcroForm fill; per-digit W-9 boxes handled by a `split_digits` transform in the field map; coordinate-fallback supported in the map schema from day one but only used if a variant needs it |
| Field map schema | JSONB per template: `{ pdf_field: string, source: dictionary_key \| constant \| derived, transform?: date_format \| split_digits \| checkbox_from_enum \| combine \| ... }` — Appendix C rules become named `derived` functions, not code branches |
| Signing render | PDF rendered server-side to per-page images (pdfjs-dist) for the signing viewer — avoids shipping the raw AcroForm PDF to the browser and gives precise overlay placement for signature fields |
| Email | Resend with React Email templates; every send recorded in `email_log`; provider webhook → `email_delivered` audit events |
| Validation | Zod schemas generated from `field_definitions` seed (single source of truth); ABA mod-10 checksum implemented as a custom refinement |
| Testing | Vitest (unit: schemas, checksum, derived logic, field-map fills via pdf-lib re-read), Playwright (E2E happy path per phase), CI via GitHub Actions against local Supabase |
| Hosting | Vercel + hosted Supabase, deployed at the end of Milestone 1 (needs Zach's accounts — see §3) |

## 3. Needed from Zach

**Blocking (needed before the milestone listed):**

| Item | Needed by | Why |
|---|---|---|
| The three source PDFs (`worksheet.pdf`, blank ML packet, CL packet) committed or uploaded | M3 (template engine) | Fixtures for fill service + verification of Appendix B field names |
| Supabase account/org access (or org id for me to create the project) | M2 deploy step | Hosted DB, auth, storage |
| Vercel account access + domain choice (e.g. `apply.forzapayments.com`) | M2 deploy step | Hosting |
| Resend account + sending domain (e.g. `sign@forzapayments.com`) with DNS access for SPF/DKIM | M2 (emails) | Deliverability |

**Non-blocking (placeholders fine):**

- Definitive program list and remaining variant PDFs (template system absorbs them later).
- ESIGN consent/disclosure language (standard boilerplate used until replaced).
- Forza logo/brand colors (neutral branding until provided).
- Confirmation from the processor/bank sponsor that self-hosted e-signatures are accepted (business risk item — flagged in the build plan; should happen before SignNow is cancelled at M5).

## 4. Repository layout

```
forza-sign/
├── docs/                    # build-plan.md (the source spec), this plan, ADRs as needed
├── supabase/
│   ├── migrations/          # numbered SQL migrations (schema + RLS)
│   └── seed.sql             # org, programs, field_definitions (Appendix A), template field maps (Appendix B)
├── src/
│   ├── app/
│   │   ├── (public)/w/[token]/       # customer worksheet form
│   │   ├── (public)/sign/[token]/    # signing experience
│   │   ├── (admin)/admin/...         # dashboard, review, applications, customers
│   │   └── api/...                   # token-validated routes, webhooks, cron
│   ├── lib/
│   │   ├── fields/          # dictionary types, Zod generation, derived-logic rules (Appendix C)
│   │   ├── pdf/             # fill service, transforms, stamping, flatten, certificate page
│   │   ├── tokens.ts        # generate/hash/verify
│   │   ├── crypto.ts        # field encryption
│   │   └── email/           # Resend client + React Email templates
│   └── components/          # form renderer, PDF viewer, signature modal, admin UI
├── tests/                   # vitest unit + fixtures (incl. template PDFs)
└── e2e/                     # Playwright
```

## 5. Milestones

Milestones map to the build plan's phases but are sliced so each ends with
something demonstrably working and tested.

### M1 — Foundation (Phase 0)
Scaffold Next.js + Tailwind + shadcn/ui; Supabase local stack; full schema
migration for all §5 tables (including the ones not used until later — schema
churn is cheaper now); RLS policies; staff auth (Supabase Auth, email/password
+ invite); storage buckets; seed script with org, programs, and the complete
Appendix A field dictionary; token + crypto libraries with unit tests; CI
pipeline. **Done when:** staff can log into an empty dashboard locally; all
tests green in CI.

### M2 — Worksheet pipeline (Phase 1) ← the biggest immediate win
Dynamic form renderer driven by `field_definitions` (sections, types, inline
validation incl. EIN/phone/ZIP formats and ABA checksum, conditional questions,
component-split addresses, voided-check upload); token links with save/resume
and review-before-submit; admin queue + worksheet review/edit screen with
changed-field highlighting and review notes; manual-entry path; invite +
submission-received emails; **deploy to Vercel + hosted Supabase**.
**Done when:** the office can send a link, a customer can submit, and the
office reviews/corrects online — re-typing stops. Includes the temporary
"download filled application PDF" escape hatch *(moved up from Phase 2 spirit:
it ships as soon as M3 lands, letting the office keep SignNow only for the
signature itself)*.

### M3 — Template engine & prefill (Phase 2)
Template records + field-map JSONB seeded from Appendix B for the ML and CL
packets; pdf-lib fill service with the transform library (dates, per-digit
W-9 TIN boxes, checkbox groups, combine/derive rules from Appendix C); AcroForm
field inspector script (verifies Appendix B names against the real PDFs and
reports mismatches); program selection → auto-populate → side-by-side preview
with override panel (office-set fields entered here: surcharge, rebate,
equipment, etc.); per-template fill tests that re-read the PDF and assert every
mapped field. **Done when:** picking a program on a reviewed worksheet produces
a correctly filled application PDF for both packets, downloadable.

### M4 — E-signature (Phase 3)
Signer records + signing tokens; ESIGN consent gate (logged with IP/UA/ts);
"I am [Name]" confirmation; paged document viewer with field navigation;
signature_pad draw + typed-cursive option, reusable within session; server-side
stamping, flattening, SHA-256, audit certificate page appended; status
lifecycle + full audit events; completion emails with executed copy; reminders
via Vercel cron; decline-with-reason; void / revise-and-resend. **Done when:**
the E2E test passes end to end (fill → review → prefill → sign → flattened
final PDF with matching hash and certificate page) and real applications can be
executed — SignNow cancellable after the bank-sponsor acceptance check (§3).

### M5 — Hardening & security pass
Focused pass before full cutover: expired/used/voided token rejection tests,
RLS verification with anon key, storage access only via short-lived signed
URLs, rate limiting on public token routes, SSN/bank masking audit across UI,
emails, and logs, dependency/secret scan. **Done when:** the §9 security
checklist in the build plan all passes as automated tests where possible.

### M6 — Polish & leverage (Phase 4)
Admin template mapper UI (upload PDF → list detected fields → assign dictionary
keys), Forza countersignature (multi-signer ordering), roles, metrics
dashboard, remaining variants, main-site embed. Scoped after M1–M5 feedback.

## 6. Sequencing note

M1 and most of M2 and M3 need nothing from Zach — the field dictionary and
field maps are fully specified in the appendices, and development runs on the
local Supabase stack. The first hard external dependency is the M2 deploy
(Supabase/Vercel/Resend accounts) and the real PDFs for M3 verification, so
those can be gathered in parallel while M1–M2 are built.
