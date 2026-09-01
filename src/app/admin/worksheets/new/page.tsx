"use client";

import Link from "next/link";
import { useState } from "react";
import { createWorksheet, CreateWorksheetResult } from "../actions";

const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none";

export default function NewWorksheetPage() {
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateWorksheetResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      setResult(await createWorksheet({ businessName, contactName, email, phone, sendInvite }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-semibold">Worksheet created</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {result.emailStatus === "sent"
            ? "The customer has been emailed their unique link. You can also copy it below."
            : "Share this unique link with the customer, or open it yourself to fill the worksheet on their behalf."}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
            {result.link}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(result.link);
              setCopied(true);
            }}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
        <div className="mt-6 flex gap-3 text-sm">
          <Link href={`/admin/worksheets/${result.worksheetId}`} className="underline">
            Open worksheet record
          </Link>
          <Link href="/admin" className="text-zinc-500 underline">
            Back to queue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold">New worksheet</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Creates a customer record and a unique worksheet link.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">
            Business name <span className="text-red-500">*</span>
          </label>
          <input
            required
            className={inputClass}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Contact name</label>
          <input
            className={inputClass}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Customer email</label>
          <input
            type="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Phone</label>
          <input
            type="tel"
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
          />
          Email the link to the customer now
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create worksheet"}
        </button>
      </form>
    </div>
  );
}
