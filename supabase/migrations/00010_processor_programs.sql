-- Processor-aware programs and template variants.
--
-- The office's scenario list (Nov 2026) is four deal structures per
-- processor: Placement / Cash Loading, Placement with Forza retaining the
-- first N transactions, Merchant-Owned / Merchant-Loaded, Merchant-Owned /
-- Third-Party Cash Loading — once for PAI (Payment Alliance International)
-- and once for DNS (Digital Network Solutions). DNS packets carry a
-- different ACH agreement and, for merchant-loaded ATMs, Security First
-- Bank's two-page SOFP agreement, so each DNS scenario is its own program
-- with its own blank.
--
-- Deal variations that only swap a paragraph (flat vs. tiered rebate) are
-- template *variants* of one program, chosen when the application is
-- created, so staff pick one bundle and one option instead of a bundle per
-- combination. "Forza retains the first N" has no variant yet: the count is
-- typed into the agreement text, not a fillable blank.

alter table programs add column processor text
  check (processor in ('PAI', 'DNS'));

update programs set processor = 'PAI' where code in ('pl-cl', 'mo-cl', 'mo-ml');
update programs set name = 'PAI – Placement / Cash Loading', sort_order = 1 where code = 'pl-cl';
update programs set name = 'PAI – Merchant-Owned / Third-Party Cash Loading', sort_order = 2 where code = 'mo-cl';
update programs set name = 'PAI – Merchant-Owned / Merchant-Loaded', sort_order = 3 where code = 'mo-ml';

-- Only where the Forza org already exists (production); a fresh database
-- gets these programs from seed.sql, which runs after the migrations.
insert into programs (org_id, code, name, processor, cash_loading, sort_order)
select o.id, v.code, v.name, 'DNS', v.cash_loading, v.sort_order
from organizations o
cross join (values
  ('dns-pl-cl', 'DNS – Placement / Cash Loading', true, 11),
  ('dns-mo-cl', 'DNS – Merchant-Owned / Third-Party Cash Loading', true, 12),
  ('dns-mo-ml', 'DNS – Merchant-Owned / Merchant-Loaded', false, 13)
) as v(code, name, cash_loading, sort_order)
where o.id = '00000000-0000-0000-0000-000000000001'
on conflict (code) do nothing;

-- One program, several blanks: 'standard' (flat rebate) or 'tiered'.
alter table templates add column variant text not null default 'standard';
alter table templates drop constraint templates_program_id_version_key;
alter table templates add constraint templates_program_variant_version_key
  unique (program_id, variant, version);

insert into templates (program_id, version, storage_path)
select p.id, 1, 'blanks/' || p.code || '-v1.pdf'
from programs p
where p.code in ('dns-pl-cl', 'dns-mo-cl', 'dns-mo-ml')
on conflict do nothing;

insert into templates (program_id, variant, version, storage_path)
select p.id, 'tiered', 1, 'blanks/pl-cl-tiered-v1.pdf'
from programs p
where p.code = 'pl-cl'
on conflict do nothing;

-- Office-set fields the new packets fill: the three tier rebates and the
-- cash-loading agreement term (its blank was pre-printed "2").
insert into field_definitions
  (key, legacy_num, label, section, field_type, required, ask_customer, sensitive, options, validation, help_text, sort_order)
values
('atm.rebate_tier1', null, 'Rebate — 1 to 249 transactions / month', 'office', 'currency', false, false, false,
  null, null, 'Tiered-rebate packets only.', 21),
('atm.rebate_tier2', null, 'Rebate — 250 to 499 transactions / month', 'office', 'currency', false, false, false,
  null, null, 'Tiered-rebate packets only.', 22),
('atm.rebate_tier3', null, 'Rebate — 500+ transactions / month', 'office', 'currency', false, false, false,
  null, null, 'Tiered-rebate packets only.', 23),
('atm.loading_term_years', null, 'Cash Loading Agreement Term (years)', 'office', 'number', false, false, false,
  null, '{"min": 1, "default": 2}', 'Initial term of the ATM Cash Loading Agreement.', 46)
on conflict (key) do nothing;
