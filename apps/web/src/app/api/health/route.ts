import { db, sql, workerHeartbeats, jobs } from "@/lib/db";
import { handler, json } from "@/lib/api";

export const GET = handler(async () => {
  const [dbOk] = await db.execute(sql`select 1 as ok`).then((r) => r.rows as { ok: number }[]);
  const workers = await db.select().from(workerHeartbeats);
  const liveWorkers = workers.filter((w) => Date.now() - w.lastSeenAt.getTime() < 90_000);
  const queued = await db.select({ n: sql<number>`count(*)` }).from(jobs).where(sql`${jobs.status} in ('queued','retrying')`);
  return json({
    ok: Boolean(dbOk?.ok),
    workers: liveWorkers.map((w) => ({ id: w.workerId, queues: w.queues, lastSeenAt: w.lastSeenAt })),
    queuedJobs: Number(queued[0]?.n ?? 0),
  });
});
