"use client";

import { useMemo, useState } from "react";
import { FieldInput } from "@/components/worksheet/FieldInput";
import {
  FieldDefinition,
  SECTION_LABELS,
  SECTION_ORDER,
  WorksheetData,
  isFieldVisible,
} from "@/lib/fields/types";
import { reissueWorksheetLink, saveWorksheetReview } from "../actions";

interface EditorProps {
  worksheetId: string;
  status: string;
  definitions: FieldDefinition[];
  initialData: WorksheetData;
  submittedData: WorksheetData | null;
  initialChangedKeys: string[];
  initialReviewNotes: string;
  events: { event_type: string; ts: string; action?: string }[];
}

export function AdminWorksheetEditor({
  worksheetId,
  status,
  definitions,
  initialData,
  submittedData,
  initialChangedKeys,
  initialReviewNotes,
  events,
}: EditorProps) {
  const [data, setData] = useState<WorksheetData>(initialData);
  const [reviewNotes, setReviewNotes] = useState(initialReviewNotes);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const sections = useMemo(
    () =>
      SECTION_ORDER.map((section) => ({
        section,
        defs: definitions.filter((d) => d.section === section),
      })).filter((s) => s.defs.length > 0),
    [definitions]
  );

  // Diff vs the customer's submitted snapshot (server-computed for stored
  // values, live-updated for unsaved edits).
  function isChanged(key: string): boolean {
    if (!submittedData) return false;
    if (JSON.stringify(data[key] ?? null) !== JSON.stringify(initialData[key] ?? null)) {
      return true;
    }
    return initialChangedKeys.includes(key);
  }

  async function save(markReviewed: boolean) {
    setPending(true);
    setMessage(null);
    setErrors({});
    try {
      const result = await saveWorksheetReview({
        worksheetId,
        data,
        reviewNotes,
        markReviewed,
      });
      if (result.ok) {
        setMessage(markReviewed ? "Marked as reviewed ✓" : "Saved ✓");
      } else {
        setErrors(
          Object.fromEntries((result.issues ?? []).map((i) => [i.key, i.message]))
        );
        setMessage("Fix the highlighted fields before marking reviewed.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  async function reissue() {
    setPending(true);
    setMessage(null);
    try {
      const result = await reissueWorksheetLink(worksheetId, false);
      setLink(result.link);
      setMessage("New link created (old links are now invalid).");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create link");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <div className="space-y-8">
        {submittedData && initialChangedKeys.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Highlighted fields were changed by the office after submission.
          </p>
        )}

        {sections.map(({ section, defs }) => (
          <section key={section} className="space-y-4">
            <h2 className="border-b border-zinc-200 pb-1 font-semibold">
              {SECTION_LABELS[section]}
            </h2>
            {defs
              .filter((d) => isFieldVisible(d, data))
              .map((def) => (
                <div
                  key={def.key}
                  className={
                    isChanged(def.key)
                      ? "rounded-md bg-amber-50 p-2 ring-1 ring-amber-200"
                      : undefined
                  }
                >
                  <FieldInput
                    def={def}
                    value={data[def.key]}
                    error={errors[def.key]}
                    onChange={(v) =>
                      setData((d) => {
                        const next = { ...d };
                        if (v === undefined) delete next[def.key];
                        else next[def.key] = v;
                        return next;
                      })
                    }
                  />
                </div>
              ))}
          </section>
        ))}

        <section>
          <h2 className="border-b border-zinc-200 pb-1 font-semibold">Review notes</h2>
          <textarea
            rows={3}
            className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            placeholder="Internal notes — the customer never sees these."
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
          />
        </section>

        {message && <p className="text-sm text-zinc-700">{message}</p>}
        {link && (
          <code className="block truncate rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
            {link}
          </code>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(false)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            disabled={pending || status === "reviewed"}
            onClick={() => save(true)}
            className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {status === "reviewed" ? "Reviewed ✓" : "Save & mark reviewed"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={reissue}
            className="ml-auto rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            New customer link
          </button>
        </div>
      </div>

      <aside>
        <h2 className="font-semibold">Timeline</h2>
        <ol className="mt-3 space-y-2 border-l border-zinc-200 pl-4 text-sm">
          {events.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.action ?? e.event_type}</span>
              <span className="block text-xs text-zinc-400">
                {new Date(e.ts).toLocaleString()}
              </span>
            </li>
          ))}
          {events.length === 0 && <li className="text-zinc-400">No events yet.</li>}
        </ol>
      </aside>
    </div>
  );
}
