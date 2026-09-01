-- Forza Sign — seed data
-- Org, programs, and the canonical field dictionary from build plan Appendix A.
-- legacy_num preserves the office manager's 1–38 numbering.

insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Forza Payments, Inc.')
on conflict do nothing;

insert into programs (org_id, code, name, cash_loading, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'mo-ml', 'Merchant Owned / Merchant Load', false, 1),
  ('00000000-0000-0000-0000-000000000001', 'mo-cl', 'Merchant Owned / Cash Loading', true, 2),
  ('00000000-0000-0000-0000-000000000001', 'pl-cl', 'Placement / Cash Loading', true, 3)
on conflict (code) do nothing;

-- Template rows per program. The two cash-loading programs share one packet
-- (same storage path). Field maps live in src/lib/pdf/maps until the Phase 4
-- mapper UI; blank PDFs are uploaded from the admin UI into the templates
-- bucket at these paths.
insert into templates (program_id, version, storage_path)
select p.id, 1, case when p.code = 'mo-ml' then 'blanks/mo-ml-v1.pdf' else 'blanks/cl-v1.pdf' end
from programs p
where p.code in ('mo-ml', 'mo-cl', 'pl-cl')
on conflict (program_id, version) do nothing;

-- ---------------------------------------------------------------------------
-- Field dictionary (Appendix A)
-- columns: key, legacy_num, label, section, field_type, required,
--          ask_customer, sensitive, options, validation, help_text, sort_order
-- ---------------------------------------------------------------------------
insert into field_definitions
  (key, legacy_num, label, section, field_type, required, ask_customer, sensitive, options, validation, help_text, sort_order)
values
-- Business Information ------------------------------------------------------
('business.open_date', 1, 'Business Opening Date', 'business', 'date', true, true, false,
  null, '{"allow_future": true}', 'If your business has not opened yet, enter the planned opening date.', 10),
('business.legal_name', 2, 'Full Legal Name of Business', 'business', 'text', true, true, false,
  null, null, null, 20),
('business.ein', 3, 'Tax I.D. / EIN #', 'business', 'ein', true, true, false,
  null, '{"format": "XX-XXXXXXX"}', 'Sole proprietors without an EIN may use their SSN on the W-9.', 30),
('business.classification', 4, 'Business Classification', 'business', 'select', true, true, false,
  '[{"value":"llc_s","label":"LLC – S Corp"},{"value":"llc_c","label":"LLC – C Corp"},{"value":"corporation","label":"Corporation"},{"value":"partnership","label":"Partnership"},{"value":"sole_prop","label":"Sole Proprietor"}]',
  null, null, 40),
('business.dba', 5, 'DBA Name of Business', 'business', 'text', true, true, false,
  null, null, null, 50),
('location.street', 6, 'Business Address — Street', 'business', 'text', true, true, false,
  null, null, null, 60),
('location.city', 7, 'Business Address — City', 'business', 'text', true, true, false,
  null, null, null, 70),
('location.state', 8, 'Business Address — State', 'business', 'state', true, true, false,
  null, null, null, 80),
('location.zip', 9, 'Business Address — ZIP', 'business', 'zip', true, true, false,
  null, null, null, 90),
('location.phone', 10, 'Business Phone Number', 'business', 'phone', true, true, false,
  null, null, null, 100),
('business.start_date', 11, 'Business Start Date', 'business', 'date', true, true, false,
  null, null, 'Years in business is derived from this date.', 110),
('location.years_at_location', 12, 'Years at Location', 'business', 'number', true, true, false,
  null, '{"min": 0}', null, 120),

-- Business Owner's Information ----------------------------------------------
('owner.legal_name', 13, 'Owner''s Legal Name', 'owner', 'text', true, true, false,
  null, null, 'Used as the signer name on every signature block.', 10),
('owner.equity_pct', 14, 'Percentage of Ownership', 'owner', 'number', true, true, false,
  null, '{"min": 0, "max": 100}', null, 20),
('owner.ssn', 15, 'Owner''s SSN', 'owner', 'ssn', true, true, true,
  null, null, 'Encrypted at rest; only the last 4 digits are displayed.', 30),
('owner.dob', 16, 'Owner''s Date of Birth', 'owner', 'date', true, true, false,
  null, '{"min_age": 18}', null, 40),
('owner.drivers_license', 17, 'Driver''s License # and State Issued', 'owner', 'text', true, true, false,
  null, null, null, 50),
('owner.cell_phone', 18, 'Owner''s Mobile Number', 'owner', 'phone', true, true, false,
  null, null, null, 60),
('owner.home_street', 19, 'Owner''s Home Address — Street', 'owner', 'text', true, true, false,
  null, null, null, 70),
('owner.home_city', 20, 'Owner''s Home Address — City', 'owner', 'text', true, true, false,
  null, null, null, 80),
('owner.home_state', 21, 'Owner''s Home Address — State', 'owner', 'state', true, true, false,
  null, null, null, 90),
('owner.home_zip', 22, 'Owner''s Home Address — ZIP', 'owner', 'zip', true, true, false,
  null, null, null, 100),
('owner.email', 23, 'Owner''s Email Address', 'owner', 'email', true, true, false,
  null, null, 'The signing link is sent to this address.', 110),

-- Store Contact Information -------------------------------------------------
('contact.name', 24, 'Store Contact''s Name', 'contact', 'text', false, true, false,
  null, null, 'Also the "Manager" on the cover sheet and "Contact" on the ACH form.', 10),
('contact.job_title', 25, 'Store Contact''s Job Title', 'contact', 'text', false, true, false,
  null, null, null, 20),
('contact.phone', 26, 'Store Contact''s Phone Number', 'contact', 'phone', false, true, false,
  null, null, null, 30),
('contact.email', 27, 'Store Contact''s Email', 'contact', 'email', false, true, false,
  null, null, null, 40),

-- ATM Installation Information ----------------------------------------------
('install.shipping_same_as_business', null, 'Ship ATM to the business address?', 'install', 'boolean', true, true, false,
  null, null, null, 5),
('install.shipping_address', 28, 'Shipping Address for ATM', 'install', 'text', false, true, false,
  null, '{"visible_if": {"install.shipping_same_as_business": false}}',
  'Only printed on the application if different from the business address.', 10),
('install.subflooring', 29, 'Type of Subflooring', 'install', 'select', true, true, false,
  '[{"value":"wood","label":"Wood"},{"value":"cement","label":"Cement"}]', null, null, 20),
('install.surcharge_suggestion', null, 'Desired ATM Surcharge', 'install', 'currency', false, true, false,
  null, null,
  'Suggestion only — the office sets the final surcharge. Never auto-populates the application.', 30),
('install.floor_level', null, 'ATM Location Floor Level', 'install', 'select', false, true, false,
  '[{"value":"ground","label":"Ground level"},{"value":"upstairs","label":"Upstairs"},{"value":"downstairs","label":"Downstairs"}]',
  null, 'Informational only; not mapped to the application.', 40),
('install.internet_ready', null, 'Has internet been run to the ATM location?', 'install', 'boolean', false, true, false,
  null, null, 'Informational only; not mapped to the application.', 50),
('install.wireless_box', 30, 'Do you require a wireless box?', 'install', 'boolean', true, true, false,
  null, null, 'Adds the $25.95/mo wireless fee on the application.', 60),
('install.cash_loader_name', null, 'Who will load cash into the ATM?', 'install', 'text', false, true, false,
  null, '{"visible_if_program": ["mo-ml"]}',
  'Merchant Load programs only; cash-loading programs use the constant "Forza Cash Loader".', 70),

-- Bank Account Information ---------------------------------------------------
('bank.name', 31, 'Name of Bank', 'bank', 'text', true, true, false,
  null, null, null, 10),
('bank.account_name', 32, 'Name on Bank Account', 'bank', 'text', true, true, false,
  null, null, 'Also used as the legal name of the ATM Operator (ACH form) and W-9 line 1.', 20),
('bank.routing', 33, 'Routing Number', 'bank', 'routing', true, true, false,
  null, '{"checksum": "aba"}', null, 30),
('bank.account_number', 34, 'Account Number', 'bank', 'account_number', true, true, true,
  null, null, 'Encrypted at rest; masked in the UI.', 40),
('bank.street', 35, 'Address for Account — Street', 'bank', 'text', true, true, false,
  null, null, 'The W-9 must match the bank account name and address.', 50),
('bank.city', 36, 'Address for Account — City', 'bank', 'text', true, true, false,
  null, null, null, 60),
('bank.state', 37, 'Address for Account — State', 'bank', 'state', true, true, false,
  null, null, null, 70),
('bank.zip', 38, 'Address for Account — ZIP', 'bank', 'zip', true, true, false,
  null, null, null, 80),
('bank.voided_check', null, 'Copy of Voided Check', 'bank', 'file', true, true, false,
  null, '{"accept": ["image/*", "application/pdf"]}', null, 90),

-- Office-set fields (never asked of the customer) ----------------------------
('atm.surcharge', null, 'ATM Surcharge', 'office', 'currency', false, false, false,
  null, null, 'Office-set; customer suggestion shown alongside.', 10),
('atm.rebate', null, 'Merchant Surcharge Rebate', 'office', 'currency', false, false, false,
  null, null, null, 20),
('atm.make_model', null, 'ATM Make / Model', 'office', 'text', false, false, false,
  null, null, null, 30),
('atm.count', null, 'Number of ATMs', 'office', 'number', false, false, false,
  null, '{"min": 1}', null, 40),
('sales.rep_name', null, 'Sales Representative', 'office', 'text', false, false, false,
  null, '{"default": "Lee Boys/"}', null, 50)
on conflict (key) do nothing;
