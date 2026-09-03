import { WorksheetForm } from "@/components/worksheet/WorksheetForm";
import { logAuditEvent } from "@/lib/audit";
import { maskSensitiveValues } from "@/lib/fields/sensitive";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadCustomerFieldDefinitions,
  validateWorksheetToken,
} from "@/lib/worksheets";

export const dynamic = "force-dynamic";

const CLOSED_MESSAGES: Record<string, { title: string; body: string }> = {
  not_found: {
    title: "Link not found",
    body: "This worksheet link isn't valid. Please check the link in your email, or contact Forza Payments for a new one.",
  },
  expired: {
    title: "Link expired",
    body: "This worksheet link has expired. Contact Forza Payments and we'll send you a fresh one.",
  },
  revoked: {
    title: "Link no longer active",
    body: "A newer link has been issued for this worksheet. Please use the most recent email from Forza Payments.",
  },
  already_submitted: {
    title: "Already submitted",
    body: "This worksheet has been submitted — thank you! Our team is reviewing it and will be in touch.",
  },
};

export default async function WorksheetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await validateWorksheetToken(token);

  if (!result.ok) {
    const msg = CLOSED_MESSAGES[result.reason];
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center p-8 text-center">
        <h1 className="text-xl font-semibold">{msg.title}</h1>
        <p className="mt-3 text-sm text-zinc-600">{msg.body}</p>
      </main>
    );
  }

  const { worksheet, linkId } = result;
  const defs = await loadCustomerFieldDefinitions();

  // First open: record it (attribution trail starts at the first click).
  const supabase = createAdminClient();
  const { data: link } = await supabase
    .from("worksheet_links")
    .select("opened_at")
    .eq("id", linkId)
    .single();
  if (link && !link.opened_at) {
    await supabase
      .from("worksheet_links")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", linkId);
    await logAuditEvent({
      event_type: "opened",
      org_id: worksheet.org_id,
      worksheet_id: worksheet.id,
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/forza-payments.png" alt="Forza Payments" className="h-9 w-auto" />
        <h1 className="mt-4 text-2xl font-semibold">ATM Application Worksheet</h1>
        <p className="mt-2 text-sm text-zinc-600">
          For {worksheet.customers?.business_name}. Your progress saves
          automatically — you can close this page and come back with the same
          link.
        </p>
      </header>
      <WorksheetForm
        token={token}
        definitions={defs}
        initialData={maskSensitiveValues(defs, worksheet.data)}
      />
    </main>
  );
}
