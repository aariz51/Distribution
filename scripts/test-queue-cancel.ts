import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs } from "@distribution/db";
import { run } from "@distribution/media";
import { JobQueue } from "@distribution/jobs";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const queue = await JobQueue.start(db);
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const ready = new Promise<void>(r => { started = r; });
  const done = new Promise<void>(r => { finished = r; });
  queue.register("brand.palette", async ctx => {
    await ctx.progress(20, "working"); started(); await gate;
    await ctx.progress(80, "late-progress"); finished(); return { late: true };
  });
  try {
    await queue.work(["light"]);
    const { jobId } = await queue.enqueue("brand.palette", { productId: randomUUID(), assetIds: [randomUUID()] });
    await ready;
    await queue.cancel(jobId);
    release(); await done;
    await new Promise(r => setTimeout(r, 500));
    const row = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
    if (row.status !== "cancelled" || row.result !== null || row.progressPct !== 20) throw new Error(`cancellation overwritten: ${row.status}/${row.progressPct}`);
    console.log("PASS: late handler progress and success cannot overwrite cancellation");
    let processStarted!: () => void, processStopped!: () => void;
    const processReady = new Promise<void>(r => { processStarted = r; });
    const stopped = new Promise<void>(r => { processStopped = r; });
    queue.register("brand.palette", async ctx => {
      processStarted();
      try { await run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { signal: ctx.signal, timeoutMs: 20_000 }); }
      catch (error) { if (ctx.signal.aborted) processStopped(); throw error; }
    });
    const second = await queue.enqueue("brand.palette", { productId: randomUUID(), assetIds: [randomUUID()] });
    await processReady;
    await queue.cancel(second.jobId);
    let timeout: ReturnType<typeof setTimeout>;
    try { await Promise.race([stopped, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("cancelled subprocess kept running")), 5000); })]); }
    finally { clearTimeout(timeout!); }
    console.log("PASS: cancellation propagates to and terminates the active subprocess");
  } finally { release(); await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
