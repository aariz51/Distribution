import { db, jobs, sql, workerHeartbeats } from "@/lib/db";

/**
 * A queued job with no worker behind it looks identical to a slow job, which is
 * the single most confusing failure this system can present: the user presses
 * generate, the row says "queued", and nothing ever happens. This says so.
 */
export async function WorkerStatus() {
  const [workers, pending] = await Promise.all([
    db.select().from(workerHeartbeats),
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(sql`${jobs.status} in ('queued','retrying')`),
  ]);
  const live = workers.filter((w) => Date.now() - w.lastSeenAt.getTime() < 90_000);
  const queued = Number(pending[0]?.n ?? 0);
  if (live.length > 0) return null;

  return (
    <div className="mb-6 rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-[13px] font-medium text-amber-900">
        No worker is running{queued > 0 ? `, and ${queued} job${queued === 1 ? "" : "s"} ${queued === 1 ? "is" : "are"} waiting` : ""}.
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-amber-800">
        Rendering, transcription and clipping all run in the worker process. Until it is up, anything you start will sit
        in the queue rather than fail. Start it with:
      </p>
      <code className="mt-2 block font-mono text-[12px] text-amber-900">pnpm --filter @distribution/worker start</code>
    </div>
  );
}
