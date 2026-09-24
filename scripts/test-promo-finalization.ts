/** Real queue + encoder regression using an existing, verified SafeChoice render. */
import { randomUUID } from "node:crypto";
import { accounts, assets, closeDb, eq, features, getDb, jobs, products, projects } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { probeMedia, run, bin } from "@distribution/media";
import { getStorage } from "@distribution/storage";
import { promoFinalize } from "../packages/pipelines/src/promo/jobs";

async function main() {
  const qaUrl = process.env.DATABASE_URL;
  if (!qaUrl?.includes("distribution_qa_")) throw new Error("Use a disposable distribution_qa_ database");
  process.env.DATABASE_URL = "postgres://localhost:5432/distribution";
  const sourceDb = getDb();
  const product = (await sourceDb.select().from(products).where(eq(products.id, "6cc41ef3-7761-4520-b843-361ce1b8bca7")))[0]!;
  const sourceFeatures = await sourceDb.select().from(features).where(eq(features.productId, product.id));
  const originals = (await sourceDb.select().from(assets).where(eq(assets.projectId, "20cfa718-cec9-42b3-8ff1-b80565352551"))).filter(a => a.type.startsWith("promo_") && !a.metadata.appStoreCut);
  if (product.product.name !== "SafeChoice" || originals.length !== 4) throw new Error("Verified SafeChoice inputs missing");
  await closeDb();
  process.env.DATABASE_URL = qaUrl;
  process.env.WORKER_MEDIA_CONCURRENCY = "2";
  const db = getDb();
  const productId = randomUUID(), accountId = randomUUID(), projectId = randomUUID();
  await db.insert(accounts).values({ id: accountId, name: "SafeChoice finalization QA" });
  await db.insert(products).values({ ...product, id: productId, accountId });
  await db.insert(features).values(sourceFeatures.map(f => ({ ...f, id: randomUUID(), productId })));
  await db.insert(projects).values({ id: projectId, productId, kind: "promo", profileVersion: product.version, status: "running" });
  const queue = await JobQueue.start(db);
  queue.register("promo.finalize", promoFinalize);
  async function waitFor(jobId: string) {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const row = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      if (row.status === "completed") return;
      if (row.status === "failed") throw new Error(JSON.stringify(row.error));
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error("finalizer timed out");
  }
  async function insertInput(a: typeof originals[number]) {
    await db.insert(assets).values({ ...a, id: randomUUID(), productId, projectId, jobId: null, thumbnailAssetId: null });
  }
  try {
    await queue.work(["media"]);
    const first = originals.find(a => a.type === "promo_store_portrait")!;
    await insertInput(first);
    const early = await queue.enqueue("promo.finalize", { productId, projectId }, { productId, projectId });
    await waitFor(early.jobId);
    const pending = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
    if (pending.status !== "running") throw new Error("partial render set marked complete");
    console.log("PASS: partial render set remains running");
    for (const a of originals.filter(a => a !== first)) await insertInput(a);
    const a = await queue.enqueue("promo.finalize", { productId, projectId }, { productId, projectId });
    const b = await queue.enqueue("promo.finalize", { productId, projectId }, { productId, projectId });
    await Promise.all([waitFor(a.jobId), waitFor(b.jobId)]);
    const cuts = (await db.select().from(assets).where(eq(assets.projectId, projectId))).filter(a => a.metadata.appStoreCut);
    if (cuts.length !== 2) throw new Error(`expected exactly two outputs, got ${cuts.length}`);
    for (const cut of cuts) {
      const file = await getStorage().localPathFor(cut.storageKey);
      const p = await probeMedia(file);
      if (!p.hasAudio || p.fps !== 30 || p.durationSec > 30 || !p.hasVideo) throw new Error("invalid store preview");
      await run(bin("ffmpeg"), ["-v", "error", "-i", file, "-f", "null", "-"], { timeoutMs: 60_000 });
    }
    console.log(`PASS: concurrent finalizers create exactly two playable SafeChoice store previews; project ${projectId}`);
  } finally {
    await queue.stop();
    await closeDb();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
