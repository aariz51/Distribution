import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, getDb, eq, sourceVideos, products, jobs, assets, features } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceIngest } from "@distribution/pipelines";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
  const original = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId)))[0]!;
  const product = (await db.select().from(products).where(eq(products.id, productId)))[0]!;
  if (!original || product.contentPreferences.cleanSource) throw new Error("Expected verified SafeChoice source without cleaning");
  const sourceId = randomUUID();
  await db.insert(sourceVideos).values({ ...original, id: sourceId, kind: "youtube", url: "https://www.youtube.com/watch?v=eKQWFJmCWZE" });
  const queue = await JobQueue.start(db);
  queue.register("source.ingest", sourceIngest);
  try {
    await queue.work(["media"]);
    for (const wrongOwner of [false, false, true]) {
      const { jobId } = await queue.enqueue("source.ingest", { productId: wrongOwner ? randomUUID() : productId, sourceId }, { maxAttempts: 1 });
      const deadline = Date.now() + 20_000;
      let done = false;
      while (Date.now() < deadline) {
        const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
        if (["completed", "failed"].includes(job.status)) {
          if (job.status !== (wrongOwner ? "failed" : "completed")) throw new Error(JSON.stringify(job.error));
          done = true; break;
        }
        await new Promise(r => setTimeout(r, 200));
      }
      if (!done) throw new Error("Ingest timed out (stored source should not redownload)");
    }
    const row = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)))[0]!;
    if (row.storageKey !== original.storageKey || row.status !== "ready") throw new Error("Retry lost original source");
    const matching = (await db.select().from(assets).where(eq(assets.productId, productId))).filter(a => a.storageKey === original.storageKey);
    if (matching.length !== 1) throw new Error("Retry duplicated original asset");
    const cleanProductId = randomUUID(), cleanSourceId = randomUUID();
    await db.insert(products).values({ ...product, id: cleanProductId, slug: `clean-qa-${cleanProductId}`, contentPreferences: { ...product.contentPreferences, cleanSource: true } });
    const featureRows = await db.select().from(features).where(eq(features.productId, productId));
    await db.insert(features).values(featureRows.map(feature => ({ ...feature, id: randomUUID(), productId: cleanProductId })));
    await db.insert(sourceVideos).values({ ...original, id: cleanSourceId, productId: cleanProductId, kind: "upload", url: null, storageKey: "tmp/qa-clean-source-input.mp4", probe: null });
    const { jobId: cleanJobId } = await queue.enqueue("source.ingest", { productId: cleanProductId, sourceId: cleanSourceId }, { maxAttempts: 1 });
    const deadline = Date.now() + 300_000;
    let cleaned = false;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, cleanJobId)))[0]!;
      if (job.status === "failed") throw new Error(JSON.stringify(job.error));
      if (job.status === "completed") {
        const row = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, cleanSourceId)))[0]!;
        if (!row.probe?.cleaned || row.probe.originalStorageKey !== "tmp/qa-clean-source-input.mp4" || !row.storageKey?.endsWith("/cleaned.mp4")) throw new Error("Upload cleaning not applied or original lost");
        cleaned = true; break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!cleaned) throw new Error("Upload cleaning timed out");
    console.log("PASS: uploaded SafeChoice excerpt actually cleaned with voice isolation; original preserved");
    console.log("PASS: actual SafeChoice source reused without redownload; repeated ingest preserves identity; foreign-product ingest rejected");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
