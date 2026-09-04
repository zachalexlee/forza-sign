-- Forza countersignature: the customer-stamp pass captures where the
-- Forza-signer lines sit (flatten erases the fields), and keeps the
-- pre-seal certified copy so countersigning can modify + re-seal it.
alter table applications
  add column certified_pdf_path text,
  add column forza_placements jsonb,
  add column countersigned_at timestamptz,
  add column countersigned_by uuid references staff_users (id);
