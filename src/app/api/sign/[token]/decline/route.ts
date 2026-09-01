import { NextResponse } from "next/server";
import { logAuditEvent, requestMeta } from "@/lib/audit";
import { validateSigningToken } from "@/lib/signing";
import { createAdminClient } from "@/lib/supabase/admin";

/** Optional decline-with-reason (build plan §6.3). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = await validateSigningToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }

  let body: { reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim().slice(0, 2000);

  const meta = requestMeta(request);
  const supabase = createAdminClient();

  await supabase
    .from("signers")
    .update({ status: "declined", declined_reason: reason || null })
    .eq("id", result.signer.id);
  await supabase
    .from("applications")
    .update({ status: "declined" })
    .eq("id", result.application.id);

  await logAuditEvent({
    event_type: "declined",
    org_id: result.application.org_id,
    application_id: result.application.id,
    signer_id: result.signer.id,
    ...meta,
    meta: reason ? { reason } : {},
  });

  return NextResponse.json({ ok: true });
}
