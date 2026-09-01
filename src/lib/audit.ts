import { createAdminClient } from "@/lib/supabase/admin";

type AuditEventType =
  | "created"
  | "sent"
  | "email_delivered"
  | "opened"
  | "consented"
  | "field_signed"
  | "signed"
  | "completed"
  | "edited"
  | "voided"
  | "declined"
  | "reminder_sent";

export interface AuditEventInput {
  event_type: AuditEventType;
  org_id?: string;
  worksheet_id?: string;
  application_id?: string;
  signer_id?: string;
  ip?: string | null;
  user_agent?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Append to the audit trail. Never include sensitive plaintext in `meta` —
 * the trail is rendered onto the signing certificate.
 */
export async function logAuditEvent(event: AuditEventInput): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("audit_events").insert({
    ...event,
    meta: event.meta ?? {},
  });
  if (error) {
    // Auditing must not take down the main flow, but always leave a trace.
    console.error("audit_events insert failed", error.message, event.event_type);
  }
}

export function requestMeta(request: Request): { ip: string | null; user_agent: string | null } {
  const forwarded = request.headers.get("x-forwarded-for");
  return {
    ip: forwarded ? forwarded.split(",")[0].trim() : null,
    user_agent: request.headers.get("user-agent"),
  };
}
