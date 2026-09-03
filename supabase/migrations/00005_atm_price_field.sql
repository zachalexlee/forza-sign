-- Office-set ATM unit price for the purchase-order item line (map v3).
-- Idempotent: production may already carry the row from seed/manual insert.
insert into field_definitions (key, legacy_num, label, section, field_type, required, ask_customer, sensitive, options, validation, help_text, sort_order)
values ('atm.price', null, 'ATM Price (per unit)', 'office', 'currency', false, false, false, null, null, 'Purchase order unit price — set by the office only.', 45)
on conflict (key) do nothing;
