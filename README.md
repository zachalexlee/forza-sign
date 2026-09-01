# Forza Sign

Self-hosted worksheet + e-signature platform for Forza Payments' ATM
applications. Customers fill a validated web worksheet, the office reviews
and corrects it, the data auto-populates the right ATM application packet
(one field dictionary, many templates), and the customer signs through
Forza's own ESIGN/UETA-compliant flow — no SignNow, no double data entry.

- **Spec:** `docs/build-plan.md` (source of truth — field dictionary,
  PDF field maps, conditional logic)
- **Execution plan:** `PLAN.md` (milestones M1–M6, decisions, dependencies)
- **Tracking:** Linear project *Forza Sign* (Forza Payments team)

## Stack

Next.js (App Router, TypeScript) · Supabase (Postgres + RLS, Auth,
Storage) · pdf-lib · signature_pad · Resend · Zod · Vercel

## Development

```bash
npm install
cp .env.example .env.local   # fill in values (see comments in the file)
npm run dev
```

Checks (all run in CI):

```bash
npm run lint
npm run typecheck        # next typegen + tsc
npm test                 # vitest unit suite
bash scripts/test-rls.sh # RLS + audit-immutability harness (needs Postgres 16)
npm run build
```

Database: migrations live in `supabase/migrations/`, seed data (org,
programs, the Appendix A field dictionary, template rows) in
`supabase/seed.sql`. Use the Supabase CLI (`npx supabase start` /
`db reset`) for a local stack, or apply them to a hosted project.

## Key directories

```
src/lib/fields/       dictionary types, shared Zod validation, sensitive-field crypto
src/lib/pdf/          fill engine, derived rules (Appendix C), Appendix B maps,
                      signing-time stamping/flatten/certificate
src/app/w/[token]     customer worksheet (token-gated)
src/app/sign/[token]  signing experience (consent → view → sign)
src/app/admin         staff dashboard: worksheets, applications, customers, templates
supabase/             migrations + seed
scripts/              inspect-pdf (verify maps vs real PDFs), sync-maps, test-rls
```

## Operational notes

- **Tokens**: customer links carry 256-bit tokens; only SHA-256 hashes are
  stored. Worksheet links expire in 30 days, signing links in 14.
- **Sensitive fields** (`owner.ssn`, `bank.account_number`) are encrypted
  app-side (AES-256-GCM, `FIELD_ENCRYPTION_KEY`) before touching the DB and
  only leave the server masked; they decrypt solely inside PDF fill runs.
- **Audit trail** is append-only at the database level and is rendered onto
  the certificate page of every executed PDF along with its SHA-256.
- **Field maps**: the mapper UI (Admin → Templates) stores maps in
  `templates.field_map`, which takes precedence over the in-repo Appendix B
  maps (`src/lib/pdf/maps/`). `npm run sync:maps` seeds the in-repo maps
  into an empty database; `npm run inspect:pdf -- <file>` diffs a map
  against a real PDF's AcroForm fields.

## Deploy (pending)

Hosted Supabase project + Vercel + Resend domain — tracked in Linear
FOR-17. After the first deploy: apply migrations + seed, run
`npm run sync:maps`, upload the blank packet PDFs (Admin → Templates),
create the first admin user in `staff_users`, and configure the Vercel
cron for `/api/cron/reminders` with `CRON_SECRET`.
