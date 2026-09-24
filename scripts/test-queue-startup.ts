/** Real Postgres/pg-boss regression. Run only against a disposable migrated database. */
import { randomUUID } from "node:crypto";
import { closeDb, getDb, jobs, eq } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable distribution_qa_ database");
  const db = getDb();
  const worker = await JobQueue.start(db);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  let client: JobQueue | undefined;
  worker.register("brand.palette", async ctx => { await ctx.progress(37, "processing"); started(); await gate; });
  try {
    await worker.work(["light"]);
    const { jobId } = await worker.enqueue("brand.palette", { productId: randomUUID(), assetIds: [randomUUID()] });
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([ready, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("worker did not start")), 15_000); })]);
    } finally { clearTimeout(timeout!); }
    client = await JobQueue.start(db);
    const row = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
    if (row.status !== "progress" || row.progressPct !== 37) throw new Error(`second client corrupted active job: ${row.status}/${row.progressPct}`);
    console.log("PASS: starting another queue client preserves the active worker's status and progress");
    const orphanId = randomUUID();
    await db.insert(jobs).values({ id: orphanId, type: "brand.palette", status: "progress", payload: { productId: randomUUID(), assetIds: [randomUUID()] } });
    await client.reclaimStaleJobs();
    const orphan = (await db.select().from(jobs).where(eq(jobs.id, orphanId)))[0]!;
    if (orphan.status !== "failed" || !orphan.completedAt) throw new Error("missing queue lease left an orphan job running forever");
    console.log("PASS: missing transport jobs terminate visibly instead of being silently reexecuted");
  } finally {
    release();
    await client?.stop();
    await worker.stop();
    await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
