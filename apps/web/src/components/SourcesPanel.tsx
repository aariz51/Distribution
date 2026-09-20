"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface SourceRow {
  id: string;
  kind: string;
  url: string | null;
  title: string | null;
  creator: string | null;
  durationSec: number | null;
  rights: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
}

const RIGHTS_LABEL: Record<string, string> = { owned: "owned", licensed: "Creative Commons", third_party_attested: "permission attested", unknown: "rights unknown" };

export function SourcesPanel({ productId, sources }: { productId: string; sources: SourceRow[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState<"unknown" | "owned" | "third_party_attested">("unknown");
  const [attestation, setAttestation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addUrl() {
    setError(null);
    setBusy("Adding…");
    try {
      const r = await fetch(`/api/products/${productId}/sources`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, rights, attestation: attestation || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setUrl("");
      setAttestation("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  async function addUpload() {
    if (!file) return;
    setError(null);
    setBusy(`Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("rights", "owned");
      const r = await fetch(`/api/products/${productId}/sources`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "upload failed");
      setFile(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  async function generate(sourceId: string) {
    setBusy("Starting…");
    try {
      const r = await fetch(`/api/products/${productId}/shorts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId }) });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const input = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm";
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="font-medium">Long-form sources</h2>
      <p className="mt-1 text-xs text-zinc-500">Each source is probed for licence and rights before download. Only owned, Creative Commons, or attested content is processed.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input className={input} placeholder="https://youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <select className={input} value={rights} onChange={(e) => setRights(e.target.value as typeof rights)}>
          <option value="unknown">Check licence</option>
          <option value="owned">I own this</option>
          <option value="third_party_attested">I have permission</option>
        </select>
        <button disabled={!url || busy !== null || (rights === "third_party_attested" && attestation.length < 10)} onClick={addUrl} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">Add URL</button>
      </div>
      {rights === "third_party_attested" && (
        <textarea className={`${input} mt-2 w-full`} rows={2} placeholder="Who gave permission, when, and how (stored with the source)" value={attestation} onChange={(e) => setAttestation(e.target.value)} />
      )}
      <div className="mt-3 flex items-center gap-3 text-sm">
        <input type="file" accept="video/*,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
        <button disabled={!file || busy !== null} onClick={addUpload} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-40">Upload as own content</button>
        {busy && <span className="text-xs text-zinc-500">{busy}</span>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {sources.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-100 text-sm">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.title ?? s.url ?? s.id}</p>
                <p className="text-xs text-zinc-500">
                  {s.kind}{s.creator ? ` · ${s.creator}` : ""}{s.durationSec ? ` · ${Math.round(s.durationSec / 60)} min` : ""} · <span className={s.rights === "unknown" ? "text-amber-700" : "text-emerald-700"}>{RIGHTS_LABEL[s.rights] ?? s.rights}</span> · {s.status}
                </p>
                {s.failureReason && <p className="mt-0.5 text-xs text-red-600">{s.failureReason}</p>}
              </div>
              <button disabled={busy !== null || s.status === "downloading"} onClick={() => generate(s.id)} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white disabled:opacity-40">Generate shorts</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
