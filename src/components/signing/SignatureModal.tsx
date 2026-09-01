"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";

interface SignatureModalProps {
  signerName: string;
  onAdopt: (pngDataUrl: string) => void;
  onClose: () => void;
}

/** Draw (signature_pad) or type (cursive render) — build plan §6.3. */
export function SignatureModal({ signerName, onAdopt, onClose }: SignatureModalProps) {
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typedName, setTypedName] = useState(signerName);
  const [isEmpty, setIsEmpty] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    if (tab !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);

    const pad = new SignaturePad(canvas, { minWidth: 1, maxWidth: 2.5 });
    pad.addEventListener("endStroke", () => setIsEmpty(pad.isEmpty()));
    padRef.current = pad;
    setIsEmpty(true);
    return () => pad.off();
  }, [tab]);

  function typedSignaturePng(): string | null {
    const name = typedName.trim();
    if (!name) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 150;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#111";
    ctx.font = "64px 'Brush Script MT', 'Segoe Script', cursive";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 20, 75, 560);
    return canvas.toDataURL("image/png");
  }

  function adopt() {
    const png =
      tab === "draw"
        ? padRef.current && !padRef.current.isEmpty()
          ? padRef.current.toDataURL("image/png")
          : null
        : typedSignaturePng();
    if (png) onAdopt(png);
  }

  const canAdopt = tab === "draw" ? !isEmpty : typedName.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6">
        <h3 className="font-semibold">Create your signature</h3>

        <div className="mt-4 flex gap-2 text-sm">
          {(["draw", "type"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1 ${
                tab === t ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {t === "draw" ? "Draw" : "Type"}
            </button>
          ))}
        </div>

        {tab === "draw" ? (
          <div className="mt-4">
            <canvas
              ref={canvasRef}
              className="h-40 w-full touch-none rounded-md border border-zinc-300 bg-zinc-50"
            />
            <button
              type="button"
              onClick={() => {
                padRef.current?.clear();
                setIsEmpty(true);
              }}
              className="mt-2 text-xs text-zinc-500 underline"
            >
              Clear
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <div className="mt-3 flex h-24 items-center rounded-md border border-zinc-200 bg-zinc-50 px-4">
              <span
                style={{ fontFamily: "'Brush Script MT', 'Segoe Script', cursive" }}
                className="text-4xl"
              >
                {typedName || "Your name"}
              </span>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs text-zinc-500">
          By selecting Adopt, you agree this will be the electronic
          representation of your signature for this document.
        </p>

        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canAdopt}
            onClick={adopt}
            className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Adopt signature
          </button>
        </div>
      </div>
    </div>
  );
}
