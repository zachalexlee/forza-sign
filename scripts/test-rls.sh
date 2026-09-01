#!/usr/bin/env bash
# RLS verification harness (build plan §9): boots a throwaway Postgres,
# applies the real migrations + seed with Supabase-like roles/grants, then
# asserts the policies gate access:
#   - anon / unauthenticated see nothing and cannot write
#   - an authenticated non-staff user sees nothing
#   - a staff user sees org data
#   - audit_events rejects UPDATE/DELETE even for staff
# Usage: scripts/test-rls.sh [pgdata-dir] (defaults to a temp dir)
set -euo pipefail

PGBIN=${PGBIN:-$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1 || command -v initdb)")}
WORK=${1:-$(mktemp -d)}
PORT=55433
PSQL="psql -h $WORK -p $PORT -U postgres -v ON_ERROR_STOP=1"

# Postgres refuses to run as root; drop to the postgres user in that case.
if [ "$(id -u)" = "0" ]; then
  AS_PG() { su postgres -s /bin/bash -c "$*"; }
  mkdir -p "$WORK" && chown postgres:postgres "$WORK"
else
  AS_PG() { bash -c "$*"; }
  mkdir -p "$WORK"
fi

cleanup() { AS_PG "$PGBIN/pg_ctl -D $WORK/data stop" >/dev/null 2>&1 || true; }
trap cleanup EXIT

AS_PG "$PGBIN/initdb -D $WORK/data -U postgres -A trust" >/dev/null
AS_PG "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $WORK' -l $WORK/log start" >/dev/null
sleep 1

$PSQL -c "create database rlstest;" >/dev/null
PSQL="$PSQL -d rlstest"

# --- Supabase environment stubs -------------------------------------------
$PSQL >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
-- Mirror Supabase: auth.uid() reads the JWT subject claim.
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
alter table storage.objects enable row level security;
SQL

$PSQL -f supabase/migrations/00001_init.sql >/dev/null
$PSQL -f supabase/migrations/00002_worksheet_submission.sql >/dev/null
$PSQL -f supabase/seed.sql >/dev/null

# --- Supabase-like grants (RLS must be the thing doing the gating) --------
$PSQL >/dev/null <<'SQL'
grant usage on schema public, auth to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
-- Re-apply the migration's targeted revoke, which the blanket grant above
-- (standing in for Supabase's default privileges) just undid.
revoke update, delete on audit_events from anon, authenticated;

-- Fixture: one staff user, one non-staff auth user, one customer + worksheet.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into staff_users (id, org_id, email, full_name, role)
  values ('11111111-1111-1111-1111-111111111111',
          '00000000-0000-0000-0000-000000000001',
          'staff@forza.test', 'Test Staff', 'staff');
insert into customers (id, org_id, business_name)
  values ('33333333-3333-3333-3333-333333333333',
          '00000000-0000-0000-0000-000000000001', 'RLS Test Biz');
insert into worksheets (id, org_id, customer_id, data)
  values ('44444444-4444-4444-4444-444444444444',
          '00000000-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333', '{}');
insert into audit_events (org_id, worksheet_id, event_type)
  values ('00000000-0000-0000-0000-000000000001',
          '44444444-4444-4444-4444-444444444444', 'created');
SQL

# --- Assertions -----------------------------------------------------------
$PSQL >/dev/null <<'SQL'
do $$
declare n int;
begin
  -- 1. anon sees nothing
  set local role anon;
  select count(*) into n from worksheets;
  if n <> 0 then raise exception 'FAIL: anon can read worksheets (%)', n; end if;
  select count(*) into n from customers;
  if n <> 0 then raise exception 'FAIL: anon can read customers'; end if;
  select count(*) into n from field_definitions;
  if n <> 0 then raise exception 'FAIL: anon can read field_definitions'; end if;
  select count(*) into n from worksheet_links;
  if n <> 0 then raise exception 'FAIL: anon can read worksheet_links'; end if;
  begin
    insert into customers (org_id, business_name)
      values ('00000000-0000-0000-0000-000000000001', 'hacker');
    raise exception 'FAIL: anon can insert customers';
  exception when insufficient_privilege or check_violation then null;
           when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 2. authenticated but NOT staff sees nothing
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n from worksheets;
  if n <> 0 then raise exception 'FAIL: non-staff auth user can read worksheets'; end if;
  select count(*) into n from staff_users;
  if n <> 0 then raise exception 'FAIL: non-staff auth user can read staff_users'; end if;
  reset role;

  -- 3. staff user CAN read
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into n from worksheets;
  if n <> 1 then raise exception 'FAIL: staff cannot read worksheets (%)', n; end if;
  select count(*) into n from customers;
  if n <> 1 then raise exception 'FAIL: staff cannot read customers'; end if;

  -- 4. staff cannot UPDATE/DELETE audit_events (privilege revoke + trigger)
  begin
    update audit_events set event_type = 'voided' where true;
    raise exception 'FAIL: audit_events UPDATE allowed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    delete from audit_events where true;
    raise exception 'FAIL: audit_events DELETE allowed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  reset role;

  -- 5. and the row really is untouched (checked as superuser)
  select count(*) into n from audit_events where event_type = 'created';
  if n <> 1 then raise exception 'FAIL: audit_events row was mutated'; end if;

  -- 6. even the superuser path hits the append-only trigger
  begin
    update audit_events set event_type = 'voided' where true;
    raise exception 'FAIL: audit_events UPDATE allowed for table owner';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
SQL

echo "RLS verification: ALL CHECKS PASSED"
