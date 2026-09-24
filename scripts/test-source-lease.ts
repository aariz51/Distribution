import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, sourceVideos } from "@distribution/db";
import { run } from "@distribution/media";
import { withSourceLease } from "../packages/pipelines/src/shorts/source-lease";
import { startRun } from "../apps/web/src/lib/runs";
import { getQueue } from "../apps/web/src/lib/queue";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use disposable QA database");
  const db = getDb(); const queue = await getQueue();
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4", sourceId = randomUUID();
  const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId)))[0]!;
  await db.insert(sourceVideos).values({ ...source, id: sourceId, status: "discovered" });
  let entered!: () => void, stopping!: () => void, release!: () => void, finished!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const cleanup = new Promise<void>(r => { stopping = r; });
  const allowFinish = new Promise<void>(r => { release = r; });
  const done = new Promise<void>(r => { finished = r; });
  const bounded = (promise: Promise<void>) => Promise.race([promise, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("lease test timed out")), 10000); timer.unref(); })]);
  let executions = 0;
  queue.register("source.ingest", async ctx => {
    if (++executions > 1) return {};
    try {
      return await withSourceLease(ctx, sourceId, async () => {
        try {
          await run(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], { signal: ctx.signal, timeoutMs: 20000, onStdoutLine: () => entered() });
        } finally {
          stopping(); await allowFinish;
          await db.update(sourceVideos).set({ status: "failed" }).where(eq(sourceVideos.id, sourceId));
        }
      });
    } finally { finished(); }
  });
  try {
    const first = await startRun(productId, sourceId);
    await queue.work(["media"]); await bounded(ready);
    await queue.cancel(first.jobId); await bounded(cleanup);
    let rejected = false;
    try { await startRun(productId, sourceId); } catch { rejected = true; }
    if (!rejected) throw new Error("Cancelled worker cleanup overlapped restart");
    release(); await bounded(done);
    const next = await startRun(productId, sourceId);
    await queue.cancel(next.jobId);
    const row = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)))[0]!;
    if (row.status !== "queued") throw new Error("Old cleanup overwrote new source state");
    console.log("PASS: cancellation terminates real subprocess; restart waits for old cleanup lease; restart succeeds after release");
  } finally { release(); await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
