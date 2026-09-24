import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, getDb, closeDb, jobs, sourceVideos, createDedicatedClient } from "@distribution/db";
import { JobQueue, type JobContext } from "@distribution/jobs";
import { sourceProbe } from "../packages/pipelines/src/shorts/probe";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), blocker = createDedicatedClient(db);
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
  try {
    const input = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId))).find(s => s.storageKey?.includes("qualification-test/"))!;
    if (!input) throw new Error("Run real qualification test first");
    const sourceId = randomUUID(), batch = randomUUID();
    await db.insert(sourceVideos).values({ id: sourceId, productId, kind: "upload", rights: "owned", storageKey: input.storageKey });
    const payload = { productId, sourceId, qualificationBatch: batch };
    const pending = await queue.enqueue("source.probe", payload, { productId, sourceId });
    await blocker.connect(); await blocker.query("BEGIN");
    await blocker.query("select id from products where id=$1 for update", [productId]);
    const pid = (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
    const ctx = { db, queue, jobId: pending.jobId, payload, signal: new AbortController().signal, progress: async () => {}, event: async () => {} } as unknown as JobContext<"source.probe">;
    const probe = sourceProbe(ctx);
    let waiting = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const rows = await blocker.query<{ n: string }>("select count(*) as n from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [pid]);
      if (Number(rows.rows[0]!.n) > 0) { waiting = true; break; }
      await new Promise(r => setTimeout(r, 20));
    }
    if (!waiting) throw new Error("Probe did not enter guarded admission transaction");
    const cancel = queue.cancel(pending.jobId);
    await blocker.query("COMMIT");
    await Promise.all([probe, cancel]);
    const related = await db.select().from(jobs).where(eq(jobs.sourceId, sourceId));
    if (related.length !== 2 || related.some(j => j.status !== "cancelled")) throw new Error(`Cancellation leaked work: ${related.map(j => j.type + ':' + j.status)}`);
    console.log("PASS: cancellation racing inside qualification transaction cancels both parent and newly committed screening descendant");
    const next = await queue.enqueue("source.probe", payload, { productId, sourceId });
    await queue.cancel(next.jobId);
    let rejected = false;
    try { await sourceProbe({ ...ctx, jobId: next.jobId }); } catch { rejected = true; }
    if (!rejected || (await db.select().from(jobs).where(eq(jobs.sourceId, sourceId))).length !== 3) throw new Error("Cancelled parent admitted a new child");
    console.log("PASS: persisted cancellation prevents later qualification admission");
  } finally { await blocker.end(); await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
