import { NextResponse } from "next/server";
import { isRateLimited, rateLimitResponse } from "@/lib/rate-limit";
import { logAuditEvent, requestMeta } from "@/lib/audit";
import { validateSigningToken } from "@/lib/signing";
import { createAdminClient } from "@/lib/supabase/admin";

/** ESIGN consent + identity confirmation (build plan §7.1/§7.6). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (isRateLimited(request, "sign_consent", 15)) return rateLimitResponse();
  const result = await validateSigningToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }

  let body: { consent?: boolean; confirmedName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  }
  const confirmedName = (body.confirmedName ?? "").trim();
  if (!confirmedName) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const meta = requestMeta(request);
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  await supabase
    .from("signers")
    .update({
      status: "consented",
      consent_given_at: result.signer.consent_given_at ?? now,
      ip: meta.ip,
      user_agent: meta.user_agent,
    })
    .eq("id", result.signer.id);

  if (result.application.status === "sent") {
    await supabase
      .from("applications")
      .update({ status: "viewed" })
      .eq("id", result.application.id);
  }

  await logAuditEvent({
    event_type: "consented",
    org_id: result.application.org_id,
    application_id: result.application.id,
    signer_id: result.signer.id,
    ...meta,
    meta: { confirmed_name: confirmedName },
  });

  return NextResponse.json({ ok: true });
}
