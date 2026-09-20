"use client";
import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Pill } from "@/components/ui/Pill";
import { cn } from "@/components/ui/cn";

interface Status {
  status: string;
  progressPct: number;
  currentStep: string | null;
  attempts: number;
  error: { message?: string; step?: string | null } | null;
  result: Record<string, unknown> | null;
}
interface Ev {
  id: number;
  at: string;
  level: string;
  step: string | null;
  pct: number | null;
  message: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function JobProgress({ jobId, initial, onDone, compact }: { jobId: string; initial: Status; onDone?: (s: Status) => void; compact?: boolean }) {
  const [status, setStatus] = useState<Status>(initial);
  const [events, setEvents] = useState<Ev[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (TERMINAL.has(status.status)) return;
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.addEventListener("event", (e) => setEvents((prev) => [...prev, JSON.parse((e as MessageEvent).data) as Ev].slice(-100)));
    es.addEventListener("status", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as Status;
      setStatus(s);
      if (TERMINAL.has(s.status)) {
        es.close();
        onDone?.(s);
      }
    });
    es.onerror = () => es.close();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const tone = status.status === "completed" ? "emerald" : status.status === "failed" ? "red" : status.status === "retrying" ? "amber" : status.status === "cancelled" ? "gray" : "teal";
  const label =
    status.status === "completed"
      ? "Done"
      : status.status === "failed"
        ? `Failed${status.error?.step ? ` at ${status.error.step}` : ""}`
        : status.status === "cancelled"
          ? "Cancelled"
          : status.status === "queued"
            ? "Queued"
            : status.currentStep ?? "Working";
  const pct = status.status === "completed" ? 100 : status.progressPct;
  const live = !TERMINAL.has(status.status);

  return (
    <div className={cn(compact ? "" : "rounded-[8px] border border-hairline bg-surface p-3", "text-sm")}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Pill status={status.status} />
          <span className="truncate text-[13px] text-muted">{label}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="font-mono text-[12px] tabular-nums text-faint">{pct}%</span>
          {live && (
            <button onClick={() => setOpen((o) => !o)} className="text-xs text-muted hover:text-ink">
              {open ? "Hide log" : "Log"}
            </button>
          )}
        </span>
      </div>
      <ProgressBar value={pct} tone={tone} className="mt-2" indeterminate={status.status === "queued"} />
      {status.status === "failed" && status.error?.message && <p className="mt-2 text-xs text-red-600">{status.error.message}</p>}
      {status.attempts > 1 && <p className="mt-1 text-[11px] text-faint tabular-nums">attempt {status.attempts}</p>}
      {open && (
        <ul className="mt-3 max-h-48 space-y-0.5 overflow-auto rounded-[6px] border border-hairline bg-canvas p-2 font-mono text-[11px] leading-relaxed text-muted">
          {events.map((e) => (
            <li key={e.id} className="whitespace-pre-wrap break-words">
              <span className="text-faint">{new Date(e.at).toLocaleTimeString()}</span> {e.step ? `[${e.step}] ` : ""}
              {e.message}
            </li>
          ))}
          {events.length === 0 && <li className="text-faint">waiting for events…</li>}
        </ul>
      )}
    </div>
  );
}
