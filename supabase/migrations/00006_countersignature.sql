-- Forza countersignature: the customer-stamp pass captures where the
-- Forza-signer lines sit (flatten erases the fields), and keeps the
-- pre-certificate working copy so countersigning can stamp it, rebuild
-- the certificate page with the new hash + events, and re-seal.
alter table applications
  add column working_pdf_path text,
  add column forza_placements jsonb,
  add column countersigned_at timestamptz,
  add column countersigned_by uuid references staff_users (id);
