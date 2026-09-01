import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail, signingRequestEmail } from "@/lib/email";
import { signingUrl } from "@/lib/signing";
import { createAdminClient } from "@/lib/supabase/admin";
import { SIGNING_TOKEN_TTL_DAYS, generateToken, tokenExpiry } from "@/lib/tokens";

/**
 * Signing reminders (build plan §6.4), run daily by Vercel cron.
 * A signer gets a reminder when the request (or the last reminder) is more
 * than REMINDER_AFTER_DAYS old and they haven't finished.
 *
 * Only token hashes are stored, so each reminder rotates the signer's token:
 * the reminder email carries a fresh link and the old one stops working.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const afterDays = Number(process.env.REMINDER_AFTER_DAYS ?? 3);
  const cutoff = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createAdminClient();

  const { data: signers } = await supabase
    .from("signers")
    .select(
      "id, name, email, status, created_at, token_expires_at, applications(id, org_id, status, sent_at, programs(name), worksheets(customers(business_name)))"
    )
    .in("status", ["sent", "viewed", "consented"]);

  let sent = 0;
  for (const signer of signers ?? []) {
    const application = signer.applications as unknown as {
      id: string;
      org_id: string;
      status: string;
      sent_at: string | null;
      programs: { name: string } | null;
      worksheets: { customers: { business_name: string } | null } | null;
    } | null;
    if (!application) continue;
    if (!["sent", "viewed"].includes(application.status)) continue;
    if (
      signer.token_expires_at &&
      new Date(signer.token_expires_at).getTime() <= Date.now()
    ) {
      continue;
    }
    if (application.sent_at && application.sent_at > cutoff) continue;

    // Most recent reminder for this signer, if any.
    const { data: lastReminder } = await supabase
      .from("audit_events")
      .select("ts")
      .eq("signer_id", signer.id)
      .eq("event_type", "reminder_sent")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastReminder && lastReminder.ts > cutoff) continue;

    // Rotate the token: fresh link in the reminder, old link invalidated.
    // If the provider rejects the email, restore the old token so the
    // signer's original link keeps working and no reminder is recorded.
    const { data: current } = await supabase
      .from("signers")
      .select("token_hash, token_expires_at")
      .eq("id", signer.id)
      .single();
    if (!current) continue;

    const { token, hash } = generateToken();
    const { error: rotateError } = await supabase
      .from("signers")
      .update({
        token_hash: hash,
        token_expires_at: tokenExpiry(SIGNING_TOKEN_TTL_DAYS).toISOString(),
      })
      .eq("id", signer.id);
    if (rotateError) continue;

    const businessName =
      application.worksheets?.customers?.business_name ?? "your business";
    const documentName = application.programs?.name ?? "ATM application";
    const email = signingRequestEmail({
      signerName: signer.name,
      businessName,
      documentName,
      link: signingUrl(token),
      expiresDays: SIGNING_TOKEN_TTL_DAYS,
      reminder: true,
    });
    const delivery = await sendEmail({
      to: signer.email,
      ...email,
      template: "signing_reminder",
      org_id: application.org_id,
      application_id: application.id,
    });

    if (!delivery.ok) {
      await supabase
        .from("signers")
        .update({
          token_hash: current.token_hash,
          token_expires_at: current.token_expires_at,
        })
        .eq("id", signer.id);
      continue;
    }

    await logAuditEvent({
      event_type: "reminder_sent",
      org_id: application.org_id,
      application_id: application.id,
      signer_id: signer.id,
    });
    sent += 1;
  }

  return NextResponse.json({ reminders_sent: sent });
}
