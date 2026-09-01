-- Tenant isolation at the RLS layer.
--
-- The original policies gated on "is a staff user" only; with a second
-- organization, staff of one org could read the other's rows. Replace them
-- with org-aware policies: direct org_id match where the table carries it,
-- a join through the parent where it doesn't (worksheet_links → worksheets,
-- signers → applications, templates → programs). field_definitions stays
-- staff-wide: the dictionary is global.

create function staff_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from staff_users where id = auth.uid();
$$;

-- organizations: staff see their own org only
drop policy staff_read on organizations;
create policy staff_read on organizations for select
  using (id = staff_org());

-- staff_users: visible within the same org; admins manage their own org
drop policy staff_read on staff_users;
drop policy admin_write on staff_users;
create policy staff_read on staff_users for select
  using (org_id = staff_org());
create policy admin_write on staff_users for all
  using (is_admin() and org_id = staff_org())
  with check (is_admin() and org_id = staff_org());

-- customers / worksheets / applications / email_log: direct org match
drop policy staff_all on customers;
create policy staff_all on customers for all
  using (org_id = staff_org()) with check (org_id = staff_org());

drop policy staff_all on worksheets;
create policy staff_all on worksheets for all
  using (org_id = staff_org()) with check (org_id = staff_org());

drop policy staff_all on applications;
create policy staff_all on applications for all
  using (org_id = staff_org()) with check (org_id = staff_org());

drop policy staff_read on email_log;
create policy staff_read on email_log for select
  using (org_id = staff_org());

-- programs / templates: org via programs.org_id
drop policy staff_read on programs;
drop policy admin_write on programs;
create policy staff_read on programs for select
  using (org_id = staff_org());
create policy admin_write on programs for all
  using (is_admin() and org_id = staff_org())
  with check (is_admin() and org_id = staff_org());

drop policy staff_read on templates;
drop policy admin_write on templates;
create policy staff_read on templates for select
  using (exists (
    select 1 from programs p where p.id = program_id and p.org_id = staff_org()
  ));
create policy admin_write on templates for all
  using (is_admin() and exists (
    select 1 from programs p where p.id = program_id and p.org_id = staff_org()
  ))
  with check (is_admin() and exists (
    select 1 from programs p where p.id = program_id and p.org_id = staff_org()
  ));

-- worksheet_links: org via the parent worksheet
drop policy staff_all on worksheet_links;
create policy staff_all on worksheet_links for all
  using (exists (
    select 1 from worksheets w where w.id = worksheet_id and w.org_id = staff_org()
  ))
  with check (exists (
    select 1 from worksheets w where w.id = worksheet_id and w.org_id = staff_org()
  ));

-- signers: org via the parent application
drop policy staff_all on signers;
create policy staff_all on signers for all
  using (exists (
    select 1 from applications a where a.id = application_id and a.org_id = staff_org()
  ))
  with check (exists (
    select 1 from applications a where a.id = application_id and a.org_id = staff_org()
  ));

-- audit_events: read/insert within the org only (append-only unchanged)
drop policy staff_read on audit_events;
drop policy staff_insert on audit_events;
create policy staff_read on audit_events for select
  using (org_id = staff_org());
create policy staff_insert on audit_events for insert
  with check (org_id = staff_org());
