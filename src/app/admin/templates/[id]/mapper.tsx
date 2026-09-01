"use client";

import { useMemo, useState } from "react";
import { FieldDefinition } from "@/lib/fields/types";
import { MapEntry, Transform } from "@/lib/pdf/types";
import { saveTemplateMap } from "../actions";

interface MapperEditorProps {
  templateId: string;
  /** AcroForm fields detected in the uploaded blank; null = no blank yet */
  pdfFields: { name: string; type: string }[] | null;
  dictionary: Pick<FieldDefinition, "key" | "label" | "section">[];
  derivedRules: string[];
  currentMap: MapEntry[];
  suggestedMap: MapEntry[];
}

const TRANSFORMS: Transform[] = ["date_us", "phone_us", "currency", "upper"];

const inputClass =
  "w-full rounded-md border border-zinc-300 px-2 py-1 text-xs focus:border-zinc-500 focus:outline-none";

export function MapperEditor({
  templateId,
  pdfFields,
  dictionary,
  derivedRules,
  currentMap,
  suggestedMap,
}: MapperEditorProps) {
  const [entries, setEntries] = useState<MapEntry[]>(currentMap);
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const detected = useMemo(
    () => new Set((pdfFields ?? []).map((f) => f.name)),
    [pdfFields]
  );
  const byPdf = useMemo(() => {
    const m = new Map<string, number>();
    entries.forEach((e, i) => m.set(e.pdf, i));
    return m;
  }, [entries]);

  function updateEntry(pdf: string, patch: Partial<MapEntry> | null) {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.pdf === pdf);
      if (patch === null) return prev.filter((e) => e.pdf !== pdf);
      if (idx === -1) return [...prev, { pdf, ...patch }];
      const next = [...prev];
      // Replace the mapping mode wholesale so stale source/const/derived
      // values don't linger when the mode changes.
      next[idx] = {
        pdf,
        transform: next[idx].transform,
        checkbox: next[idx].checkbox,
        ...patch,
      };
      return next;
    });
  }

  async function save(list: MapEntry[]) {
    setPending(true);
    setMessage(null);
    setErrors([]);
    try {
      const result = await saveTemplateMap({ templateId, fieldMap: list });
      if (result.ok) {
        setMessage("Mapping saved ✓ — future PDFs use it immediately.");
        setEntries(list);
      } else {
        setErrors(result.errors);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  if (pdfFields === null) {
    return (
      <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">
        Upload the blank packet PDF first (from any application of this
        program, or ask an admin) — the mapper reads its form fields.
      </p>
    );
  }

  if (rawMode) {
    return (
      <div className="space-y-3">
        <textarea
          rows={24}
          className="w-full rounded-md border border-zinc-300 p-3 font-mono text-xs"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
        />
        {errors.length > 0 && (
          <ul className="text-xs text-red-600">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {message && <p className="text-sm text-zinc-700">{message}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              try {
                void save(JSON.parse(rawText) as MapEntry[]);
              } catch {
                setErrors(["Invalid JSON"]);
              }
            }}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save JSON
          </button>
          <button
            type="button"
            onClick={() => setRawMode(false)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
          >
            Back to table
          </button>
        </div>
      </div>
    );
  }

  const unmappedNotInPdf = entries.filter((e) => !detected.has(e.pdf));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => save(entries)}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save mapping"}
        </button>
        {suggestedMap.length > 0 && (
          <button
            type="button"
            onClick={() => setEntries(suggestedMap)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
          >
            Start from Appendix B map
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setRawText(JSON.stringify(entries, null, 2));
            setRawMode(true);
          }}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
        >
          Edit as JSON (advanced: per-digit boxes)
        </button>
        <span className="text-xs text-zinc-500">
          {entries.length} mapped · {pdfFields.length} fields in PDF
        </span>
      </div>

      {errors.length > 0 && (
        <ul className="rounded-md bg-red-50 p-3 text-xs text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {message && <p className="text-sm text-zinc-700">{message}</p>}
      {unmappedNotInPdf.length > 0 && (
        <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
          {unmappedNotInPdf.length} mapped name(s) not found in this PDF:{" "}
          {unmappedNotInPdf.map((e) => e.pdf).join(", ")}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">PDF field</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 w-56">Maps from</th>
              <th className="px-3 py-2 w-40">Value</th>
              <th className="px-3 py-2 w-28">Transform</th>
              <th className="px-3 py-2 w-32">Checkbox when =</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {pdfFields.map((f) => {
              const entry = byPdf.has(f.name) ? entries[byPdf.get(f.name)!] : undefined;
              const isCheckbox = f.type === "PDFCheckBox";
              const mode = entry?.source !== undefined
                ? "source"
                : entry?.const !== undefined
                  ? "const"
                  : entry?.derived !== undefined
                    ? "derived"
                    : "unmapped";
              return (
                <tr key={f.name} className={entry ? "" : "opacity-60"}>
                  <td className="px-3 py-1.5 font-mono">{f.name}</td>
                  <td className="px-3 py-1.5 text-zinc-400">
                    {f.type.replace("PDF", "")}
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className={inputClass}
                      value={mode}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Checkbox widgets always carry the checkbox marker so
                        // the fill engine checks rather than writes text.
                        const cb = isCheckbox ? { checkbox: {} } : {};
                        if (v === "unmapped") updateEntry(f.name, null);
                        else if (v === "source")
                          updateEntry(f.name, { source: dictionary[0]?.key ?? "", ...cb });
                        else if (v === "const") updateEntry(f.name, { const: "Yes", ...cb, ...(isCheckbox ? { checkbox: { equals: "Yes" } } : {}) });
                        else updateEntry(f.name, { derived: derivedRules[0], ...cb });
                      }}
                    >
                      <option value="unmapped">— unmapped —</option>
                      <option value="source">Dictionary field</option>
                      <option value="const">Constant</option>
                      <option value="derived">Derived rule</option>
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    {mode === "source" && (
                      <select
                        className={inputClass}
                        value={entry?.source ?? ""}
                        onChange={(e) => updateEntry(f.name, { source: e.target.value })}
                      >
                        {dictionary.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.key}
                          </option>
                        ))}
                      </select>
                    )}
                    {mode === "const" && (
                      <input
                        className={inputClass}
                        value={entry?.const ?? ""}
                        onChange={(e) => updateEntry(f.name, { const: e.target.value })}
                      />
                    )}
                    {mode === "derived" && (
                      <select
                        className={inputClass}
                        value={entry?.derived ?? ""}
                        onChange={(e) => updateEntry(f.name, { derived: e.target.value })}
                      >
                        {derivedRules.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {entry && !isCheckbox && (
                      <select
                        className={inputClass}
                        value={entry.transform ?? ""}
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.pdf === f.name
                                ? {
                                    ...x,
                                    transform: (e.target.value || undefined) as
                                      | Transform
                                      | undefined,
                                  }
                                : x
                            )
                          )
                        }
                      >
                        <option value="">none</option>
                        {TRANSFORMS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {entry && isCheckbox && (
                      <input
                        className={inputClass}
                        placeholder="blank = when true"
                        value={
                          entry.checkbox?.equals === undefined
                            ? ""
                            : String(entry.checkbox.equals)
                        }
                        onChange={(e) =>
                          setEntries((prev) =>
                            prev.map((x) =>
                              x.pdf === f.name
                                ? {
                                    ...x,
                                    checkbox:
                                      e.target.value === ""
                                        ? {}
                                        : { equals: parseEquals(e.target.value) },
                                  }
                                : x
                            )
                          )
                        }
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseEquals(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}
