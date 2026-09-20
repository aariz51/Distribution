"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Palette { ink: string; accent: string; canvas: string; ground: string; extra: string[]; source: "provided" | "inferred" | "confirmed"; inferredFrom: string[] }

export function PaletteCard({ productId, palette, hasAssets }: { productId: string; palette: Palette | undefined; hasAssets: boolean }) {
  const router = useRouter();
  const [p, setP] = useState<Palette | undefined>(palette);
  const [busy, setBusy] = useState<string | null>(null);

  async function save(next: Palette) {
    setBusy("Saving…");
    try {
      const r = await fetch(`/api/products/${productId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ palette: next }) });
      if (r.ok) setP(next);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }
  async function resample() {
    setBusy("Queuing…");
    try {
      await fetch(`/api/products/${productId}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "brand.palette" }) });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const roles: (keyof Pick<Palette, "accent" | "ink" | "canvas" | "ground">)[] = ["accent", "ink", "canvas", "ground"];
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Brand palette</h2>
        {p && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${p.source === "inferred" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
            {p.source === "inferred" ? "inferred from assets" : p.source}
          </span>
        )}
      </div>
      {!p ? (
        <p className="mt-3 text-sm text-zinc-600">{hasAssets ? "No palette yet — sampling runs as a job." : "Upload a logo or screenshots to sample a palette."}</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {roles.map((r) => (
            <label key={r} className="text-xs text-zinc-600">
              {r}
              <div className="mt-1 flex items-center gap-2">
                <input type="color" value={p[r]} onChange={(e) => setP({ ...p, [r]: e.target.value })} />
                <code>{p[r]}</code>
              </div>
            </label>
          ))}
        </div>
      )}
      {p && p.extra.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          extra: {p.extra.map((h) => <span key={h} className="inline-block h-4 w-4 rounded" style={{ background: h }} title={h} />)}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {p && p.source !== "confirmed" && (
          <button disabled={busy !== null} onClick={() => save({ ...p, source: "confirmed" })} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-40">Confirm palette</button>
        )}
        {p && p !== palette && <button disabled={busy !== null} onClick={() => save({ ...p, source: "provided" })} className="rounded-md border px-3 py-1.5 text-xs">Save edits</button>}
        {hasAssets && <button disabled={busy !== null} onClick={resample} className="rounded-md border px-3 py-1.5 text-xs">{p ? "Re-sample from assets" : "Sample palette"}</button>}
        {busy && <span className="text-xs text-zinc-500">{busy}</span>}
      </div>
    </section>
  );
}
