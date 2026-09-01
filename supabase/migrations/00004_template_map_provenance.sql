-- Track where a template's field_map came from, so repo-map updates can be
-- rolled out without clobbering office-edited mappings:
--   map_source 'repo'   → seeded by npm run sync:maps; safe to auto-update
--                         when the in-repo map's version is newer
--   map_source 'custom' → saved from the mapper UI; never auto-updated
-- Rows with a NULL map_source and a non-empty field_map predate this column
-- and were seeded from the repo (the mapper UI did not exist before it) —
-- sync:maps treats them as 'repo'.
alter table templates add column map_source text
  check (map_source in ('repo', 'custom'));
alter table templates add column map_version int not null default 0;
