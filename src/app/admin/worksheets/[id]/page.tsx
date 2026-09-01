import { notFound } from "next/navigation";
import { maskSensitiveValues } from "@/lib/fields/sensitive";
import { createClient } from "@/lib/supabase/server";
import { loadCustomerFieldDefinitions } from "@/lib/worksheets";
import { AdminWorksheetEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function WorksheetReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: worksheet } = await supabase
    .from("worksheets")
    .select(
      "id, status, data, submitted_data, submitted_at, review_notes, created_at, customers(business_name, contact_name, email, phone)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!worksheet) notFound();

  const { data: events } = await supabase
    .from("audit_events")
    .select("event_type, ts, meta")
    .eq("worksheet_id", id)
    .order("ts", { ascending: true });

  const defs = await loadCustomerFieldDefinitions(supabase);
  const { data: programs } = await supabase
    .from("programs")
    .select("code, name")
    .eq("active", true)
    .order("sort_order");
  const { data: applications } = await supabase
    .from("applications")
    .select("id, status, programs(name)")
    .eq("worksheet_id", id)
    .order("created_at", { ascending: false });
  const customer = worksheet.customers as unknown as {
    business_name: string;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;

  // Office-changed fields: current data vs the customer's submitted snapshot.
  const changedKeys = worksheet.submitted_data
    ? defs
        .map((d) => d.key)
        .filter(
          (key) =>
            JSON.stringify(worksheet.data?.[key] ?? null) !==
            JSON.stringify(worksheet.submitted_data?.[key] ?? null)
        )
    : [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{customer?.business_name}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {customer?.contact_name && `${customer.contact_name} · `}
          {customer?.email}
          {worksheet.submitted_at &&
            ` · submitted ${new Date(worksheet.submitted_at).toLocaleString()}`}
        </p>
      </div>
      <AdminWorksheetEditor
        worksheetId={worksheet.id}
        status={worksheet.status}
        definitions={defs}
        initialData={maskSensitiveValues(defs, worksheet.data ?? {})}
        submittedData={
          worksheet.submitted_data
            ? maskSensitiveValues(defs, worksheet.submitted_data)
            : null
        }
        initialChangedKeys={changedKeys}
        initialReviewNotes={worksheet.review_notes ?? ""}
        events={(events ?? []).map((e) => ({
          event_type: e.event_type,
          ts: e.ts,
          action: (e.meta as { action?: string })?.action,
        }))}
        programs={programs ?? []}
        applications={(applications ?? []).map((a) => ({
          id: a.id,
          status: a.status,
          programName:
            (a.programs as unknown as { name: string } | null)?.name ?? "—",
        }))}
      />
    </div>
  );
}
