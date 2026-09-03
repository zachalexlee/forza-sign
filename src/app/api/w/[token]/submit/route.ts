import { NextResponse } from "next/server";
import { isRateLimited, rateLimitResponse } from "@/lib/rate-limit";
import { logAuditEvent, requestMeta } from "@/lib/audit";
import { sendEmail, worksheetSubmittedEmail } from "@/lib/email";
import { customerWritableKeys, validateWorksheetData } from "@/lib/fields/schema";
import { encryptSensitiveValues, validationView } from "@/lib/fields/sensitive";
import { WorksheetData } from "@/lib/fields/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadCustomerFieldDefinitions,
  validateWorksheetToken,
} from "@/lib/worksheets";

/** Final submit: full validation, snapshot, status → submitted, office email. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (isRateLimited(request, "worksheet_submit", 10)) return rateLimitResponse();
  const result = await validateWorksheetToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }

  let body: { data?: WorksheetData };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const defs = await loadCustomerFieldDefinitions();
  const writable = customerWritableKeys(defs);
  const incoming: WorksheetData = Object.fromEntries(
    Object.entries(body.data ?? {}).filter(([k]) => writable.has(k))
  );

  const { worksheet } = result;

  // Full validation server-side — the browser's copy is advisory only.
  // Validate the plaintext view: stored ciphertext becomes a masked sentinel
  // (= already provided), incoming plaintext is checked by the field schemas.
  // Validating after encryption would feed enc:v1: strings to the schemas
  // and reject every sensitive field.
  const issues = validateWorksheetData(
    defs,
    validationView(defs, incoming, worksheet.data),
    { partial: false }
  );
  if (issues.length > 0) {
    return NextResponse.json({ error: "validation_failed", issues }, { status: 422 });
  }

  const merged = {
    ...worksheet.data,
    ...encryptSensitiveValues(defs, incoming, worksheet.data),
  };

  const now = new Date().toISOString();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("worksheets")
    .update({
      data: merged,
      submitted_data: merged,
      status: "submitted",
      submitted_at: now,
    })
    .eq("id", worksheet.id);
  if (error) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  const meta = requestMeta(request);
  await logAuditEvent({
    event_type: "edited",
    org_id: worksheet.org_id,
    worksheet_id: worksheet.id,
    ...meta,
    meta: { action: "worksheet_submitted" },
  });

  const officeEmail = process.env.OFFICE_NOTIFY_EMAIL;
  if (officeEmail) {
    const businessName = worksheet.customers?.business_name ?? "a customer";
    const email = worksheetSubmittedEmail({
      businessName,
      adminLink: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/worksheets/${worksheet.id}`,
    });
    await sendEmail({
      to: officeEmail,
      ...email,
      template: "worksheet_submitted",
      org_id: worksheet.org_id,
      worksheet_id: worksheet.id,
    });
  }

  return NextResponse.json({ submitted: true });
}
