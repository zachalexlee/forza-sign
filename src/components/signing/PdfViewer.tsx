"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders the filled application page by page with pdf.js — the raw PDF is
 * fetched through the token-authorized route and never exposed by URL.
 */
export function PdfViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const res = await fetch(src);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const containerWidth = Math.min(container.clientWidth || 720, 900);
          const unscaled = page.getViewport({ scale: 1 });
          const scale = (containerWidth / unscaled.width) * (window.devicePixelRatio || 1);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.className = "mb-4 rounded border border-zinc-200 shadow-sm";
          container.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div>
      {status === "loading" && (
        <p className="py-12 text-center text-sm text-zinc-500">Loading document…</p>
      )}
      {status === "error" && (
        <p className="py-12 text-center text-sm text-red-600">
          Couldn&apos;t load the document. Refresh the page to try again.
        </p>
      )}
      {status === "ready" && (
        <p className="mb-2 text-xs text-zinc-500">{pageCount} pages — review before signing.</p>
      )}
      <div ref={containerRef} />
    </div>
  );
}
