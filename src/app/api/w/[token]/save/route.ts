import { NextResponse } from "next/server";
import { isRateLimited, rateLimitResponse } from "@/lib/rate-limit";
import { logAuditEvent, requestMeta } from "@/lib/audit";
import { customerWritableKeys, validateWorksheetData } from "@/lib/fields/schema";
import { encryptSensitiveValues } from "@/lib/fields/sensitive";
import { WorksheetData } from "@/lib/fields/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadCustomerFieldDefinitions,
  validateWorksheetToken,
} from "@/lib/worksheets";

/** Autosave for save-and-resume. Validates only the fields present. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (isRateLimited(request, "worksheet_save", 60)) return rateLimitResponse();
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
  if (!body.data || typeof body.data !== "object") {
    return NextResponse.json({ error: "missing_data" }, { status: 400 });
  }

  const defs = await loadCustomerFieldDefinitions();

  // Whitelist: the customer can only ever write dictionary keys marked
  // ask_customer. Anything else in the payload is dropped.
  const writable = customerWritableKeys(defs);
  const incoming: WorksheetData = Object.fromEntries(
    Object.entries(body.data).filter(([k]) => writable.has(k))
  );

  const issues = validateWorksheetData(defs, incoming, { partial: true });

  const { worksheet } = result;
  const merged = {
    ...worksheet.data,
    ...encryptSensitiveValues(defs, incoming, worksheet.data),
  };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("worksheets")
    .update({ data: merged, status: "in_progress" })
    .eq("id", worksheet.id);
  if (error) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  if (worksheet.status === "sent") {
    const meta = requestMeta(request);
    await logAuditEvent({
      event_type: "edited",
      org_id: worksheet.org_id,
      worksheet_id: worksheet.id,
      ...meta,
      meta: { action: "customer_started_filling" },
    });
  }

  return NextResponse.json({ saved: true, issues });
}
