-- PAI placement gets its own flat-rebate packet (pl-cl-v2) with fillable
-- blanks for the retained transaction count, rebate and surcharge; the
-- merchant-owned cash-loading packet (cl-v1) no longer doubles as the
-- placement packet. The count is an office-set choice: 100, 150 or 200.
--
-- The stored map is cleared with the blank so the in-repo placement map
-- applies at once (sync-maps re-seeds it on the next deploy). A row whose
-- map the office edited by hand ('custom') keeps its blank/map pair: that
-- mapping was made for cl-v1 and would not fit the new packet.
update templates t
   set storage_path = 'blanks/pl-cl-v2.pdf',
       field_map = '[]',
       signature_placements = '[]',
       map_source = null,
       map_version = 0
  from programs p
 where t.program_id = p.id
   and p.code = 'pl-cl'
   and t.variant = 'standard'
   and t.storage_path = 'blanks/cl-v1.pdf'
   and t.map_source is distinct from 'custom';

insert into field_definitions
  (key, legacy_num, label, section, field_type, required, ask_customer, sensitive, options, validation, help_text, sort_order)
values
('atm.retained_transactions', null, 'Forza Retains the First (transactions)', 'office', 'select', false, false, false,
  '[{"value":"100","label":"100 transactions"},{"value":"150","label":"150 transactions"},{"value":"200","label":"200 transactions"}]',
  '{"default": "100"}', 'PAI placement only: no merchant rebate on the first N transactions.', 24)
on conflict (key) do nothing;
