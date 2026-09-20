"use client";
import { useEffect, useState } from "react";

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

export function JobProgress({ jobId, initial, onDone }: { jobId: string; initial: Status; onDone?: (s: Status) => void }) {
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

  const tone =
    status.status === "completed" ? "bg-emerald-500" : status.status === "failed" ? "bg-red-500" : status.status === "retrying" ? "bg-amber-500" : "bg-zinc-900";
  const label =
    status.status === "completed" ? "Done" : status.status === "failed" ? `Failed${status.error?.step ? ` at ${status.error.step}` : ""}` : status.status === "queued" ? "Queued" : `${status.currentStep ?? "working"} → ${status.progressPct}%`;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        <button onClick={() => setOpen((o) => !o)} className="text-xs text-zinc-500 hover:text-zinc-900">
          {open ? "hide log" : "log"}
        </button>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-zinc-100">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${status.status === "completed" ? 100 : status.progressPct}%` }} />
      </div>
      {status.status === "failed" && status.error?.message && <p className="mt-2 text-xs text-red-600">{status.error.message}</p>}
      {open && (
        <ul className="mt-3 max-h-48 space-y-1 overflow-auto font-mono text-[11px] text-zinc-600">
          {events.map((e) => (
            <li key={e.id}>
              <span className="text-zinc-400">{new Date(e.at).toLocaleTimeString()}</span> {e.step ? `[${e.step}] ` : ""}
              {e.message}
            </li>
          ))}
          {events.length === 0 && <li className="text-zinc-400">waiting for events…</li>}
        </ul>
      )}
    </div>
  );
}
