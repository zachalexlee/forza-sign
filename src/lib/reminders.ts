import { logAuditEvent } from "@/lib/audit";
import { sendEmail, signingRequestEmail, worksheetInviteEmail } from "@/lib/email";
import { signingUrl } from "@/lib/signing";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SIGNING_TOKEN_TTL_DAYS,
  WORKSHEET_TOKEN_TTL_DAYS,
  generateToken,
  tokenExpiry,
} from "@/lib/tokens";
import { worksheetUrl } from "@/lib/worksheets";

/**
 * Reminder emails for customers who haven't finished (build plan §6.4):
 * unsigned signing requests and unfinished worksheets. The daily cron sends
 * automatic ones; staff can also send one on demand.
 *
 * Only token hashes are stored, so every reminder rotates the customer's
 * token: the email carries a fresh link and the older link stops working.
 * If the provider rejects the email, the rotation is rolled back so the
 * customer's existing link keeps working and no reminder is recorded.
 */

/** Days of quiet before an automatic reminder (REMINDER_AFTER_DAYS). */
export function reminderAfterDays(): number {
  const n = Number(process.env.REMINDER_AFTER_DAYS ?? 3);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** Automatic reminders stop after this many — nobody is nagged forever. */
export const MAX_AUTO_REMINDERS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is an automatic reminder due? `lastTouch` is the latest of the original
 * send, the last reminder, or (worksheets) the customer's last save.
 */
export function autoReminderDue(opts: {
  lastTouch: string | Date | null;
  autoRemindersSent: number;
  afterDays: number;
  now?: Date;
}): boolean {
  if (opts.autoRemindersSent >= MAX_AUTO_REMINDERS) return false;
  if (!opts.lastTouch) return false;
  const now = (opts.now ?? new Date()).getTime();
  return now - new Date(opts.lastTouch).getTime() >= opts.afterDays * DAY_MS;
}

export function latest(...dates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (d && (!best || new Date(d).getTime() > new Date(best).getTime())) best = d;
  }
  return best;
}

export type ReminderResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "no_email" | "send_failed" };

type ReminderMode = { kind: "automatic" } | { kind: "manual"; by: string };

function modeMeta(mode: ReminderMode) {
  return mode.kind === "manual"
    ? { action: "manual_reminder", by: mode.by }
    : { action: "automatic_reminder" };
}

/** Remind one signer with a fresh signing link. */
export async function sendSigningReminder(
  signerId: string,
  mode: ReminderMode
): Promise<ReminderResult> {
  const supabase = createAdminClient();
  const { data: signer } = await supabase
    .from("signers")
    .select(
      "id, name, email, status, token_hash, token_expires_at, applications(id, org_id, status, programs(name), worksheets(customers(business_name)))"
    )
    .eq("id", signerId)
    .maybeSingle();
  if (!signer) return { ok: false, reason: "not_found" };

  const application = signer.applications as unknown as {
    id: string;
    org_id: string;
    status: string;
    programs: { name: string } | null;
    worksheets: { customers: { business_name: string } | null } | null;
  } | null;
  if (!application) return { ok: false, reason: "not_found" };
  if (
    !["sent", "viewed", "consented"].includes(signer.status) ||
    !["sent", "viewed"].includes(application.status)
  ) {
    return { ok: false, reason: "not_pending" };
  }

  // Compare-and-swap on the current token: if another reminder (cron vs.
  // staff button) rotated it since we read it, back off rather than
  // invalidate the link that one just emailed.
  const { token, hash } = generateToken();
  const { data: rotated, error: rotateError } = await supabase
    .from("signers")
    .update({
      token_hash: hash,
      token_expires_at: tokenExpiry(SIGNING_TOKEN_TTL_DAYS).toISOString(),
    })
    .eq("id", signer.id)
    .eq("token_hash", signer.token_hash)
    .select("id");
  if (rotateError || !rotated || rotated.length === 0) {
    return { ok: false, reason: "send_failed" };
  }

  const delivery = await sendEmail({
    to: signer.email,
    ...signingRequestEmail({
      signerName: signer.name,
      businessName: application.worksheets?.customers?.business_name ?? "your business",
      documentName: application.programs?.name ?? "ATM application",
      link: signingUrl(token),
      expiresDays: SIGNING_TOKEN_TTL_DAYS,
      reminder: true,
    }),
    template: "signing_reminder",
    org_id: application.org_id,
    application_id: application.id,
  });

  if (!delivery.ok) {
    // Roll back only if the token is still ours.
    await supabase
      .from("signers")
      .update({ token_hash: signer.token_hash, token_expires_at: signer.token_expires_at })
      .eq("id", signer.id)
      .eq("token_hash", hash);
    return { ok: false, reason: "send_failed" };
  }

  await logAuditEvent({
    event_type: "reminder_sent",
    org_id: application.org_id,
    application_id: application.id,
    signer_id: signer.id,
    meta: modeMeta(mode),
  });
  return { ok: true };
}

/** Remind a customer to finish their worksheet, with a fresh link. */
export async function sendWorksheetReminder(
  worksheetId: string,
  mode: ReminderMode
): Promise<ReminderResult> {
  const supabase = createAdminClient();
  const { data: worksheet } = await supabase
    .from("worksheets")
    .select("id, org_id, status, customers(business_name, email)")
    .eq("id", worksheetId)
    .maybeSingle();
  if (!worksheet) return { ok: false, reason: "not_found" };
  if (!["sent", "in_progress"].includes(worksheet.status)) {
    return { ok: false, reason: "not_pending" };
  }
  const customer = worksheet.customers as unknown as {
    business_name: string;
    email: string | null;
  } | null;
  if (!customer?.email) return { ok: false, reason: "no_email" };

  const { data: activeLinks, error: activeError } = await supabase
    .from("worksheet_links")
    .select("id")
    .eq("worksheet_id", worksheetId)
    .is("revoked_at", null);
  if (activeError) return { ok: false, reason: "send_failed" };
  const activeIds = (activeLinks ?? []).map((l) => l.id);

  const { token, hash } = generateToken();
  const { data: newLink, error: linkError } = await supabase
    .from("worksheet_links")
    .insert({
      worksheet_id: worksheetId,
      token_hash: hash,
      expires_at: tokenExpiry(WORKSHEET_TOKEN_TTL_DAYS).toISOString(),
    })
    .select("id")
    .single();
  if (linkError || !newLink) return { ok: false, reason: "send_failed" };

  if (activeIds.length > 0) {
    // Only revoke links that are still active; if another reminder already
    // rotated them (or the update fails), undo ours instead of leaving two
    // valid customer links.
    const { data: revoked, error: revokeError } = await supabase
      .from("worksheet_links")
      .update({ revoked_at: new Date().toISOString() })
      .in("id", activeIds)
      .is("revoked_at", null)
      .select("id");
    if (revokeError || !revoked || revoked.length !== activeIds.length) {
      await supabase.from("worksheet_links").delete().eq("id", newLink.id);
      const ours = (revoked ?? []).map((l) => l.id);
      if (ours.length > 0) {
        await supabase.from("worksheet_links").update({ revoked_at: null }).in("id", ours);
      }
      return { ok: false, reason: "send_failed" };
    }
  }

  const delivery = await sendEmail({
    to: customer.email,
    ...worksheetInviteEmail({
      businessName: customer.business_name,
      link: worksheetUrl(token),
      expiresDays: WORKSHEET_TOKEN_TTL_DAYS,
      reminder: true,
    }),
    template: "worksheet_reminder",
    org_id: worksheet.org_id,
    worksheet_id: worksheetId,
  });

  if (!delivery.ok) {
    await supabase.from("worksheet_links").delete().eq("id", newLink.id);
    if (activeIds.length > 0) {
      await supabase.from("worksheet_links").update({ revoked_at: null }).in("id", activeIds);
    }
    return { ok: false, reason: "send_failed" };
  }

  await logAuditEvent({
    event_type: "reminder_sent",
    org_id: worksheet.org_id,
    worksheet_id: worksheetId,
    meta: modeMeta(mode),
  });
  return { ok: true };
}

/** Daily sweep: automatic reminders for everything that's gone quiet. */
export async function runAutomaticReminders(now: Date = new Date()): Promise<{
  signingReminders: number;
  worksheetReminders: number;
}> {
  const supabase = createAdminClient();
  const afterDays = reminderAfterDays();
  let signingReminders = 0;
  let worksheetReminders = 0;

  // Unsigned signing requests.
  const { data: signers } = await supabase
    .from("signers")
    .select("id, status, token_expires_at, applications(status, sent_at)")
    .in("status", ["sent", "viewed", "consented"]);

  for (const signer of signers ?? []) {
    const application = signer.applications as unknown as {
      status: string;
      sent_at: string | null;
    } | null;
    if (!application || !["sent", "viewed"].includes(application.status)) continue;
    // An expired link means the office let it lapse — don't revive it.
    if (signer.token_expires_at && new Date(signer.token_expires_at) <= now) continue;

    const { data: reminders, error: remindersError } = await supabase
      .from("audit_events")
      .select("ts, meta")
      .eq("signer_id", signer.id)
      .eq("event_type", "reminder_sent")
      .order("ts", { ascending: false });
    // An unreadable history must not look like "no reminders yet".
    if (remindersError) continue;
    const autoSent = (reminders ?? []).filter(
      (r) => (r.meta as { action?: string } | null)?.action !== "manual_reminder"
    ).length;

    if (
      autoReminderDue({
        lastTouch: latest(application.sent_at, reminders?.[0]?.ts),
        autoRemindersSent: autoSent,
        afterDays,
        now,
      }) &&
      (await sendSigningReminder(signer.id, { kind: "automatic" })).ok
    ) {
      signingReminders += 1;
    }
  }

  // Unfinished worksheets that were emailed to the customer.
  const { data: worksheets } = await supabase
    .from("worksheets")
    .select("id, updated_at")
    .in("status", ["sent", "in_progress"]);

  for (const worksheet of worksheets ?? []) {
    const { data: lastEmail, error: lastEmailError } = await supabase
      .from("email_log")
      .select("sent_at")
      .eq("worksheet_id", worksheet.id)
      .in("template", ["worksheet_invite", "worksheet_reminder"])
      .not("status", "like", "error%")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Never emailed (office filling it in, or link handed over manually).
    if (lastEmailError || !lastEmail) continue;

    const { data: reminders, error: remindersError } = await supabase
      .from("audit_events")
      .select("meta")
      .eq("worksheet_id", worksheet.id)
      .eq("event_type", "reminder_sent");
    if (remindersError) continue;
    const autoSent = (reminders ?? []).filter(
      (r) => (r.meta as { action?: string } | null)?.action !== "manual_reminder"
    ).length;

    if (
      autoReminderDue({
        // A customer who saved recently is actively working — don't nag.
        lastTouch: latest(lastEmail.sent_at, worksheet.updated_at),
        autoRemindersSent: autoSent,
        afterDays,
        now,
      }) &&
      (await sendWorksheetReminder(worksheet.id, { kind: "automatic" })).ok
    ) {
      worksheetReminders += 1;
    }
  }

  return { signingReminders, worksheetReminders };
}
