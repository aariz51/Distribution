"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/Button";

export function JobActions({ jobId, type, status, retried }: { jobId: string; type: string; status: string; retried: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!/^(promo|shorts|source|copy|brand)\./.test(type) || status === "completed" || status === "cancelled") return null;
  if (retried) return <p className="mt-2 text-xs text-muted">A retry was created. Follow its progress in the job list.</p>;
  const action = status === "failed" ? "retry" : "cancel";
  async function submit() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update this job.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update this job."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    <Button variant="secondary" loading={busy} onClick={submit}>{action === "retry" ? "Retry job" : "Cancel job"}</Button>
    {action === "retry" && <span className="ml-2 text-xs text-muted">Provider charges may apply.</span>}
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
  </div>;
}
