"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldInput } from "@/components/worksheet/FieldInput";
import { FieldDefinition, WorksheetData } from "@/lib/fields/types";
import { updateApplicationData, uploadTemplateBlank } from "../actions";

interface ApplicationEditorProps {
  applicationId: string;
  status: string;
  templateId: string | undefined;
  templateUploaded: boolean;
  officeDefs: FieldDefinition[];
  data: WorksheetData;
  pdfUrl: string | null;
}

export function ApplicationEditor({
  applicationId,
  status,
  templateId,
  templateUploaded,
  officeDefs,
  data: initialData,
  pdfUrl,
}: ApplicationEditorProps) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<WorksheetData>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const result = await updateApplicationData({ applicationId, data: overrides });
      setMissing(result.missingFields);
      setMessage("Saved — PDF regenerated.");
      setOverrides({});
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  const editable = status === "draft";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      {/* PDF preview */}
      <div className="min-h-[600px] rounded-lg border border-zinc-200 bg-zinc-50">
        {pdfUrl ? (
          <iframe src={pdfUrl} className="h-[80vh] w-full rounded-lg" title="Filled application" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm text-zinc-500">
              {templateUploaded
                ? "The filled PDF hasn't been generated yet — save to regenerate."
                : "The blank template PDF for this program hasn't been uploaded yet."}
            </p>
            {!templateUploaded && templateId && (
              <form
                action={async (formData) => {
                  formData.set("templateId", templateId);
                  await uploadTemplateBlank(formData);
                  await updateApplicationData({ applicationId, data: {} });
                  router.refresh();
                }}
                className="flex flex-col items-center gap-2"
              >
                <input type="file" name="file" accept="application/pdf" required className="text-sm" />
                <button
                  type="submit"
                  className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
                >
                  Upload blank template PDF
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Override panel */}
      <aside className="space-y-5">
        <div>
          <h2 className="font-semibold">Office-set fields</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Never asked of the customer — set here before sending.
          </p>
        </div>

        {officeDefs.map((def) => {
          const value =
            def.key in overrides ? overrides[def.key] : initialData[def.key];
          const suggestion =
            def.key === "atm.surcharge"
              ? initialData["install.surcharge_suggestion"]
              : undefined;
          return (
            <div key={def.key}>
              <FieldInput
                def={def}
                value={value}
                onChange={(v) => {
                  if (!editable) return;
                  setOverrides((o) => ({ ...o, [def.key]: v }));
                }}
              />
              {suggestion !== undefined && suggestion !== null && suggestion !== "" && (
                <p className="mt-1 text-xs text-amber-700">
                  Customer suggested: ${String(suggestion)} (never auto-filled)
                </p>
              )}
            </div>
          );
        })}

        {missing.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-medium">
              {missing.length} mapped field(s) not found in this PDF:
            </p>
            <p className="mt-1 break-words">{missing.join(", ")}</p>
            <p className="mt-1">
              Run <code>npm run inspect:pdf</code> against the blank PDF and fix
              the map (FOR-13).
            </p>
          </div>
        )}

        {message && <p className="text-sm text-zinc-700">{message}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending || !editable}
            onClick={save}
            className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save & regenerate PDF"}
          </button>
          {pdfUrl && (
            <a
              href={pdfUrl}
              download
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
            >
              Download PDF
            </a>
          )}
        </div>
        {!editable && (
          <p className="text-xs text-zinc-500">
            This application is {status} and can no longer be edited.
          </p>
        )}
      </aside>
    </div>
  );
}
