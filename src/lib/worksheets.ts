import { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/tokens";
import { FieldDefinition } from "@/lib/fields/types";

export interface WorksheetRow {
  id: string;
  org_id: string;
  customer_id: string;
  status: "sent" | "in_progress" | "submitted" | "reviewed";
  data: Record<string, unknown>;
  submitted_data: Record<string, unknown> | null;
  submitted_at: string | null;
  review_notes: string | null;
  created_at: string;
  customers?: { business_name: string; contact_name: string | null; email: string | null };
}

export type TokenValidation =
  | { ok: true; worksheet: WorksheetRow; linkId: string }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "already_submitted" };

/**
 * Resolve a raw customer token to its worksheet. Lookup is by SHA-256 hash;
 * expired and revoked links are rejected (build plan §9).
 */
export async function validateWorksheetToken(token: string): Promise<TokenValidation> {
  const supabase = createAdminClient();

  const { data: link } = await supabase
    .from("worksheet_links")
    .select("id, worksheet_id, expires_at, revoked_at, opened_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!link) return { ok: false, reason: "not_found" };
  if (link.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const { data: worksheet } = await supabase
    .from("worksheets")
    .select("*, customers(business_name, contact_name, email)")
    .eq("id", link.worksheet_id)
    .maybeSingle();

  if (!worksheet) return { ok: false, reason: "not_found" };
  if (worksheet.status === "submitted" || worksheet.status === "reviewed") {
    return { ok: false, reason: "already_submitted" };
  }

  return { ok: true, worksheet: worksheet as WorksheetRow, linkId: link.id };
}

/** Customer-facing field definitions, ordered for the form. */
export async function loadCustomerFieldDefinitions(
  client?: SupabaseClient
): Promise<FieldDefinition[]> {
  const supabase = client ?? createAdminClient();
  const { data, error } = await supabase
    .from("field_definitions")
    .select("*")
    .eq("ask_customer", true)
    .order("section")
    .order("sort_order");
  if (error) throw new Error(`field_definitions load failed: ${error.message}`);
  return (data ?? []) as FieldDefinition[];
}

export function worksheetUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/w/${token}`;
}
