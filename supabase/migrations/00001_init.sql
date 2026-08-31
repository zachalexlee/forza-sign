-- Forza Sign — initial schema
-- Tables per build plan §5, RLS per §5/§9.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type staff_role as enum ('admin', 'staff');
create type worksheet_status as enum ('sent', 'in_progress', 'submitted', 'reviewed');
create type application_status as enum ('draft', 'sent', 'viewed', 'signed', 'completed', 'voided', 'declined');
create type signer_status as enum ('pending', 'sent', 'viewed', 'consented', 'signed', 'declined');
create type audit_event_type as enum (
  'created', 'sent', 'email_delivered', 'opened', 'consented',
  'field_signed', 'signed', 'completed', 'edited', 'voided',
  'declined', 'reminder_sent'
);
create type field_type as enum (
  'text', 'textarea', 'date', 'select', 'number', 'currency', 'phone',
  'email', 'ein', 'ssn', 'zip', 'state', 'routing', 'account_number',
  'boolean', 'file'
);

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Staff rows mirror Supabase Auth users (id = auth.users.id).
create table staff_users (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid not null references organizations (id),
  email text not null unique,
  full_name text not null,
  role staff_role not null default 'staff',
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  business_name text not null,
  contact_name text,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  code text not null unique,
  name text not null,
  description text,
  cash_loading boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0
);

create table templates (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs (id),
  version int not null default 1,
  storage_path text,                 -- blank fillable PDF in the "templates" bucket
  field_map jsonb not null default '[]',
  signature_placements jsonb not null default '[]',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (program_id, version)
);

-- Canonical field dictionary (build plan §4 / Appendix A).
create table field_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,          -- e.g. business.legal_name
  legacy_num int,                    -- office manager's 1–38 numbering
  label text not null,
  section text not null,             -- business | owner | contact | install | bank | office
  field_type field_type not null default 'text',
  required boolean not null default false,
  ask_customer boolean not null default true,   -- false = office-set field
  sensitive boolean not null default false,     -- encrypted at rest, masked in UI
  options jsonb,                     -- for selects: [{value,label}]
  validation jsonb,                  -- extra rules, e.g. {"min":0,"max":100}
  help_text text,
  sort_order int not null default 0
);

create table worksheets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  customer_id uuid not null references customers (id),
  status worksheet_status not null default 'sent',
  data jsonb not null default '{}',  -- keyed by dictionary keys; sensitive values ciphertext
  submitted_at timestamptz,
  review_notes text,
  edited_by uuid references staff_users (id),
  edited_at timestamptz,
  created_by uuid references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Customer access tokens. Only the SHA-256 hash is stored.
create table worksheet_links (
  id uuid primary key default gen_random_uuid(),
  worksheet_id uuid not null references worksheets (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  opened_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (id),
  worksheet_id uuid not null references worksheets (id),
  program_id uuid not null references programs (id),
  template_id uuid not null references templates (id),
  data jsonb not null default '{}',  -- worksheet data + office overrides
  status application_status not null default 'draft',
  filled_pdf_path text,
  final_pdf_path text,
  sha256_final text,
  revises_application_id uuid references applications (id),
  sent_at timestamptz,
  completed_at timestamptz,
  voided_at timestamptz,
  created_by uuid references staff_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table signers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications (id) on delete cascade,
  name text not null,
  email text not null,
  sign_order int not null default 1,
  status signer_status not null default 'pending',
  token_hash text unique,
  token_expires_at timestamptz,
  consent_given_at timestamptz,
  signed_at timestamptz,
  signature_image_path text,
  declined_reason text,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Append-only legal audit trail (build plan §7).
create table audit_events (
  id bigint generated always as identity primary key,
  org_id uuid references organizations (id),
  application_id uuid references applications (id),
  worksheet_id uuid references worksheets (id),
  signer_id uuid references signers (id),
  event_type audit_event_type not null,
  ip inet,
  user_agent text,
  ts timestamptz not null default now(),
  meta jsonb not null default '{}'
);

create table email_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations (id),
  to_email text not null,
  template text not null,
  subject text,
  worksheet_id uuid references worksheets (id),
  application_id uuid references applications (id),
  provider_message_id text,
  status text not null default 'sent',
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index on worksheets (status, created_at desc);
create index on worksheets (customer_id);
create index on applications (status, created_at desc);
create index on applications (worksheet_id);
create index on signers (application_id);
create index on audit_events (application_id, ts);
create index on audit_events (worksheet_id, ts);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger customers_updated_at before update on customers
  for each row execute function set_updated_at();
create trigger worksheets_updated_at before update on worksheets
  for each row execute function set_updated_at();
create trigger applications_updated_at before update on applications
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit immutability: append-only enforced in the database, not by convention.
-- ---------------------------------------------------------------------------
create function audit_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;

create trigger audit_events_no_update_delete
  before update or delete on audit_events
  for each row execute function audit_events_immutable();

revoke update, delete on audit_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Staff (authenticated Supabase Auth users present in staff_users) get access.
-- Customers NEVER hold Supabase credentials: worksheet fill and signing go
-- through server-side routes using the service role after token validation.
-- ---------------------------------------------------------------------------
create function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_users su where su.id = auth.uid());
$$;

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_users su where su.id = auth.uid() and su.role = 'admin'
  );
$$;

alter table organizations enable row level security;
alter table staff_users enable row level security;
alter table customers enable row level security;
alter table programs enable row level security;
alter table templates enable row level security;
alter table field_definitions enable row level security;
alter table worksheets enable row level security;
alter table worksheet_links enable row level security;
alter table applications enable row level security;
alter table signers enable row level security;
alter table audit_events enable row level security;
alter table email_log enable row level security;

create policy staff_read on organizations for select using (is_staff());

create policy staff_read on staff_users for select using (is_staff());
create policy admin_write on staff_users for all using (is_admin()) with check (is_admin());

create policy staff_all on customers for all using (is_staff()) with check (is_staff());
create policy staff_read on programs for select using (is_staff());
create policy admin_write on programs for all using (is_admin()) with check (is_admin());
create policy staff_read on templates for select using (is_staff());
create policy admin_write on templates for all using (is_admin()) with check (is_admin());
create policy staff_read on field_definitions for select using (is_staff());
create policy admin_write on field_definitions for all using (is_admin()) with check (is_admin());

create policy staff_all on worksheets for all using (is_staff()) with check (is_staff());
-- Token hashes are only ever needed server-side (service role); staff may see
-- link metadata but the app never exposes token_hash to the browser.
create policy staff_all on worksheet_links for all using (is_staff()) with check (is_staff());
create policy staff_all on applications for all using (is_staff()) with check (is_staff());
create policy staff_all on signers for all using (is_staff()) with check (is_staff());

create policy staff_read on audit_events for select using (is_staff());
create policy staff_insert on audit_events for insert with check (is_staff());

create policy staff_read on email_log for select using (is_staff());

-- ---------------------------------------------------------------------------
-- Storage buckets (all private; files served via short-lived signed URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('templates', 'templates', false),
  ('filled', 'filled', false),
  ('final', 'final', false),
  ('signatures', 'signatures', false),
  ('uploads', 'uploads', false)   -- customer uploads, e.g. voided check
on conflict (id) do nothing;

create policy staff_storage_read on storage.objects for select
  using (bucket_id in ('templates', 'filled', 'final', 'signatures', 'uploads') and is_staff());
create policy staff_storage_write on storage.objects for insert
  with check (bucket_id in ('templates', 'filled', 'final', 'signatures', 'uploads') and is_staff());
