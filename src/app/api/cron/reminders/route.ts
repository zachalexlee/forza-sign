import { NextResponse } from "next/server";
import { runAutomaticReminders } from "@/lib/reminders";

/**
 * Daily reminder sweep (Vercel cron, see vercel.json): unsigned signing
 * requests and unfinished worksheets get a nudge after REMINDER_AFTER_DAYS
 * of quiet, up to MAX_AUTO_REMINDERS each. Logic lives in lib/reminders.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runAutomaticReminders();
  return NextResponse.json({
    reminders_sent: result.signingReminders + result.worksheetReminders,
    ...result,
  });
}
