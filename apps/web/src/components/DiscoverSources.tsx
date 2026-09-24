"use client";
import { useState } from "react";
import { Button } from "./ui/Button";
import { JobProgress } from "./JobProgress";

export function DiscoverSources({ productId, channels }: { productId: string; channels: string[] }) {
  const [active, setActive] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(channels[0] ?? "");
  if (!channels.length) return null;
  async function discover() {
    setActive(true); setError(null);
    try {
      const response = await fetch(`/api/products/${productId}/sources/discover`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channelUrl: selected }) });
      const body = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !body.jobId) throw new Error(body.error ?? "Could not start channel discovery");
      setJobId(body.jobId);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setActive(false); }
  }
  return <section className="mt-4 rounded-[10px] border border-hairline bg-surface p-4">
    <label className="flex flex-wrap items-center gap-3 text-sm">Connected YouTube channel
      <select className="max-w-full rounded border border-hairline bg-canvas p-2" value={selected} onChange={e => setSelected(e.target.value)} disabled={active}>{channels.map(url => <option key={url} value={url}>{url}</option>)}</select>
    </label>
    <p className="my-2 text-xs text-muted">Check the latest 50 videos. New sources appear below; existing sources are kept.</p>
    <Button size="sm" loading={active} onClick={discover}>Check for videos</Button>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    {jobId && <JobProgress key={jobId} jobId={jobId} compact initial={{ status: "queued", progressPct: 0, currentStep: null, attempts: 0, error: null, result: null }} onDone={() => setActive(false)} />}
  </section>;
}
