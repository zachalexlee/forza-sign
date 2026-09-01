import { NextResponse } from "next/server";
import { logAuditEvent, requestMeta } from "@/lib/audit";
import { sendEmail, worksheetSubmittedEmail } from "@/lib/email";
import { customerWritableKeys, validateWorksheetData } from "@/lib/fields/schema";
import { encryptSensitiveValues } from "@/lib/fields/sensitive";
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
  const merged = {
    ...worksheet.data,
    ...encryptSensitiveValues(defs, incoming, worksheet.data),
  };

  // Full validation server-side — the browser's copy is advisory only.
  const issues = validateWorksheetData(defs, merged, { partial: false });
  if (issues.length > 0) {
    return NextResponse.json({ error: "validation_failed", issues }, { status: 422 });
  }

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
