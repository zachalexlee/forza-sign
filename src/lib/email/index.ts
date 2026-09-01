import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * All outbound mail goes through here so every send lands in email_log
 * (build plan §5). Without RESEND_API_KEY (local dev, preview) sends are
 * skipped but still logged, so flows remain testable end to end.
 */

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  template: string; // logical name, e.g. worksheet_invite
  org_id?: string;
  worksheet_id?: string;
  application_id?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Forza Sign <onboarding@resend.dev>";

  let providerMessageId: string | null = null;
  let status = "skipped_no_api_key";

  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
      if (error) {
        status = `error: ${error.message}`.slice(0, 200);
      } else {
        providerMessageId = data?.id ?? null;
        status = "sent";
      }
    } catch (err) {
      status = `error: ${err instanceof Error ? err.message : "unknown"}`.slice(0, 200);
    }
  }

  const supabase = createAdminClient();
  await supabase.from("email_log").insert({
    to_email: input.to,
    template: input.template,
    subject: input.subject,
    org_id: input.org_id,
    worksheet_id: input.worksheet_id,
    application_id: input.application_id,
    provider_message_id: providerMessageId,
    status,
  });
}

const wrapper = (body: string) => `
<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #18181b;">
  <h2 style="margin: 0 0 4px;">Forza Payments</h2>
  <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 12px 0 20px;" />
  ${body}
  <p style="color: #a1a1aa; font-size: 12px; margin-top: 32px;">
    Sent by Forza Sign on behalf of Forza Payments, Inc. If you weren't expecting this email, you can ignore it.
  </p>
</div>`;

export function worksheetInviteEmail(opts: {
  businessName: string;
  link: string;
  expiresDays: number;
}): { subject: string; html: string } {
  return {
    subject: "Forza Payments — ATM application worksheet",
    html: wrapper(`
      <p>Hello,</p>
      <p>To get started with your ATM application for <strong>${escapeHtml(opts.businessName)}</strong>,
      please fill out our online worksheet. It takes about 10 minutes, checks your entries as you type,
      and saves your progress automatically so you can return anytime.</p>
      <p style="margin: 24px 0;">
        <a href="${opts.link}" style="background: #18181b; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">
          Fill out the worksheet
        </a>
      </p>
      <p style="color:#71717a; font-size: 13px;">This link is unique to you and expires in ${opts.expiresDays} days. Please don't forward it.</p>
    `),
  };
}

export function worksheetSubmittedEmail(opts: {
  businessName: string;
  adminLink: string;
}): { subject: string; html: string } {
  return {
    subject: `Worksheet submitted: ${opts.businessName}`,
    html: wrapper(`
      <p>A customer worksheet was just submitted for <strong>${escapeHtml(opts.businessName)}</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="${opts.adminLink}" style="background: #18181b; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none;">
          Review it now
        </a>
      </p>
    `),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
