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
 *
 * Each reminder holds a short per-customer lease (reminder_state, migration
 * 00009) from rotation through delivery and rollback, so two reminders for
 * the same customer never overlap. The automatic count is reserved when the
 * lease is taken, so the cap can't be lost to a later failed write.
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
  | {
      ok: false;
      /** busy: another reminder holds the lease (or, automatic: not due / capped). */
      reason: "not_found" | "not_pending" | "no_email" | "send_failed" | "busy";
    };

type ReminderMode = { kind: "automatic" } | { kind: "manual"; by: string };
type ReminderKind = "signer" | "worksheet";

function modeMeta(mode: ReminderMode) {
  return mode.kind === "manual"
    ? { action: "manual_reminder", by: mode.by }
    : { action: "automatic_reminder" };
}

/** Longer than any one rotate + send + rollback; a crashed holder expires. */
const LEASE_SECONDS = 10 * 60;

/**
 * Run `fn` while holding the subject's lease. `fn` calls `delivered()` once a
 * reminder email is accepted, so the reservation (count + last-reminder time)
 * stands even if something after delivery fails; otherwise it's undone on
 * release. Returns null when the lease is held by someone else (or, for
 * automatic claims, when the subject is capped or not due).
 */
async function withLease<T>(
  kind: ReminderKind,
  subjectId: string,
  automatic: boolean,
  fn: (delivered: () => void) => Promise<T>
): Promise<T | null> {
  const supabase = createAdminClient();
  const { data: claims, error: claimError } = await supabase.rpc("claim_reminder", {
    p_kind: kind,
    p_subject_id: subjectId,
    p_automatic: automatic,
    p_max_automatic: MAX_AUTO_REMINDERS,
    p_not_since: new Date(Date.now() - reminderAfterDays() * DAY_MS).toISOString(),
    p_lease_seconds: LEASE_SECONDS,
  });
  const claim = (claims as { lock_id: string; prev_last_reminder_at: string | null }[] | null)?.[0];
  if (claimError || !claim) return null;

  let sent = false;
  try {
    return await fn(() => {
      sent = true;
    });
  } finally {
    // If this fails the lease simply expires; a delivered reminder stays counted.
    await supabase.rpc("release_reminder", {
      p_kind: kind,
      p_subject_id: subjectId,
      p_lock_id: claim.lock_id,
      p_sent: sent,
      p_automatic: automatic,
      p_prev_last_reminder_at: claim.prev_last_reminder_at,
    });
  }
}

async function withReminderLease(
  kind: ReminderKind,
  subjectId: string,
  mode: ReminderMode,
  send: (delivered: () => void) => Promise<ReminderResult>
): Promise<ReminderResult> {
  return (await withLease(kind, subjectId, mode.kind === "automatic", send)) ?? {
    ok: false,
    reason: "busy",
  };
}

/**
 * Every other rotation of a worksheet's links (staff reissuing a link) takes
 * the same lease, so it can never interleave with a reminder's rotation and
 * leave two valid customer links or revoke a link whose email is in flight.
 * Nothing is counted as a reminder. Returns null when a reminder holds the
 * lease right now.
 */
export async function withWorksheetLinkLease<T>(
  worksheetId: string,
  fn: () => Promise<T>
): Promise<T | null> {
  return withLease("worksheet", worksheetId, false, () => fn());
}

/** Remind one signer with a fresh signing link. */
export async function sendSigningReminder(
  signerId: string,
  mode: ReminderMode
): Promise<ReminderResult> {
  return withReminderLease("signer", signerId, mode, (delivered) =>
    remindSigner(signerId, mode, delivered)
  );
}

async function remindSigner(
  signerId: string,
  mode: ReminderMode,
  delivered: () => void
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

  // Compare-and-swap on the token we read: if anything else rotated it
  // since (e.g. a resend), back off rather than invalidate that link.
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
  delivered();

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
  return withReminderLease("worksheet", worksheetId, mode, (delivered) =>
    remindWorksheet(worksheetId, mode, delivered)
  );
}

async function remindWorksheet(
  worksheetId: string,
  mode: ReminderMode,
  delivered: () => void
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

  // Stamp our revocations with one timestamp so a rollback can undo exactly
  // these and nothing another rotation (e.g. staff reissuing) revoked.
  const revokedAt = new Date().toISOString();
  let revokedIds: string[] = [];
  if (activeIds.length > 0) {
    // Only revoke links that are still active; if something else already
    // rotated them (or the update fails), undo ours instead of leaving two
    // valid customer links.
    const { data: revoked, error: revokeError } = await supabase
      .from("worksheet_links")
      .update({ revoked_at: revokedAt })
      .in("id", activeIds)
      .is("revoked_at", null)
      .select("id");
    revokedIds = (revoked ?? []).map((l) => l.id);
    if (revokeError || revokedIds.length !== activeIds.length) {
      await rollBackWorksheetRotation(newLink.id, revokedIds, revokedAt);
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
    await rollBackWorksheetRotation(newLink.id, revokedIds, revokedAt);
    return { ok: false, reason: "send_failed" };
  }
  delivered();

  await logAuditEvent({
    event_type: "reminder_sent",
    org_id: worksheet.org_id,
    worksheet_id: worksheetId,
    meta: modeMeta(mode),
  });
  return { ok: true };
}

/**
 * Undo a worksheet link rotation, but only if it's still the latest one: if
 * our new link was already revoked, a later rotation superseded us and the
 * links we revoked must stay revoked.
 */
async function rollBackWorksheetRotation(
  newLinkId: string,
  revokedIds: string[],
  revokedAt: string
): Promise<void> {
  const supabase = createAdminClient();
  const { data: stillLive } = await supabase
    .from("worksheet_links")
    .delete()
    .eq("id", newLinkId)
    .is("revoked_at", null)
    .select("id");
  if (!stillLive || stillLive.length === 0) {
    await supabase.from("worksheet_links").delete().eq("id", newLinkId);
    return;
  }
  if (revokedIds.length > 0) {
    await supabase
      .from("worksheet_links")
      .update({ revoked_at: null })
      .in("id", revokedIds)
      .eq("revoked_at", revokedAt);
  }
}

/** Reminder bookkeeping for a batch of subjects; null if unreadable. */
async function loadReminderStates(
  kind: ReminderKind,
  ids: string[]
): Promise<Map<string, { autoSent: number; lastReminderAt: string | null }> | null> {
  const states = new Map<string, { autoSent: number; lastReminderAt: string | null }>();
  if (ids.length === 0) return states;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reminder_state")
    .select("subject_id, auto_reminders_sent, last_reminder_at")
    .eq("kind", kind)
    .in("subject_id", ids);
  if (error) return null;
  for (const row of data ?? []) {
    states.set(row.subject_id, {
      autoSent: row.auto_reminders_sent,
      lastReminderAt: row.last_reminder_at,
    });
  }
  return states;
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
  // An unreadable history must not look like "no reminders yet".
  const signerStates = await loadReminderStates(
    "signer",
    (signers ?? []).map((s) => s.id)
  );

  for (const signer of signerStates ? signers ?? [] : []) {
    const application = signer.applications as unknown as {
      status: string;
      sent_at: string | null;
    } | null;
    if (!application || !["sent", "viewed"].includes(application.status)) continue;
    // An expired link means the office let it lapse — don't revive it.
    if (signer.token_expires_at && new Date(signer.token_expires_at) <= now) continue;

    const state = signerStates?.get(signer.id);
    if (
      autoReminderDue({
        lastTouch: latest(application.sent_at, state?.lastReminderAt),
        autoRemindersSent: state?.autoSent ?? 0,
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
  const worksheetStates = await loadReminderStates(
    "worksheet",
    (worksheets ?? []).map((w) => w.id)
  );

  for (const worksheet of worksheetStates ? worksheets ?? [] : []) {
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

    const state = worksheetStates?.get(worksheet.id);
    if (
      autoReminderDue({
        // A customer who saved recently is actively working — don't nag.
        lastTouch: latest(lastEmail.sent_at, worksheet.updated_at, state?.lastReminderAt),
        autoRemindersSent: state?.autoSent ?? 0,
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
