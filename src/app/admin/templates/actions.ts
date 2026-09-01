"use server";

import { revalidatePath } from "next/cache";
import { MapEntry } from "@/lib/pdf/types";
import { validateMapEntries } from "@/lib/pdf/validate-map";
import { requireStaff } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Persist a template's field map (the admin mapper UI, build plan Phase 4).
 * Admin-only (mirrors the templates admin_write RLS policy), org-scoped.
 * Entries are validated against the dictionary, derived-rule, and transform
 * sets and sanitized before storage — the raw-JSON editor must not be able
 * to persist a map that breaks the next PDF regeneration.
 */
export async function saveTemplateMap(input: {
  templateId: string;
  fieldMap: MapEntry[];
}): Promise<{ ok: boolean; errors: string[] }> {
  const staff = await requireStaff();
  if (staff.role !== "admin") {
    throw new Error("Only admins can edit template mappings");
  }

  const supabase = createAdminClient();
  const { data: defs } = await supabase.from("field_definitions").select("key");
  const validKeys = new Set((defs ?? []).map((d) => d.key as string));

  const { errors, entries } = validateMapEntries(input.fieldMap, validKeys);
  if (errors.length > 0) return { ok: false, errors };

  const { data: template } = await supabase
    .from("templates")
    .select("id, programs(org_id)")
    .eq("id", input.templateId)
    .single();
  const templateOrg = (template?.programs as unknown as { org_id: string })?.org_id;
  if (!template || templateOrg !== staff.orgId) throw new Error("Template not found");

  const { error } = await supabase
    .from("templates")
    // 'custom' marks this mapping as office-edited: npm run sync:maps will
    // never overwrite it with repo-map updates.
    .update({ field_map: entries, map_source: "custom" })
    .eq("id", input.templateId);
  if (error) throw new Error(`Save failed: ${error.message}`);

  revalidatePath("/admin/templates");
  revalidatePath(`/admin/templates/${input.templateId}`);
  return { ok: true, errors: [] };
}
