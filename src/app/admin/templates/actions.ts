"use server";

import { revalidatePath } from "next/cache";
import { MapEntry } from "@/lib/pdf/types";
import { requireStaff } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Persist a template's field map (the admin mapper UI, build plan Phase 4).
 * Admin-only (mirrors the templates admin_write RLS policy), org-scoped.
 */
export async function saveTemplateMap(input: {
  templateId: string;
  fieldMap: MapEntry[];
}): Promise<{ ok: boolean; errors: string[] }> {
  const staff = await requireStaff();
  if (staff.role !== "admin") {
    throw new Error("Only admins can edit template mappings");
  }

  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of input.fieldMap.entries()) {
    if (!entry || typeof entry.pdf !== "string" || !entry.pdf.trim()) {
      errors.push(`Row ${i + 1}: missing PDF field name`);
      continue;
    }
    const sources = [entry.source, entry.const, entry.derived].filter(
      (v) => v !== undefined && v !== ""
    );
    if (sources.length !== 1) {
      errors.push(`${entry.pdf}: set exactly one of dictionary key / constant / derived rule`);
    }
    // Same PDF field mapped twice is almost always a mistake (per-digit
    // boxes use distinct names, so duplicates aren't needed).
    if (seen.has(entry.pdf)) errors.push(`${entry.pdf}: mapped more than once`);
    seen.add(entry.pdf);
  }
  if (errors.length > 0) return { ok: false, errors };

  const supabase = createAdminClient();
  const { data: template } = await supabase
    .from("templates")
    .select("id, programs(org_id)")
    .eq("id", input.templateId)
    .single();
  const templateOrg = (template?.programs as unknown as { org_id: string })?.org_id;
  if (!template || templateOrg !== staff.orgId) throw new Error("Template not found");

  const { error } = await supabase
    .from("templates")
    .update({ field_map: input.fieldMap })
    .eq("id", input.templateId);
  if (error) throw new Error(`Save failed: ${error.message}`);

  revalidatePath("/admin/templates");
  revalidatePath(`/admin/templates/${input.templateId}`);
  return { ok: true, errors: [] };
}
