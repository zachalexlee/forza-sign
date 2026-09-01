import { SigningFlow } from "@/components/signing/SigningFlow";
import { logAuditEvent } from "@/lib/audit";
import { ESIGN_DISCLOSURE, validateSigningToken } from "@/lib/signing";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CLOSED_MESSAGES: Record<string, { title: string; body: string }> = {
  not_found: {
    title: "Link not found",
    body: "This signing link isn't valid. Please use the most recent email from Forza Payments, or contact us for a new link.",
  },
  expired: {
    title: "Link expired",
    body: "This signing link has expired. Contact Forza Payments and we'll send a fresh one.",
  },
  voided: {
    title: "Document no longer active",
    body: "This document was withdrawn by Forza Payments. If a revised version was issued, you'll receive a new email.",
  },
  already_signed: {
    title: "Already signed",
    body: "This document has been signed and completed. The executed copy was emailed to you for your records.",
  },
  declined: {
    title: "Signing declined",
    body: "You declined to sign this document. If that was a mistake, contact Forza Payments for a new link.",
  },
};

export default async function SigningPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await validateSigningToken(token);

  if (!result.ok) {
    const msg = CLOSED_MESSAGES[result.reason];
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center p-8 text-center">
        <h1 className="text-xl font-semibold">{msg.title}</h1>
        <p className="mt-3 text-sm text-zinc-600">{msg.body}</p>
      </main>
    );
  }

  const { signer, application } = result;

  // First open of the signing page.
  if (signer.status === "sent") {
    const supabase = createAdminClient();
    await supabase.from("signers").update({ status: "viewed" }).eq("id", signer.id);
    if (application.status === "sent") {
      await supabase
        .from("applications")
        .update({ status: "viewed" })
        .eq("id", application.id);
    }
    await logAuditEvent({
      event_type: "opened",
      org_id: application.org_id,
      application_id: application.id,
      signer_id: signer.id,
    });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-zinc-500">Forza Payments</p>
        <h1 className="mt-1 text-2xl font-semibold">
          {application.programs?.name ?? "ATM Application"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Prepared for {application.worksheets?.customers?.business_name} · signer:{" "}
          {signer.name} ({signer.email})
        </p>
      </header>
      <SigningFlow
        token={token}
        signerName={signer.name}
        alreadyConsented={Boolean(signer.consent_given_at)}
        disclosure={ESIGN_DISCLOSURE}
      />
    </main>
  );
}
