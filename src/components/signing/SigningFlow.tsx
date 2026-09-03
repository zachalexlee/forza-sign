"use client";

import { useState } from "react";
import { PdfViewer } from "./PdfViewer";
import { SignatureModal } from "./SignatureModal";

interface SigningFlowProps {
  token: string;
  signerName: string;
  alreadyConsented: boolean;
  disclosure: string;
}

type Step = "consent" | "review" | "done" | "declined";

export function SigningFlow({
  token,
  signerName,
  alreadyConsented,
  disclosure,
}: SigningFlowProps) {
  const [step, setStep] = useState<Step>(alreadyConsented ? "review" : "consent");
  const [consentChecked, setConsentChecked] = useState(false);
  const [nameChecked, setNameChecked] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  async function submitConsent() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/sign/${token}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, confirmedName: signerName }),
      });
      if (!res.ok) throw new Error();
      setStep("review");
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setPending(false);
    }
  }

  async function adoptAndSign() {
    if (!signature) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/sign/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signaturePng: signature }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setDownloadUrl(body.downloadUrl ?? null);
      setStep("done");
    } catch {
      setError("Signing failed — please try again or contact Forza Payments.");
    } finally {
      setPending(false);
    }
  }

  async function decline() {
    setPending(true);
    try {
      await fetch(`/api/sign/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: declineReason }),
      });
      setStep("declined");
    } finally {
      setPending(false);
    }
  }

  if (step === "done") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
        <h2 className="text-lg font-semibold text-green-900">Document signed ✓</h2>
        <p className="mt-2 text-sm text-green-800">
          Thank you! The executed copy (with its signature certificate) has been
          emailed to you.
        </p>
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="mt-4 inline-block rounded-md bg-green-800 px-5 py-2 text-sm font-medium text-white"
          >
            Download your copy now
          </a>
        )}
      </div>
    );
  }

  if (step === "declined") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 text-center">
        <h2 className="text-lg font-semibold">Signing declined</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Forza Payments has been notified. If you have questions, just reply to
          the email that brought you here.
        </p>
      </div>
    );
  }

  if (step === "consent") {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-zinc-200 p-6">
          <h2 className="font-semibold">Electronic signature consent</h2>
          <p className="mt-3 whitespace-pre-line text-sm text-zinc-600">{disclosure}</p>
          <label className="mt-5 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
            />
            I agree to use electronic records and signatures.
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={nameChecked}
              onChange={(e) => setNameChecked(e.target.checked)}
            />
            I confirm that I am <strong>&nbsp;{signerName}</strong>.
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          disabled={!consentChecked || !nameChecked || pending}
          onClick={submitConsent}
          className="btn-dark"
        >
          {pending ? "One moment…" : "Continue to document"}
        </button>
      </div>
    );
  }

  // Review + sign
  return (
    <div className="space-y-6">
      <PdfViewer src={`/api/sign/${token}/pdf`} />

      <div className="sticky bottom-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-lg">
        {signature ? (
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signature} alt="Your signature" className="h-12 rounded border border-zinc-200 bg-white" />
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="text-sm text-zinc-500 underline"
            >
              Change
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={adoptAndSign}
              className="btn-primary ml-auto"
            >
              {pending ? "Signing…" : "Adopt & sign"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm text-zinc-600">
              Review the document, then create your signature.
            </p>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="btn-dark ml-auto"
            >
              Create signature
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={() => setDeclineOpen(true)}
          className="mt-3 text-xs text-zinc-400 underline"
        >
          Decline to sign
        </button>
      </div>

      {modalOpen && (
        <SignatureModal
          signerName={signerName}
          onAdopt={(png) => {
            setSignature(png);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}

      {declineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6">
            <h3 className="font-semibold">Decline to sign?</h3>
            <textarea
              rows={3}
              placeholder="Optional: tell us why"
              className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeclineOpen(false)}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
              >
                Go back
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={decline}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
