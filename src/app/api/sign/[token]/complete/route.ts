import { NextResponse } from "next/server";
import { logAuditEvent, requestMeta } from "@/lib/audit";
import { completedEmail, sendEmail } from "@/lib/email";
import { templateMapForProgram } from "@/lib/pdf/maps";
import { appendCertificatePage, sha256Hex, stampAndFlatten } from "@/lib/pdf/stamp";
import { validateSigningToken } from "@/lib/signing";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_SIGNATURE_BYTES = 200 * 1024;

/**
 * "Adopt and sign": stamp the adopted signature into the PDF, flatten,
 * hash, append the audit certificate, store the executed copy, email it
 * to signer and office (build plan §6.3, §7).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = await validateSigningToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 403 });
  }
  const { signer, application } = result;

  if (!signer.consent_given_at) {
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  }
  if (!application.filled_pdf_path) {
    return NextResponse.json({ error: "no_pdf" }, { status: 409 });
  }

  let body: { signaturePng?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const dataUrlMatch = body.signaturePng?.match(/^data:image\/png;base64,(.+)$/);
  if (!dataUrlMatch) {
    return NextResponse.json({ error: "signature_required" }, { status: 400 });
  }
  const signaturePng = Buffer.from(dataUrlMatch[1], "base64");
  if (signaturePng.length === 0 || signaturePng.length > MAX_SIGNATURE_BYTES) {
    return NextResponse.json({ error: "signature_invalid" }, { status: 400 });
  }

  const meta = requestMeta(request);
  const supabase = createAdminClient();
  const programCode = application.programs?.code;
  const map = programCode ? templateMapForProgram(programCode) : undefined;
  if (!map) return NextResponse.json({ error: "no_template_map" }, { status: 409 });

  const { data: filled } = await supabase.storage
    .from("filled")
    .download(application.filled_pdf_path);
  if (!filled) return NextResponse.json({ error: "no_pdf" }, { status: 409 });

  const signedAt = new Date();

  // 1. Store the adopted signature image (private bucket).
  const signaturePath = `signers/${signer.id}/signature.png`;
  await supabase.storage.from("signatures").upload(signaturePath, signaturePng, {
    contentType: "image/png",
    upsert: true,
  });

  // 2. Stamp + flatten.
  const stamped = await stampAndFlatten({
    filledPdf: await filled.arrayBuffer(),
    map,
    signaturePng: new Uint8Array(signaturePng),
    signerName: signer.name,
    signedAt,
  });

  // 3. Hash the flattened document; the hash goes on the certificate.
  const sha256 = sha256Hex(stamped.pdfBytes);

  // 4. Record the signature events, then render the full trail onto the
  //    certificate page.
  await logAuditEvent({
    event_type: "signed",
    org_id: application.org_id,
    application_id: application.id,
    signer_id: signer.id,
    ...meta,
    meta: {
      stamped_placements: stamped.stampedPlacements,
      skipped_placements: stamped.skippedPlacements,
      sha256,
    },
  });

  const { data: events } = await supabase
    .from("audit_events")
    .select("event_type, ts, ip, meta")
    .eq("application_id", application.id)
    .order("ts", { ascending: true });

  const businessName =
    application.worksheets?.customers?.business_name ?? "the business";
  const documentName = application.programs?.name ?? "ATM Application";

  const finalBytes = await appendCertificatePage(stamped.pdfBytes, {
    documentTitle: `${documentName} — ${businessName}`,
    applicationId: application.id,
    sha256,
    signer: { name: signer.name, email: signer.email },
    events: (events ?? []).map((e) => ({
      event_type: e.event_type,
      ts: e.ts,
      ip: e.ip as string | null,
      detail: (e.meta as { action?: string })?.action,
    })),
  });

  // 5. Store the executed copy and finish the lifecycle.
  const finalPath = `applications/${application.id}/executed.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("final")
    .upload(finalPath, Buffer.from(finalBytes), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) {
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  await supabase
    .from("signers")
    .update({
      status: "signed",
      signed_at: signedAt.toISOString(),
      signature_image_path: signaturePath,
      ip: meta.ip,
      user_agent: meta.user_agent,
    })
    .eq("id", signer.id);
  await supabase
    .from("applications")
    .update({
      status: "completed",
      final_pdf_path: finalPath,
      sha256_final: sha256,
      completed_at: signedAt.toISOString(),
    })
    .eq("id", application.id);

  await logAuditEvent({
    event_type: "completed",
    org_id: application.org_id,
    application_id: application.id,
    signer_id: signer.id,
    ...meta,
    meta: { final_pdf: finalPath, sha256 },
  });

  // 6. Executed copies by email (signer + office).
  const attachment = {
    filename: "executed-application.pdf",
    content: Buffer.from(finalBytes),
  };
  const signerEmail = completedEmail({
    recipientName: signer.name,
    businessName,
    documentName,
  });
  await sendEmail({
    to: signer.email,
    ...signerEmail,
    template: "completed_signer",
    org_id: application.org_id,
    application_id: application.id,
    attachments: [attachment],
  });
  const officeAddress = process.env.OFFICE_NOTIFY_EMAIL;
  if (officeAddress) {
    const officeEmail = completedEmail({
      recipientName: "Forza team",
      businessName,
      documentName,
    });
    await sendEmail({
      to: officeAddress,
      ...officeEmail,
      template: "completed_office",
      org_id: application.org_id,
      application_id: application.id,
      attachments: [attachment],
    });
  }

  // 7. Download link for the completion screen (short-lived).
  const { data: signedUrl } = await supabase.storage
    .from("final")
    .createSignedUrl(finalPath, 600);

  return NextResponse.json({
    completed: true,
    downloadUrl: signedUrl?.signedUrl ?? null,
    sha256,
  });
}
