"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { uploadTemplateBlank } from "../applications/actions";

/** Upload a program's blank packet PDF straight from the templates list. */
export function BlankUploadForm({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      action={async (formData) => {
        setError(null);
        setPending(true);
        try {
          formData.set("templateId", templateId);
          await uploadTemplateBlank(formData);
          router.refresh();
        } catch (err) {
          setError(
            err instanceof Error && err.message
              ? err.message
              : "Upload failed — if the PDF is large, it may exceed the upload size limit."
          );
        } finally {
          setPending(false);
        }
      }}
      className="mt-1 flex flex-wrap items-center gap-2"
    >
      <input type="file" name="file" accept="application/pdf" required className="text-xs" />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Upload blank"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </form>
  );
}
