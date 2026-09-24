"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

interface ReferenceChoice { id: string; title: string; posterUrl: string; durationSec: number | null; visualLanguage: string[]; reasons: string[] }

/**
 * Starts a promo run. The deterministic path needs no provider key, so the
 * default has no cost and no model call; the reference path is an explicit
 * opt-in because it spends credits.
 */
export function GeneratePromo({ productId, hasLogo, screenCount, savedReferenceUrl = "", savedReferenceId }: { productId: string; hasLogo: boolean; screenCount: number; savedReferenceUrl?: string; savedReferenceId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(24);
  const [useLlm, setUseLlm] = useState(Boolean(savedReferenceUrl || savedReferenceId));
  const [useSavedReference, setUseSavedReference] = useState(Boolean(savedReferenceId));
  const [referenceUrl, setReferenceUrl] = useState(savedReferenceUrl);
  const [open, setOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceChoice[]>([]);
  const [selectedReference, setSelectedReference] = useState("");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !useLlm) return;
    const controller = new AbortController();
    fetch(`/api/products/${productId}/promo/references?durationSec=${duration}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Could not load reference choices"); return response.json() as Promise<{ references: ReferenceChoice[] }>; })
      .then(body => { setReferences(body.references); setReferenceError(null); setSelectedReference(current => body.references.some(r => r.id === current) ? current : ""); })
      .catch(error => { if (!controller.signal.aborted) setReferenceError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [productId, duration, open, useLlm]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/promo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ durationSec: duration, useLlm, ...(useLlm && !useSavedReference && !referenceUrl.trim() && selectedReference ? { referenceId: selectedReference } : {}), ...(useLlm && useSavedReference && savedReferenceId ? { referenceId: savedReferenceId } : {}), ...(useLlm && !useSavedReference && referenceUrl.trim() ? { referenceUrl: referenceUrl.trim() } : {}) }),
      });
      const body = (await res.json()) as { error?: string; projectId?: string };
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!hasLogo) {
    return (
      <div className="text-right">
        <Button variant="secondary" disabled>
          Generate promo film
        </Button>
        <p className="mt-1 text-[12px] text-faint">Upload a logo first</p>
      </div>
    );
  }

  return (
    <div className="text-right">
      {!open ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          Generate promo film
        </Button>
      ) : (
        <div className="inline-flex flex-col items-end gap-2 rounded-[10px] border border-hairline bg-surface p-3 text-left">
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-muted">Length</span>
            <select
              className="rounded-[6px] border border-hairline bg-canvas px-2 py-1 text-[13px]"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={busy}
            >
              {[18, 24, 33, 45].map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={useLlm} onChange={e => setUseLlm(e.target.checked)} disabled={busy} />
            Use AI direction
          </label>
          {useLlm && savedReferenceId && <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={useSavedReference} onChange={e => setUseSavedReference(e.target.checked)} disabled={busy} />
            Use the saved library reference
          </label>}
          {useLlm && !useSavedReference && <label className="flex w-full flex-col gap-1 text-[13px]">
            Reference video (optional)
            <input type="url" value={referenceUrl} onChange={e => setReferenceUrl(e.target.value)} disabled={busy} placeholder="YouTube video URL" className="rounded-[6px] border border-hairline bg-canvas px-2 py-1" />
          </label>}
          {useLlm && !useSavedReference && !referenceUrl.trim() && <fieldset className="max-w-[360px] space-y-2">
            <legend className="text-sm font-medium">Choose a reference</legend>
            <label className="flex gap-2 text-xs"><input type="radio" name={`reference-${productId}`} checked={!selectedReference} onChange={() => setSelectedReference("")} disabled={busy} />Direct from my product profile</label>
            {references.map(reference => <label key={reference.id} className="flex items-start gap-2 rounded border border-hairline p-2 text-xs">
              <input type="radio" name={`reference-${productId}`} checked={selectedReference === reference.id} onChange={() => setSelectedReference(reference.id)} disabled={busy} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={reference.posterUrl} alt="" width={88} height={66} className="rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
              <span><strong>{reference.title}</strong><span className="block text-muted">{reference.durationSec}s · {reference.visualLanguage.slice(0, 3).join(", ")}</span><span className="block text-faint">{reference.reasons.join(". ")}</span></span>
            </label>)}
            {referenceError && <p role="alert" className="text-xs text-red-600">{referenceError}</p>}
          </fieldset>}
          <p className="max-w-[34ch] text-[12px] leading-relaxed text-faint">
            Renders four formats from your {screenCount > 0 ? `${screenCount} screenshots` : "profile"} and palette.
            {useLlm ? " AI direction uses provider credits. References guide the edit; your assets appear in the film." : " This option uses no AI provider credits."}
          </p>
          {error && <p className="max-w-[34ch] text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={start} loading={busy}>
              {busy ? "Starting" : "Start render"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
