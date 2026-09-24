/** Full branded-clipping test using the real nutrition source attached to SafeChoice. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { accounts, assets, brandAssets, closeDb, eq, features, getDb, jobs, products, projects, sourceVideos, usageLedger } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { probeMedia, run, bin } from "@distribution/media";
import { getStorage } from "@distribution/storage";
import { registerPipelines } from "@distribution/pipelines";

async function main() {
  const qaUrl = process.env.DATABASE_URL;
  if (!qaUrl?.includes("distribution_qa_")) throw new Error("Use a disposable distribution_qa_ database");
  process.env.DATABASE_URL = "postgres://localhost:5432/distribution";
  const sourceDb = getDb();
  const sourceProductId = "6cc41ef3-7761-4520-b843-361ce1b8bca7";
  const product = (await sourceDb.select().from(products).where(eq(products.id, sourceProductId)))[0]!;
  const sourceFeatures = await sourceDb.select().from(features).where(eq(features.productId, product.id));
  const sourceBrand = await sourceDb.select().from(brandAssets).where(eq(brandAssets.productId, product.id));
  const sourceAssets = await sourceDb.select().from(assets).where(eq(assets.productId, product.id));
  const source = (await sourceDb.select().from(sourceVideos).where(eq(sourceVideos.id, "c806bbdb-fcd5-4fa6-bdf3-0d1a65238c0e")))[0]!;
  if (product.product.name !== "SafeChoice" || !source) throw new Error("Verified SafeChoice inputs missing");
  await closeDb();
  process.env.DATABASE_URL = qaUrl;
  process.env.WORKER_MEDIA_CONCURRENCY = "1";
  process.env.WORKER_RENDER_CONCURRENCY = "1";
  process.env.WORKER_LLM_CONCURRENCY = "1";
  process.env.REMOTION_CONCURRENCY = "1";
  const db = getDb();
  const productId = randomUUID(), accountId = randomUUID(), projectId = randomUUID();
  await db.insert(accounts).values({ id: accountId, name: "SafeChoice clipping QA" });
  await db.insert(products).values({ ...product, id: productId, accountId, contentPreferences: { ...product.contentPreferences, clipsPerSource: 2 } });
  await db.insert(features).values(sourceFeatures.map(f => ({ ...f, id: randomUUID(), productId })));
  for (const brand of sourceBrand) {
    const original = sourceAssets.find(a => a.id === brand.assetId)!;
    const assetId = randomUUID();
    await db.insert(assets).values({ ...original, id: assetId, productId, projectId: null, sourceId: null, jobId: null, thumbnailAssetId: null });
    if (brand.kind === "logo") await db.update(products).set({ brand: { ...product.brand, logoAssetId: assetId } }).where(eq(products.id, productId));
    await db.insert(brandAssets).values({ ...brand, id: randomUUID(), productId, assetId, featureId: null });
  }
  const sourceId = randomUUID();
  await db.insert(sourceVideos).values({ ...source, id: sourceId, productId, status: "ready" });
  await db.insert(projects).values({ id: projectId, productId, sourceId, kind: "shorts", profileVersion: product.version, status: "running" });
  const queue = await JobQueue.start(db);
  registerPipelines(queue);
  console.log(JSON.stringify({ projectId, productId, accountId }));
  try {
    await queue.work(["llm", "media"]);
    await queue.enqueue("source.ingest", { productId, projectId, sourceId }, { productId, projectId, maxAttempts: 1 });
    const deadline = Date.now() + 45 * 60_000;
    let last = "";
    while (Date.now() < deadline) {
      const rows = await db.select().from(jobs).where(eq(jobs.productId, productId));
      const failed = rows.find(j => j.status === "failed");
      if (failed) throw new Error(`${failed.type}: ${JSON.stringify(failed.error)}`);
      const costs = await db.select().from(usageLedger).where(eq(usageLedger.accountId, accountId));
      const cost = costs.reduce((sum, row) => sum + row.usdEstimate, 0);
      if (cost > 1) throw new Error("Provider test budget guard exceeded $1; stop before any more calls");
      const status = rows.map(j => `${j.type}:${j.status}:${j.progressPct}`).sort().join(" ");
      if (status !== last) { console.log(status); last = status; }
      if (rows.some(j => j.type === "shorts.enrich") && rows.every(j => j.status === "completed")) {
        const outputs = (await db.select().from(assets).where(eq(assets.projectId, projectId))).filter(a => a.type === "clip" || a.type === "clip_enriched");
        if (outputs.length !== 4) throw new Error(`expected four clip versions, got ${outputs.length}`);
        for (const output of outputs) {
          if (output.type === "clip" && output.metadata.captions === "none") throw new Error("captions missing");
          if (output.type === "clip_enriched" && (Object.keys(output.metadata.skipped as object).length || JSON.stringify(output.metadata.steps) !== JSON.stringify(output.metadata.requestedSteps))) throw new Error("requested enrichment was skipped");
          const file = await getStorage().localPathFor(output.storageKey);
          const probe = await probeMedia(file);
          if (!probe.hasVideo || !probe.hasAudio || probe.durationSec < 1) throw new Error("invalid clip render");
          await run(bin("ffmpeg"), ["-v", "error", "-i", file, "-f", "null", "-"], { timeoutMs: 120_000 });
        }
        console.log(`PASS: real transcription, ranking, two captioned cuts, thumbnails, copy and enriched outputs; real provider cost $${cost.toFixed(6)}; project ${projectId}`);
        return;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error("reference promo exceeded 45 minute deadline");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
