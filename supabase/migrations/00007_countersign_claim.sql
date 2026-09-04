-- Countersigning uses a separate expiring claim lock. countersigned_at is
-- final state written only after the replacement PDF is stored — a crash
-- mid-attempt leaves a stale claim that ages out instead of a permanently
-- "countersigned" application whose PDF never changed.
alter table applications
  add column countersign_claimed_at timestamptz;
