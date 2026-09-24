/** Actual production thumbnail handler with SafeChoice promo frames and a real bounded provider call. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { assets, closeDb, eq, getDb, jobs, productBudget, usageLedger } from "@distribution/db";
import { logger } from "@distribution/core";
import { withProviderBudget } from "@distribution/core/provider-budget";
import { createProgressWriter, JobQueue } from "@distribution/jobs";
import { shortsThumbnail } from "@distribution/pipelines";
import { getStorage } from "@distribution/storage";
import sharp from "sharp";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), jobId = randomUUID();
  try {
    const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
    const asset = (await db.select().from(assets).where(eq(assets.productId, productId))).find(a => a.projectId === "87a4532a-92e7-4408-a6cc-18079b5d948a" && a.type === "promo_vertical");
    if (!asset?.projectId) throw new Error("Real SafeChoice promo required");
    const payload = { productId, projectId: asset.projectId, assetId: asset.id };
    await db.insert(jobs).values({ id: jobId, type: "shorts.thumbnail", productId, projectId: asset.projectId, assetId: asset.id, status: "started", startedAt: new Date(), payload });
    const result = await withProviderBudget(productBudget(db, productId, jobId), () => shortsThumbnail({ jobId, type: "shorts.thumbnail", payload, db, queue, log: logger, signal: AbortSignal.timeout(600000), attempt: 1, maxAttempts: 1, ...createProgressWriter(db, jobId), recordUsage: async u => { await db.insert(usageLedger).values({ ...u, jobId }); } }));
    for (const [name, id] of Object.entries(result.variants)) {
      const row = (await db.select().from(assets).where(eq(assets.id, id)))[0]!;
      const file = await getStorage().localPathFor(row.storageKey), meta = await sharp(file).metadata();
      const expected = { portrait: [1080,1920], landscape: [1280,720], feed: [1080,1350] }[name];
      if (!expected || meta.width !== expected[0] || meta.height !== expected[1] || meta.hasAlpha) throw new Error(`Bad ${name} cover`);
      console.log(`RENDERED ${name}: ${file}`);
    }
    await db.update(jobs).set({ status: "completed", result, completedAt: new Date(), progressPct: 100 }).where(eq(jobs.id, jobId));
    console.log(JSON.stringify({ jobId, result }));
  } catch (error) {
    await db.update(jobs).set({ status: "failed", error: { message: error instanceof Error ? error.message : String(error) } }).where(eq(jobs.id, jobId));
    throw error;
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
