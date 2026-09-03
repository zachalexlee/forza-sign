"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { validateWorksheetData } from "@/lib/fields/schema";
import {
  FieldDefinition,
  SECTION_LABELS,
  SECTION_ORDER,
  WorksheetData,
  isFieldVisible,
  isMaskedValue,
} from "@/lib/fields/types";
import { FieldInput } from "./FieldInput";

interface WorksheetFormProps {
  token: string;
  definitions: FieldDefinition[];
  initialData: WorksheetData;
}

type Step = { section: string; defs: FieldDefinition[] };

export function WorksheetForm({ token, definitions, initialData }: WorksheetFormProps) {
  const steps: Step[] = useMemo(
    () =>
      SECTION_ORDER.map((section) => ({
        section,
        defs: definitions.filter((d) => d.section === section),
      })).filter((s) => s.defs.length > 0),
    [definitions]
  );

  const [data, setData] = useState<WorksheetData>(initialData);
  const [stepIndex, setStepIndex] = useState(0); // steps.length = review screen
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const persist = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/w/${token}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataRef.current }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }, [token]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 1500);
  }, [persist]);

  function setField(key: string, value: unknown) {
    setData((d) => {
      const next = { ...d };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
    scheduleSave();
  }

  async function uploadFile(key: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("field", key);
    const res = await fetch(`/api/w/${token}/upload`, { method: "POST", body: form });
    if (res.ok) {
      const { path } = await res.json();
      setField(key, path);
    } else {
      setErrors((e) => ({ ...e, [key]: "Upload failed — please try again." }));
    }
  }

  function validateStep(step: Step): boolean {
    const visible = step.defs.filter((d) => isFieldVisible(d, data));
    const issues = validateWorksheetData(visible, data, { partial: false });
    const stepErrors = Object.fromEntries(issues.map((i) => [i.key, i.message]));
    setErrors(stepErrors);
    return issues.length === 0;
  }

  async function goNext() {
    if (!validateStep(steps[stepIndex])) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persist();
    setStepIndex((i) => i + 1);
    window.scrollTo({ top: 0 });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/w/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataRef.current }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        const body = await res.json().catch(() => null);
        if (body?.issues?.length) {
          setErrors(
            Object.fromEntries(
              body.issues.map((i: { key: string; message: string }) => [i.key, i.message])
            )
          );
          setSubmitError("Some answers need attention — please review the highlighted fields.");
        } else {
          setSubmitError("Something went wrong. Please try again.");
        }
      }
    } catch {
      setSubmitError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
        <h2 className="text-lg font-semibold text-green-900">Worksheet submitted</h2>
        <p className="mt-2 text-sm text-green-800">
          Thank you! Our team will review your information and follow up with
          your ATM application shortly.
        </p>
      </div>
    );
  }

  const onReview = stepIndex >= steps.length;

  return (
    <div>
      {/* Progress */}
      <ol className="mb-8 flex flex-wrap gap-2 text-xs">
        {[...steps.map((s) => SECTION_LABELS[s.section]), "Review"].map((label, i) => (
          <li
            key={label}
            className={`rounded-full px-3 py-1 ${
              i === stepIndex
                ? "bg-zinc-900 text-white"
                : i < stepIndex
                  ? "bg-zinc-200 text-zinc-700"
                  : "bg-zinc-100 text-zinc-400"
            }`}
          >
            {label}
          </li>
        ))}
      </ol>

      {onReview ? (
        <ReviewScreen
          steps={steps}
          data={data}
          errors={errors}
          onEditSection={(i) => setStepIndex(i)}
        />
      ) : (
        <section className="space-y-5">
          <h2 className="text-lg font-semibold">
            {SECTION_LABELS[steps[stepIndex].section]}
          </h2>
          {steps[stepIndex].defs
            .filter((d) => isFieldVisible(d, data))
            .map((def) => (
              <FieldInput
                key={def.key}
                def={def}
                value={data[def.key]}
                error={errors[def.key]}
                onChange={(v) => setField(def.key, v)}
                onUploadFile={(file) => uploadFile(def.key, file)}
              />
            ))}
        </section>
      )}

      {submitError && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{submitError}</p>
      )}

      {/* Nav */}
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          disabled={stepIndex === 0}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          Back
        </button>
        <span className="text-xs text-zinc-400">
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && "Couldn't save — check your connection"}
        </span>
        {onReview ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary"
          >
            {submitting ? "Submitting…" : "Submit worksheet"}
          </button>
        ) : (
          <button type="button" onClick={goNext} className="btn-dark">
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewScreen({
  steps,
  data,
  errors,
  onEditSection,
}: {
  steps: Step[];
  data: WorksheetData;
  errors: Record<string, string>;
  onEditSection: (index: number) => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Review your answers</h2>
      {steps.map((step, i) => (
        <div key={step.section} className="rounded-lg border border-zinc-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium">{SECTION_LABELS[step.section]}</h3>
            <button
              type="button"
              onClick={() => onEditSection(i)}
              className="text-xs text-zinc-500 underline hover:text-zinc-800"
            >
              Edit
            </button>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {step.defs
              .filter((d) => isFieldVisible(d, data))
              .map((def) => (
                <div key={def.key}>
                  <dt className="text-zinc-500">{def.label}</dt>
                  <dd className={errors[def.key] ? "text-red-600" : ""}>
                    {displayValue(data[def.key], def)}
                    {errors[def.key] && (
                      <span className="block text-xs">{errors[def.key]}</span>
                    )}
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function displayValue(value: unknown, def: FieldDefinition): string {
  if (value === undefined || value === null || value === "") return "—";
  if (isMaskedValue(value)) return `•••• ${value.last4}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (def.field_type === "select") {
    return def.options?.find((o) => o.value === value)?.label ?? String(value);
  }
  if (def.field_type === "file") return "Uploaded ✓";
  return String(value);
}
