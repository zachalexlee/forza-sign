import { notFound } from "next/navigation";
import { maskSensitiveValues } from "@/lib/fields/sensitive";
import { FieldDefinition } from "@/lib/fields/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ApplicationEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, status, data, filled_pdf_path, final_pdf_path, sha256_final, created_at, programs(code, name), templates(id, storage_path), worksheets(id, customers(business_name))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!application) notFound();

  const { data: signers } = await supabase
    .from("signers")
    .select("name, email, status, signed_at")
    .eq("application_id", id)
    .order("sign_order");

  // Newest 200 (never silently drop the signing/completion tail), shown oldest-first.
  const { data: eventsDesc } = await supabase
    .from("audit_events")
    .select("id, event_type, ts, ip, meta")
    .eq("application_id", id)
    .order("ts", { ascending: false })
    .limit(200);
  const events = (eventsDesc ?? []).reverse();

  const { data: allDefs } = await supabase
    .from("field_definitions")
    .select("*")
    .order("section")
    .order("sort_order");
  const defs = (allDefs ?? []) as FieldDefinition[];
  const officeDefs = defs.filter((d) => !d.ask_customer);

  const program = application.programs as unknown as { code: string; name: string };
  const template = application.templates as unknown as {
    id: string;
    storage_path: string | null;
  };
  const business = (
    application.worksheets as unknown as {
      id: string;
      customers: { business_name: string } | null;
    }
  )?.customers?.business_name;

  // Streamed through the authenticated pdf route — a signed URL minted at
  // render time expires while the page sits open (broken iframe + download).
  const admin = createAdminClient();
  const pdfUrl =
    application.final_pdf_path || application.filled_pdf_path
      ? `/admin/applications/${id}/pdf`
      : null;

  let templateUploaded = false;
  if (template?.storage_path) {
    const dir = template.storage_path.split("/").slice(0, -1).join("/");
    const name = template.storage_path.split("/").pop()!;
    const { data: files } = await admin.storage.from("templates").list(dir);
    templateUploaded = (files ?? []).some((f) => f.name === name);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{business ?? "Application"}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {program?.name} · {application.status} · created{" "}
          {new Date(application.created_at).toLocaleDateString()}
        </p>
      </div>
      <ApplicationEditor
        applicationId={application.id}
        status={application.status}
        templateId={template?.id}
        templateUploaded={templateUploaded}
        officeDefs={officeDefs}
        data={maskSensitiveValues(defs, application.data ?? {})}
        pdfUrl={pdfUrl}
        sha256Final={application.sha256_final}
        signers={(signers ?? []).map((s) => ({
          name: s.name,
          email: s.email,
          status: s.status,
          signedAt: s.signed_at,
        }))}
        suggestedSigner={{
          name: String(application.data?.["owner.legal_name"] ?? ""),
          email: String(application.data?.["owner.email"] ?? ""),
        }}
      />
      <HistoryTimeline events={events} />
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  created: "Application created",
  sent: "Sent for signature",
  email_delivered: "Email delivered",
  opened: "Signing link opened",
  consented: "Consented to electronic signing",
  field_signed: "Field signed",
  signed: "Signed",
  completed: "Completed — document sealed",
  edited: "Edited",
  voided: "Voided",
  declined: "Declined",
  reminder_sent: "Reminder sent",
};

/** Envelope-history timeline: every audit event on this application. */
function HistoryTimeline({
  events,
}: {
  events: { id: number; event_type: string; ts: string; ip: string | null; meta: Record<string, unknown> }[];
}) {
  if (events.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Document history</h2>
      <ol className="mt-4 space-y-0 rounded-lg border border-zinc-200 bg-white">
        {events.map((e, i) => (
          <li
            key={e.id}
            className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm ${
              i > 0 ? "border-t border-zinc-100" : ""
            }`}
          >
            <span className="w-44 shrink-0 text-xs text-zinc-500">
              {new Date(e.ts).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}
            </span>
            <span className="font-medium">
              {EVENT_LABELS[e.event_type] ?? e.event_type}
              {typeof e.meta?.action === "string" && (
                <span className="font-normal text-zinc-500"> · {String(e.meta.action).replaceAll("_", " ")}</span>
              )}
            </span>
            {e.ip && <span className="ml-auto text-xs text-zinc-400">IP {e.ip}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
