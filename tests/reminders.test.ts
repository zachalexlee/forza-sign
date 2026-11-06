import { describe, expect, it } from "vitest";
import { MAX_AUTO_REMINDERS, autoReminderDue, latest } from "@/lib/reminders";

const now = new Date("2026-09-23T16:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("autoReminderDue", () => {
  it("fires once the quiet period has passed", () => {
    expect(autoReminderDue({ lastTouch: daysAgo(3), autoRemindersSent: 0, afterDays: 3, now })).toBe(true);
    expect(autoReminderDue({ lastTouch: daysAgo(5), autoRemindersSent: 1, afterDays: 3, now })).toBe(true);
  });

  it("waits while the last touch is recent", () => {
    expect(autoReminderDue({ lastTouch: daysAgo(2.9), autoRemindersSent: 0, afterDays: 3, now })).toBe(false);
  });

  it("stops after the cap", () => {
    expect(
      autoReminderDue({ lastTouch: daysAgo(30), autoRemindersSent: MAX_AUTO_REMINDERS, afterDays: 3, now })
    ).toBe(false);
  });

  it("never fires without a known send time", () => {
    expect(autoReminderDue({ lastTouch: null, autoRemindersSent: 0, afterDays: 3, now })).toBe(false);
  });
});

describe("latest", () => {
  it("picks the most recent timestamp and skips blanks", () => {
    expect(latest(daysAgo(5), null, daysAgo(1), undefined, daysAgo(3))).toBe(daysAgo(1));
    expect(latest(null, undefined)).toBeNull();
  });
});
