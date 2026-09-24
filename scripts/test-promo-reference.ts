/** Real provider + queue + render verification, isolated DB with real SafeChoice assets. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { accounts, assets, brandAssets, closeDb, eq, features, getDb, jobs, products, projects, usageLedger } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { probeMedia, run, bin } from "@distribution/media";
import { getStorage } from "@distribution/storage";
import { registerPromo } from "../packages/pipelines/src/promo";

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
  const reference = sourceAssets.find(a => a.projectId === "20cfa718-cec9-42b3-8ff1-b80565352551" && a.type === "promo_vertical")!;
  if (product.product.name !== "SafeChoice" || !reference) throw new Error("Verified SafeChoice inputs missing");
  await closeDb();
  process.env.DATABASE_URL = qaUrl;
  process.env.WORKER_MEDIA_CONCURRENCY = "1";
  process.env.WORKER_RENDER_CONCURRENCY = "1";
  process.env.WORKER_LLM_CONCURRENCY = "1";
  process.env.REMOTION_CONCURRENCY = "1";
  const db = getDb();
  const productId = randomUUID(), accountId = randomUUID(), projectId = randomUUID();
  await db.insert(accounts).values({ id: accountId, name: "SafeChoice reference QA" });
  await db.insert(products).values({ ...product, id: productId, accountId });
  await db.insert(features).values(sourceFeatures.map(f => ({ ...f, id: randomUUID(), productId })));
  for (const brand of sourceBrand) {
    const original = sourceAssets.find(a => a.id === brand.assetId)!;
    const assetId = randomUUID();
    await db.insert(assets).values({ ...original, id: assetId, productId, projectId: null, sourceId: null, jobId: null, thumbnailAssetId: null });
    await db.insert(brandAssets).values({ ...brand, id: randomUUID(), productId, assetId, featureId: null });
  }
  const referenceAssetId = randomUUID();
  await db.insert(assets).values({ ...reference, id: referenceAssetId, productId, projectId: null, jobId: null, thumbnailAssetId: null });
  await db.insert(projects).values({ id: projectId, productId, kind: "promo", profileVersion: product.version, status: "running", params: { useLlm: true, durationSec: 15 } });
  const queue = await JobQueue.start(db);
  registerPromo(queue);
  console.log(JSON.stringify({ projectId, productId, accountId }));
  try {
    await queue.work(["llm", "render", "media"]);
    await queue.enqueue("promo.run", { productId, projectId, referenceAssetId, durationSec: 15 }, { productId, projectId, maxAttempts: 1 });
    const deadline = Date.now() + 45 * 60_000;
    let last = "";
    while (Date.now() < deadline) {
      const rows = await db.select().from(jobs).where(eq(jobs.projectId, projectId));
      const failed = rows.find(j => j.status === "failed");
      if (failed) throw new Error(`${failed.type}: ${JSON.stringify(failed.error)}`);
      const costs = await db.select().from(usageLedger).where(eq(usageLedger.accountId, accountId));
      const cost = costs.reduce((sum, row) => sum + row.usdEstimate, 0);
      if (cost > 1) throw new Error("Provider test budget guard exceeded $1; stop before any more calls");
      const p = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
      const status = rows.map(j => `${j.type}:${j.status}:${j.progressPct}`).sort().join(" ");
      if (status !== last) { console.log(status); last = status; }
      if (p.status === "completed") {
        const outputs = (await db.select().from(assets).where(eq(assets.projectId, projectId))).filter(a => a.type.startsWith("promo_"));
        if (outputs.length !== 6) throw new Error(`expected six films, got ${outputs.length}`);
        for (const output of outputs) {
          const file = await getStorage().localPathFor(output.storageKey);
          const probe = await probeMedia(file);
          if (!probe.hasVideo || !probe.hasAudio || probe.durationSec < 14.9 || probe.durationSec > 15.2) throw new Error("invalid reference-driven render");
          await run(bin("ffmpeg"), ["-v", "error", "-i", file, "-f", "null", "-"], { timeoutMs: 120_000 });
        }
        console.log(`PASS: vision, storyboard, audio, four renders and two store previews; real provider cost $${cost.toFixed(6)}; project ${projectId}`);
        return;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error("reference promo exceeded 45 minute deadline");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
