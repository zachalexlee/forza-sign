-- Reminder bookkeeping and a per-customer lock (build plan §6.4).
--
-- Every reminder rotates the customer's link, so two reminders for the same
-- signer or worksheet must never overlap: the second would invalidate the
-- link the first just emailed, or a rollback could resurrect a stale link.
-- claim_reminder takes a short lease on the subject; release_reminder drops
-- it. The automatic-reminder count and last-reminder time live here too and
-- are reserved at claim time, so the cap holds even if the process dies or a
-- later write (like the audit event) fails after the email went out.
--
-- A separate table (not columns on worksheets) so reminder bookkeeping never
-- bumps worksheets.updated_at, which tracks the customer's own saves.
create table reminder_state (
  kind text not null check (kind in ('signer', 'worksheet')),
  subject_id uuid not null,
  auto_reminders_sent integer not null default 0,
  last_reminder_at timestamptz,
  lock_id uuid,
  lock_until timestamptz,
  primary key (kind, subject_id)
);

alter table reminder_state enable row level security;
revoke all on reminder_state from anon, authenticated;

-- Carry over reminders already sent by the earlier cron.
insert into reminder_state (kind, subject_id, auto_reminders_sent, last_reminder_at)
select 'signer', signer_id,
       count(*) filter (where coalesce(meta ->> 'action', '') <> 'manual_reminder'),
       max(ts)
  from audit_events
 where event_type = 'reminder_sent' and signer_id is not null
 group by signer_id
union all
select 'worksheet', worksheet_id,
       count(*) filter (where coalesce(meta ->> 'action', '') <> 'manual_reminder'),
       max(ts)
  from audit_events
 where event_type = 'reminder_sent' and signer_id is null and worksheet_id is not null
 group by worksheet_id;

-- Take the lease. Automatic claims also enforce the cap and spacing, and
-- reserve their slot up front. Returns no row when the subject is busy (or,
-- for automatic claims, capped or reminded too recently).
create or replace function claim_reminder(
  p_kind text,
  p_subject_id uuid,
  p_automatic boolean,
  p_max_automatic integer,
  p_not_since timestamptz,
  p_lease_seconds integer
) returns table (lock_id uuid, prev_last_reminder_at timestamptz)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_lock uuid := gen_random_uuid();
  v_prev timestamptz;
begin
  insert into reminder_state (kind, subject_id)
  values (p_kind, p_subject_id)
  on conflict do nothing;

  select s.last_reminder_at into v_prev
    from reminder_state s
   where s.kind = p_kind and s.subject_id = p_subject_id
     for update;

  update reminder_state s
     set lock_id = v_lock,
         lock_until = now() + make_interval(secs => p_lease_seconds),
         last_reminder_at = now(),
         auto_reminders_sent = s.auto_reminders_sent + case when p_automatic then 1 else 0 end
   where s.kind = p_kind
     and s.subject_id = p_subject_id
     and (s.lock_until is null or s.lock_until < now())
     and (
       not p_automatic
       or (
         s.auto_reminders_sent < p_max_automatic
         and (s.last_reminder_at is null or s.last_reminder_at < p_not_since)
       )
     );
  if not found then
    return;
  end if;
  return query select v_lock, v_prev;
end;
$$;

-- Drop the lease. When nothing was sent, undo the reservation. A holder
-- whose lease already expired (and was taken over) changes nothing.
create or replace function release_reminder(
  p_kind text,
  p_subject_id uuid,
  p_lock_id uuid,
  p_sent boolean,
  p_automatic boolean,
  p_prev_last_reminder_at timestamptz
) returns boolean
language plpgsql
as $$
begin
  update reminder_state s
     set lock_id = null,
         lock_until = null,
         auto_reminders_sent = case
           when not p_sent and p_automatic then greatest(s.auto_reminders_sent - 1, 0)
           else s.auto_reminders_sent
         end,
         last_reminder_at = case when p_sent then s.last_reminder_at else p_prev_last_reminder_at end
   where s.kind = p_kind
     and s.subject_id = p_subject_id
     and s.lock_id = p_lock_id;
  return found;
end;
$$;

revoke execute on function claim_reminder(text, uuid, boolean, integer, timestamptz, integer)
  from public, anon, authenticated;
revoke execute on function release_reminder(text, uuid, uuid, boolean, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function claim_reminder(text, uuid, boolean, integer, timestamptz, integer)
  to service_role;
grant execute on function release_reminder(text, uuid, uuid, boolean, boolean, timestamptz)
  to service_role;
grant all on reminder_state to service_role;
