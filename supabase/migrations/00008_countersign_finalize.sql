-- Atomic countersign finalization: the claim-conditional metadata update
-- and the audit-event insert commit together or not at all. Without this,
-- an attempt that loses its lease between the insert and the update leaves
-- a countersign event in the immutable trail for an attempt that never
-- finalized (and a retry would append a second one).
create or replace function countersign_finalize(
  p_application_id uuid,
  p_claim_ts timestamptz,
  p_final_path text,
  p_sha256 text,
  p_org_id uuid,
  p_meta jsonb
) returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update applications
     set final_pdf_path = p_final_path,
         sha256_final = p_sha256,
         countersigned_at = p_claim_ts,
         countersign_claimed_at = null
   where id = p_application_id
     and countersign_claimed_at = p_claim_ts;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    -- Idempotent retry: the first call may have committed while its
    -- response was lost. If this exact claim already finalized, that
    -- earlier commit (including its audit event) stands — report success.
    if exists (
      select 1 from applications
       where id = p_application_id
         and countersigned_at = p_claim_ts
         and final_pdf_path = p_final_path
    ) then
      return true;
    end if;
    return false; -- lease lost: another attempt took over, nothing recorded
  end if;
  insert into audit_events (event_type, org_id, application_id, ts, meta)
  values ('signed', p_org_id, p_application_id, p_claim_ts, p_meta);
  return true;
end;
$$;
