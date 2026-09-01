import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/tokens";

export interface SignerRow {
  id: string;
  application_id: string;
  name: string;
  email: string;
  status: "pending" | "sent" | "viewed" | "consented" | "signed" | "declined";
  token_expires_at: string | null;
  consent_given_at: string | null;
  signed_at: string | null;
}

export interface SigningApplication {
  id: string;
  org_id: string;
  status: string;
  data: Record<string, unknown>;
  filled_pdf_path: string | null;
  final_pdf_path: string | null;
  programs: { code: string; name: string } | null;
  worksheets: { customers: { business_name: string } | null } | null;
}

export type SigningValidation =
  | { ok: true; signer: SignerRow; application: SigningApplication }
  | {
      ok: false;
      reason: "not_found" | "expired" | "voided" | "declined";
    }
  | {
      /* Completed flows keep working as a retention/download view (§7.5). */
      ok: false;
      reason: "already_signed";
      signer: SignerRow;
      application: SigningApplication;
    };

/** Resolve a signing token; reject expired/voided/finished flows (§9). */
export async function validateSigningToken(token: string): Promise<SigningValidation> {
  const supabase = createAdminClient();

  const { data: signer } = await supabase
    .from("signers")
    .select(
      "id, application_id, name, email, status, token_expires_at, consent_given_at, signed_at"
    )
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!signer) return { ok: false, reason: "not_found" };
  if (signer.status === "declined") return { ok: false, reason: "declined" };
  if (
    signer.token_expires_at &&
    new Date(signer.token_expires_at).getTime() <= Date.now()
  ) {
    return { ok: false, reason: "expired" };
  }

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, org_id, status, data, filled_pdf_path, final_pdf_path, programs(code, name), worksheets(customers(business_name))"
    )
    .eq("id", signer.application_id)
    .maybeSingle();
  if (!application) return { ok: false, reason: "not_found" };
  if (application.status === "voided") return { ok: false, reason: "voided" };
  if (signer.status === "signed" || application.status === "completed") {
    return {
      ok: false,
      reason: "already_signed",
      signer: signer as SignerRow,
      application: application as unknown as SigningApplication,
    };
  }

  return {
    ok: true,
    signer: signer as SignerRow,
    application: application as unknown as SigningApplication,
  };
}

export function signingUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/sign/${token}`;
}

/** Standard ESIGN consent copy — placeholder until Zach's counsel supplies final text. */
export const ESIGN_DISCLOSURE = `By checking this box, you consent to receive, review, and sign documents electronically with Forza Payments, Inc. You agree that your electronic signature is the legal equivalent of your handwritten signature and that this agreement can be conducted entirely by electronic means. You may request a paper copy of any executed document, and you may withdraw this consent for future transactions by contacting Forza Payments. To access and retain your documents you need a device with a current web browser, an email account, and the ability to view and store PDF files.`;
