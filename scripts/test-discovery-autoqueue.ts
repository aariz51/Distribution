import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, closeDb, eq, features, getDb, jobs, products, projects, sourceVideos } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceDiscover } from "../packages/pipelines/src/shorts/discover";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), productId = randomUUID();
  let injectFailure = true;
  try {
    const base = (await db.select().from(products).where(eq(products.id, "3fe71fcc-3101-432d-a1ec-583d785592a4")))[0]!;
    const baseFeatures = await db.select().from(features).where(eq(features.productId, base.id));
    const channelUrl = "https://www.youtube.com/@BBC/videos";
    // Disposable configuration fixture; never claim ownership of BBC content.
    // Only light workers run; every resulting ingest job is cancelled below.
    await db.insert(products).values({ ...base, id: productId, slug: `autoqueue-${productId}`, brand: { cta: base.brand.cta, screenshotAssetIds: [], otherAssetIds: [] }, sources: { connected: [{ kind: "youtube_channel", url: channelUrl, rights: "owned", autoQueue: true }] } });
    await db.insert(features).values(baseFeatures.map(feature => ({ ...feature, id: randomUUID(), productId, evidenceAssetIds: [] })));
    queue.register("source.discover", async ctx => {
      if (!injectFailure) return sourceDiscover(ctx);
      const intercepted = new Proxy(ctx.queue, { get(target, key) {
        if (key === "enqueueInTransaction") return async (...args: Parameters<JobQueue["enqueueInTransaction"]>) => {
          await target.enqueueInTransaction(...args);
          throw new Error("Injected interruption after first actual transactional enqueue");
        };
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      return sourceDiscover({ ...ctx, queue: intercepted });
    });
    await queue.work(["light"]);
    const enqueue = () => queue.enqueue("source.discover", { productId, channelUrl }, { productId, maxAttempts: 1 });
    async function wait(jobId: string) {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
        if (["failed", "completed"].includes(job.status)) return job;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error("Discovery timed out");
    }
    const interrupted = await wait((await enqueue()).jobId);
    if (interrupted.status !== "failed") throw new Error("Fault injection did not interrupt transaction");
    if ((await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId))).length || (await db.select().from(projects).where(eq(projects.productId, productId))).length || (await db.select().from(jobs).where(and(eq(jobs.productId, productId), eq(jobs.type, "source.ingest")))).length) throw new Error("Interrupted transaction left source/project/job rows");
    injectFailure = false;
    const requested = await Promise.all([enqueue(), enqueue()]);
    const results = await Promise.all(requested.map(result => wait(result.jobId)));
    if (results.some(job => job.status !== "completed")) throw new Error(`Concurrent discovery failed: ${JSON.stringify(results.map(j => j.error))}`);
    const sources = await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId));
    const runs = await db.select().from(projects).where(eq(projects.productId, productId));
    const ingest = await db.select().from(jobs).where(and(eq(jobs.productId, productId), eq(jobs.type, "source.ingest")));
    if (!sources.length || runs.length !== sources.length || ingest.length !== sources.length || new Set(sources.map(s => s.url)).size !== sources.length) throw new Error("Automatic ingestion duplicated or lost work");
    for (const source of sources) {
      const project = runs.find(p => p.sourceId === source.id);
      const job = ingest.find(j => j.sourceId === source.id);
      const snapshot = project?.params.profileSnapshot as { id?: string; version?: number } | undefined;
      if (source.status !== "queued" || source.storageKey || !project || !job || job.projectId !== project.id || job.status !== "queued" || snapshot?.id !== productId || snapshot.version !== base.version) throw new Error("Source/project/job/snapshot linkage failed");
    }
    console.log(`PASS: interrupted transactional enqueue rolls back completely; concurrent real scans create exactly ${sources.length} source/project/ingest groups with profile snapshots; no media worker ran`);
  } finally {
    await db.update(products).set({ sources: { connected: [] } }).where(eq(products.id, productId));
    for (const job of await db.select().from(jobs).where(eq(jobs.productId, productId))) if (!["completed", "failed", "cancelled"].includes(job.status)) await queue.cancel(job.id);
    await db.update(sourceVideos).set({ rights: "unknown" }).where(eq(sourceVideos.productId, productId));
    await queue.stop(); await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
