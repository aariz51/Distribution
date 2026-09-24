"use client";
import { JobProgress } from "./JobProgress";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SourceItem as SourceView } from "@/components/views";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { formatDuration, formatRelative, humanize } from "@/components/ui/format";

const RIGHTS_LABEL: Record<string, string> = { owned: "Owned", licensed: "Licensed", third_party_attested: "Attested", unknown: "Unknown rights" };

export function SourceRow({ productId, source: s }: { productId: string; source: SourceView }) {
  const router = useRouter();
  const [editingRights, setEditingRights] = useState(false);
  const [rights, setRights] = useState(s.rights);
  const [confirmed, setConfirmed] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [probeJobId, setProbeJobId] = useState<string | null>(null);
  const [probeActive, setProbeActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rightsUnknown = s.rights === "unknown";
  const runnable = ["discovered", "failed", "ready", "queued"].includes(s.status) && !rightsUnknown;
  const runActive = s.activeSourceJob || s.latestProject && !["completed", "failed", "cancelled", "published", "archived"].includes(s.latestProject.status);
  const why = !runnable
    ? rightsUnknown
      ? "Set rights before processing"
      : s.status === "failed"
      ? "Source failed to ingest"
      : s.status === "downloading"
        ? "Still downloading"
        : s.status === "discovered"
          ? "Waiting for licence check"
          : s.status === "archived"
            ? "Archived"
            : `Status: ${s.status}`
    : runActive
      ? "A run is already in progress"
      : null;

  async function saveRights() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/products/${productId}/sources/${s.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ rights, confirmed, explanation: explanation || undefined }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save rights");
      setEditingRights(false); setConfirmed(false); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/products/${productId}/sources/${s.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!r.ok) {
        let msg = `Request failed (${r.status})`;
        try {
          msg = ((await r.json()) as { error?: string }).error ?? msg;
        } catch {
          /* non-json */
        }
        throw new Error(msg);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function inspect() {
    setProbeActive(true);
    setError(null);
    try {
      const response = await fetch(`/api/products/${productId}/sources/${s.id}/probe`, { method: "POST" });
      const body = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !body.jobId) throw new Error(body.error ?? "Could not start source inspection");
      setProbeJobId(body.jobId);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setProbeActive(false);
    }
  }

  const title = s.title ?? s.url ?? "Uploaded video";

  return (
    <li className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_110px_120px_90px_140px_auto] lg:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={title}>
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {s.creator && <span>{s.creator}</span>}
          <span className="text-faint">{humanize(s.kind)}</span>
          <span className="text-faint" title={new Date(s.createdAt).toLocaleString()}>{formatRelative(s.createdAt)}</span>
        </p>
        {editingRights && <div className="mt-3 flex flex-col gap-2 rounded border border-hairline p-3">
          <label className="text-xs">Source rights<select className="ml-2 rounded border border-hairline bg-canvas p-1" value={rights} onChange={e => { setRights(e.target.value); setConfirmed(false); }} disabled={busy}>{Object.entries(RIGHTS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {["licensed", "third_party_attested"].includes(rights) && <label className="text-xs">License or permission details<textarea className="mt-1 w-full rounded border border-hairline bg-canvas p-2" value={explanation} onChange={e => setExplanation(e.target.value)} maxLength={4000} disabled={busy} /></label>}
          {rights !== "unknown" && <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} />{rights === "owned" ? "I own this source and have rights to use it." : "I confirm this license or permission allows my use of the source."}</label>}
          <div className="flex gap-2"><Button size="sm" onClick={saveRights} loading={busy} disabled={rights !== "unknown" && (!confirmed || (["licensed", "third_party_attested"].includes(rights) && explanation.trim().length < 10))}>Save rights</Button><Button size="sm" variant="ghost" onClick={() => setEditingRights(false)} disabled={busy}>Cancel</Button></div>
        </div>}
        {s.screening && <p className="mt-1 text-xs text-muted">{s.screening.status === "allowed" ? "Screened: no restricted content detected" : s.screening.status === "pending" ? "Current content checks are still required" : `Content blocked: ${s.screening.reason ?? "screening needs review"}`}</p>}
        {s.screening && ["rejected", "uncertain"].includes(s.screening.status) && <a href="#source-topic" className="mt-1 inline-block text-xs underline">Find alternative videos</a>}
        {s.qualification === "needs-rights" && s.rights === "unknown" && <p className="mt-1 text-xs text-muted">No reuse license verified. Confirm permission before content screening.</p>}
        {s.qualification === "batch-limit" && s.screening?.status !== "allowed" && <p className="mt-1 text-xs text-muted">This search’s screening limit was reached. Generate clips to run this source through all checks.</p>}
        {s.activeSourceJob && <JobProgress key={s.activeSourceJob.id} jobId={s.activeSourceJob.id} compact initial={s.activeSourceJob} />}
        {s.failureReason && <p className="mt-1 text-xs text-red-600">{s.failureReason}</p>}
        {probeJobId && <JobProgress key={probeJobId} jobId={probeJobId} compact initial={{ status: "queued", progressPct: 0, currentStep: null, attempts: 0, error: null, result: null }} onDone={() => setProbeActive(false)} />}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <div className="font-mono text-[13px] tabular-nums text-muted">{formatDuration(s.durationSec)}</div>
      <div>
        <Pill status={s.rights}>{RIGHTS_LABEL[s.rights] ?? humanize(s.rights)}</Pill>
      </div>
      <div>
        <Pill status={s.status} />
      </div>
      <div className="text-[13px] text-muted tabular-nums">
        <Link href={`/products/${productId}/library`} className="hover:text-ink">
          {s.clipCount} {s.clipCount === 1 ? "clip" : "clips"}
        </Link>
        {s.latestProject && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-faint">
            · run <Pill status={s.latestProject.status} dot={false} className="h-5 px-1.5 text-[11px]" />
          </span>
        )}
      </div>
      <div className="flex flex-col items-start gap-1 lg:items-end">
        <Button size="sm" variant={runnable && !runActive ? "primary" : "secondary"} disabled={!runnable || Boolean(runActive) || probeActive} loading={busy} onClick={run} title={why ?? undefined}>
          Generate clips
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || Boolean(runActive) || s.status === "downloading"} loading={probeActive} onClick={inspect}>Refresh metadata</Button>
        <Button size="sm" variant="ghost" disabled={busy || probeActive || Boolean(runActive)} onClick={() => { setRights(s.rights); setConfirmed(false); setEditingRights(true); }}>Edit rights</Button>
        {why && <span className="text-[11px] text-faint">{why}</span>}
      </div>
    </li>
  );
}
