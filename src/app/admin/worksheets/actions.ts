"use server";

import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail, worksheetInviteEmail } from "@/lib/email";
import { validateWorksheetData } from "@/lib/fields/schema";
import { encryptSensitiveValues } from "@/lib/fields/sensitive";
import { WorksheetData } from "@/lib/fields/types";
import { requireStaff } from "@/lib/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { WORKSHEET_TOKEN_TTL_DAYS, generateToken, tokenExpiry } from "@/lib/tokens";
import { loadCustomerFieldDefinitions, worksheetUrl } from "@/lib/worksheets";

export interface CreateWorksheetResult {
  worksheetId: string;
  link: string;
  emailStatus: "sent" | "skipped";
}

/**
 * Create a customer + worksheet + tokenized link. When `sendInvite`, the
 * customer gets the invite email; otherwise the office copies the link
 * manually (or fills the worksheet themselves — manual-entry path).
 */
export async function createWorksheet(input: {
  businessName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  sendInvite: boolean;
}): Promise<CreateWorksheetResult> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const businessName = input.businessName.trim();
  if (!businessName) throw new Error("Business name is required");
  if (input.sendInvite && !input.email?.trim()) {
    throw new Error("Customer email is required to send an invite");
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      org_id: staff.orgId,
      business_name: businessName,
      contact_name: input.contactName?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
    })
    .select("id")
    .single();
  if (customerError) throw new Error(`Could not create customer: ${customerError.message}`);

  const { data: worksheet, error: worksheetError } = await supabase
    .from("worksheets")
    .insert({
      org_id: staff.orgId,
      customer_id: customer.id,
      status: "sent",
      created_by: staff.userId,
    })
    .select("id")
    .single();
  if (worksheetError) throw new Error(`Could not create worksheet: ${worksheetError.message}`);

  const { token, hash } = generateToken();
  const { error: linkError } = await supabase.from("worksheet_links").insert({
    worksheet_id: worksheet.id,
    token_hash: hash,
    expires_at: tokenExpiry(WORKSHEET_TOKEN_TTL_DAYS).toISOString(),
  });
  if (linkError) throw new Error(`Could not create link: ${linkError.message}`);

  await logAuditEvent({
    event_type: "created",
    org_id: staff.orgId,
    worksheet_id: worksheet.id,
    meta: { by: staff.fullName },
  });

  let emailStatus: "sent" | "skipped" = "skipped";
  if (input.sendInvite && input.email) {
    const email = worksheetInviteEmail({
      businessName,
      link: worksheetUrl(token),
      expiresDays: WORKSHEET_TOKEN_TTL_DAYS,
    });
    await sendEmail({
      to: input.email.trim(),
      ...email,
      template: "worksheet_invite",
      org_id: staff.orgId,
      worksheet_id: worksheet.id,
    });
    await logAuditEvent({
      event_type: "sent",
      org_id: staff.orgId,
      worksheet_id: worksheet.id,
    });
    emailStatus = "sent";
  }

  revalidatePath("/admin");
  return { worksheetId: worksheet.id, link: worksheetUrl(token), emailStatus };
}

/** Revoke existing links, mint a fresh one, optionally re-email it. */
export async function reissueWorksheetLink(
  worksheetId: string,
  sendInvite: boolean
): Promise<{ link: string }> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const { data: worksheet } = await supabase
    .from("worksheets")
    .select("id, org_id, customers(business_name, email)")
    .eq("id", worksheetId)
    .single();
  if (!worksheet) throw new Error("Worksheet not found");

  await supabase
    .from("worksheet_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("worksheet_id", worksheetId)
    .is("revoked_at", null);

  const { token, hash } = generateToken();
  const { error } = await supabase.from("worksheet_links").insert({
    worksheet_id: worksheetId,
    token_hash: hash,
    expires_at: tokenExpiry(WORKSHEET_TOKEN_TTL_DAYS).toISOString(),
  });
  if (error) throw new Error(`Could not create link: ${error.message}`);

  const customer = worksheet.customers as unknown as {
    business_name: string;
    email: string | null;
  } | null;

  await logAuditEvent({
    event_type: "sent",
    org_id: worksheet.org_id,
    worksheet_id: worksheetId,
    meta: { action: "link_reissued", by: staff.fullName },
  });

  if (sendInvite && customer?.email) {
    const email = worksheetInviteEmail({
      businessName: customer.business_name,
      link: worksheetUrl(token),
      expiresDays: WORKSHEET_TOKEN_TTL_DAYS,
    });
    await sendEmail({
      to: customer.email,
      ...email,
      template: "worksheet_invite",
      org_id: worksheet.org_id,
      worksheet_id: worksheetId,
    });
  }

  revalidatePath(`/admin/worksheets/${worksheetId}`);
  return { link: worksheetUrl(token) };
}

export interface SaveReviewResult {
  ok: boolean;
  issues?: { key: string; message: string }[];
}

/** Office edits on the review screen (same validation as the customer form). */
export async function saveWorksheetReview(input: {
  worksheetId: string;
  data: WorksheetData;
  reviewNotes: string;
  markReviewed: boolean;
}): Promise<SaveReviewResult> {
  const staff = await requireStaff();
  const supabase = createAdminClient();

  const { data: worksheet } = await supabase
    .from("worksheets")
    .select("id, org_id, data, status")
    .eq("id", input.worksheetId)
    .single();
  if (!worksheet) throw new Error("Worksheet not found");

  const defs = await loadCustomerFieldDefinitions();
  const merged = {
    ...worksheet.data,
    ...encryptSensitiveValues(defs, input.data, worksheet.data),
  };

  const issues = validateWorksheetData(defs, merged, {
    partial: !input.markReviewed,
  });
  if (input.markReviewed && issues.length > 0) {
    return { ok: false, issues };
  }

  const { error } = await supabase
    .from("worksheets")
    .update({
      data: merged,
      review_notes: input.reviewNotes || null,
      edited_by: staff.userId,
      edited_at: new Date().toISOString(),
      ...(input.markReviewed ? { status: "reviewed" } : {}),
    })
    .eq("id", input.worksheetId);
  if (error) throw new Error(`Save failed: ${error.message}`);

  await logAuditEvent({
    event_type: "edited",
    org_id: worksheet.org_id,
    worksheet_id: input.worksheetId,
    meta: {
      action: input.markReviewed ? "marked_reviewed" : "office_edit",
      by: staff.fullName,
    },
  });

  revalidatePath(`/admin/worksheets/${input.worksheetId}`);
  revalidatePath("/admin");
  return { ok: true };
}
