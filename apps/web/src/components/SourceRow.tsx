"use client";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rightsUnknown = s.rights === "unknown";
  const runnable = (s.status === "ready" || s.status === "queued") && !rightsUnknown;
  const runActive = s.latestProject && !["completed", "failed", "cancelled", "published", "archived"].includes(s.latestProject.status);
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
        {s.failureReason && <p className="mt-1 text-xs text-red-600">{s.failureReason}</p>}
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
        <Button size="sm" variant={runnable && !runActive ? "primary" : "secondary"} disabled={!runnable || Boolean(runActive)} loading={busy} onClick={run} title={why ?? undefined}>
          Generate clips
        </Button>
        {why && <span className="text-[11px] text-faint">{why}</span>}
      </div>
    </li>
  );
}
