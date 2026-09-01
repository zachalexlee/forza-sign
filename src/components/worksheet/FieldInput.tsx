"use client";

import { FieldDefinition, isMaskedValue } from "@/lib/fields/types";
import { US_STATES } from "@/lib/fields/validators";

interface FieldInputProps {
  def: FieldDefinition;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  onUploadFile?: (file: File) => Promise<void>;
}

const inputClass =
  "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none";

export function FieldInput({ def, value, error, onChange, onUploadFile }: FieldInputProps) {
  const id = def.key.replace(/\./g, "-");

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-800">
        {def.label}
        {def.required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {def.help_text && (
        <p className="mt-0.5 text-xs text-zinc-500">{def.help_text}</p>
      )}
      <FieldControl
        id={id}
        def={def}
        value={value}
        onChange={onChange}
        onUploadFile={onUploadFile}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function FieldControl({
  id,
  def,
  value,
  onChange,
  onUploadFile,
}: FieldInputProps & { id: string }) {
  // A masked sensitive value is already stored server-side.
  if (isMaskedValue(value)) {
    return (
      <div className="mt-1 flex items-center gap-3">
        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          •••• {value.last4} (saved securely)
        </span>
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-xs text-zinc-500 underline hover:text-zinc-800"
        >
          Change
        </button>
      </div>
    );
  }

  switch (def.field_type) {
    case "boolean":
      return (
        <div className="mt-1 flex gap-4">
          {[
            { v: true, label: "Yes" },
            { v: false, label: "No" },
          ].map(({ v, label }) => (
            <label key={label} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name={id}
                checked={value === v}
                onChange={() => onChange(v)}
              />
              {label}
            </label>
          ))}
        </div>
      );

    case "select":
      return (
        <select
          id={id}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Select…</option>
          {(def.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "state":
      return (
        <select
          id={id}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Select…</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );

    case "textarea":
      return (
        <textarea
          id={id}
          rows={3}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "file":
      return (
        <div className="mt-1">
          {typeof value === "string" && value ? (
            <div className="flex items-center gap-3">
              <span className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                ✓ Uploaded
              </span>
              <button
                type="button"
                onClick={() => onChange(undefined)}
                className="text-xs text-zinc-500 underline hover:text-zinc-800"
              >
                Replace
              </button>
            </div>
          ) : (
            <input
              type="file"
              accept="image/*,application/pdf"
              className="text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && onUploadFile) void onUploadFile(file);
              }}
            />
          )}
        </div>
      );

    case "number":
    case "currency":
      return (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={def.field_type === "currency" ? "0.01" : "any"}
          className={inputClass}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );

    case "date":
      return (
        <input
          id={id}
          type="date"
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );

    default: {
      const type =
        def.field_type === "email" ? "email" : def.field_type === "phone" ? "tel" : "text";
      return (
        <input
          id={id}
          type={type}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
}
