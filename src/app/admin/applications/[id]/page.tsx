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
    </div>
  );
}
