"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";

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
    <Card>
      <CardHeader
        title="Brand palette"
        action={p && <Pill status={p.source}>{p.source === "inferred" ? "Inferred from assets" : p.source === "confirmed" ? "Confirmed" : "Provided"}</Pill>}
      />
      <CardBody>
        {!p ? (
          <p className="text-sm text-muted">{hasAssets ? "No palette yet — sampling runs as a job." : "Upload a logo or screenshots to sample a palette."}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {roles.map((r) => (
              <label key={r} className="group block cursor-pointer">
                <span className="relative block aspect-square overflow-hidden rounded-[8px] border border-hairline motion-safe:transition-colors group-hover:border-hairline-strong" style={{ background: p[r] }}>
                  <input type="color" value={p[r]} onChange={(e) => setP({ ...p, [r]: e.target.value })} className="absolute inset-0 h-full w-full opacity-0" aria-label={`${r} colour`} />
                </span>
                <span className="mt-1.5 block text-[12px] font-medium capitalize text-ink">{r}</span>
                <span className="block font-mono text-[11px] text-muted">{p[r].toLowerCase()}</span>
              </label>
            ))}
          </div>
        )}
        {p && p.extra.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-faint">
            <span className="mr-1">Extra</span>
            {p.extra.map((h) => <span key={h} className="inline-block h-4 w-4 rounded-[4px] border border-black/10" style={{ background: h }} title={h} />)}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {p && p.source !== "confirmed" && (
            <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => save({ ...p, source: "confirmed" })}>Confirm palette</Button>
          )}
          {p && p !== palette && <Button size="sm" disabled={busy !== null} onClick={() => save({ ...p, source: "provided" })}>Save edits</Button>}
          {hasAssets && <Button size="sm" variant={p ? "ghost" : "secondary"} disabled={busy !== null} onClick={resample}>{p ? "Re-sample from assets" : "Sample palette"}</Button>}
          {busy && <span className="text-xs text-muted">{busy}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
