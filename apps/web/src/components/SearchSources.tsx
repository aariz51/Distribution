"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/Button";
import { JobProgress } from "./JobProgress";

export function SearchSources({ productId, defaultTopic }: { productId: string; defaultTopic: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultTopic);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function search() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/products/${productId}/sources/search`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
      const body = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !body.jobId) throw new Error(body.error ?? "Could not search YouTube");
      setJobId(body.jobId);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setBusy(false); }
  }
  return <section className="mt-4 rounded-[10px] border border-hairline bg-surface p-4">
    <label htmlFor="source-topic" className="text-sm font-medium">Find videos about your product’s topic</label>
    <div className="mt-2 flex flex-wrap gap-3">
      <input id="source-topic" className="min-w-0 flex-1 rounded border border-hairline bg-canvas p-2 text-sm" value={query} maxLength={240} onChange={e => setQuery(e.target.value)} disabled={busy} />
      <Button size="sm" loading={busy} disabled={query.trim().length < 3} onClick={search}>Find YouTube videos</Button>
    </div>
    <p className="mt-2 text-xs text-muted">Search Creative Commons discussions lasting 5 minutes to 3 hours. We verify each license, then screen up to 3 permitted videos for music and visible figures. Only completed checks count as a screened match. Other videos need permission or a separate run.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    {jobId && <JobProgress key={jobId} jobId={jobId} compact initial={{ status: "queued", progressPct: 0, currentStep: null, attempts: 0, error: null, result: null }} onDone={() => { setBusy(false); router.refresh(); }} />}
  </section>;
}
