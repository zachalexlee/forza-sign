-- Snapshot of the data exactly as the customer submitted it, so the review
-- screen can diff office edits against the original (build plan §6.2).
alter table worksheets add column submitted_data jsonb;
