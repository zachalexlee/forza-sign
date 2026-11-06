-- PAI placement gets its own flat-rebate packet (pl-cl-v2) with fillable
-- blanks for the retained transaction count, rebate and surcharge; the
-- merchant-owned cash-loading packet (cl-v1) no longer doubles as the
-- placement packet. The count is an office-set choice: 100, 150 or 200.
update templates t
   set storage_path = 'blanks/pl-cl-v2.pdf'
  from programs p
 where t.program_id = p.id
   and p.code = 'pl-cl'
   and t.variant = 'standard'
   and t.storage_path = 'blanks/cl-v1.pdf';

insert into field_definitions
  (key, legacy_num, label, section, field_type, required, ask_customer, sensitive, options, validation, help_text, sort_order)
values
('atm.retained_transactions', null, 'Forza Retains the First (transactions)', 'office', 'select', false, false, false,
  '[{"value":"100","label":"100 transactions"},{"value":"150","label":"150 transactions"},{"value":"200","label":"200 transactions"}]',
  '{"default": "100"}', 'PAI placement only: no merchant rebate on the first N transactions.', 24)
on conflict (key) do nothing;
