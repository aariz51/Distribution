import { loadProfile } from "../packages/pipelines/src/shorts/common";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { assets, candidates, closeDb, eq, features, getDb, jobs, limits, products, projects, sourceVideos, transcripts, usageLedger } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { shortsEnrich } from "@distribution/pipelines";
import { getStorage } from "@distribution/storage";
import { probeMedia, bin, run } from "@distribution/media";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  const old = (await db.select().from(assets).where(eq(assets.id, "4ecf9ccb-e8d5-4f87-bf2b-34cf7b6bb503")))[0]!;
  const product = (await db.select().from(products).where(eq(products.id, old.productId)))[0]!;
  const project = (await db.select().from(projects).where(eq(projects.id, old.projectId!)))[0]!;
  const candidate = (await db.select().from(candidates).where(eq(candidates.id, old.candidateId!)))[0]!;
  const transcript = (await db.select().from(transcripts).where(eq(transcripts.id, candidate.transcriptId)))[0]!;
  const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, transcript.sourceId)))[0]!;
  const productId = randomUUID(), projectId = randomUUID(), sourceId = randomUUID(), transcriptId = randomUUID(), candidateId = randomUUID(), assetId = randomUUID();
  await db.transaction(async tx => {
    await tx.insert(products).values({ ...product, id: productId, slug: `female-qa-${productId}`, contentPreferences: { ...product.contentPreferences, voice: "female", broll: true, sfx: true, outro: true } });
    const featureRows = await tx.select().from(features).where(eq(features.productId, product.id));
    if (!featureRows.length) throw new Error("SafeChoice fixture has no features");
    await tx.insert(features).values(featureRows.map(row => ({ ...row, id: randomUUID(), productId })));
    if (typeof product.brand.logoAssetId === "string") {
      const logo = (await tx.select().from(assets).where(eq(assets.id, product.brand.logoAssetId)))[0]!;
      const logoId = randomUUID();
      await tx.insert(assets).values({ ...logo, id: logoId, productId, projectId: null, jobId: null, sourceId: null, candidateId: null, thumbnailAssetId: null });
      await tx.update(products).set({ brand: { ...product.brand, logoAssetId: logoId } }).where(eq(products.id, productId));
    }
    await tx.insert(limits).values({ id: randomUUID(), scope: "product", scopeId: productId, key: "usd_month", value: 0.5 });
    await tx.insert(sourceVideos).values({ ...source, id: sourceId, productId });
    await tx.insert(transcripts).values({ ...transcript, id: transcriptId, sourceId });
    await tx.insert(projects).values({ ...project, id: projectId, productId, sourceId, status: "running" });
    await tx.insert(candidates).values({ ...candidate, id: candidateId, projectId, transcriptId });
    await tx.insert(assets).values({ ...old, id: assetId, productId, projectId, sourceId, candidateId, thumbnailAssetId: null, jobId: null });
  });
  const profileSnapshot = await loadProfile(db, productId);
  await db.update(projects).set({ params: { ...project.params, profileSnapshot }, profileVersion: profileSnapshot.version }).where(eq(projects.id, projectId));
  process.env.WORKER_MEDIA_CONCURRENCY = "1";
  const queue = await JobQueue.start(db); queue.register("shorts.enrich", shortsEnrich);
  try {
    await queue.work(["media"]);
    const { jobId } = await queue.enqueue("shorts.enrich", { productId, projectId, assetId, steps: ["broll", "sfx", "outro"] }, { productId, projectId, assetId, maxAttempts: 1 });
    console.log(JSON.stringify({ productId, projectId, assetId, jobId }));
    let previous = ""; const deadline = Date.now() + 15 * 60000;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      const state = `${job.status}:${job.currentStep}`; if (state !== previous) { console.log(state); previous = state; }
      if (job.status === "failed") throw new Error(JSON.stringify(job.error));
      if (job.status === "completed") {
        const output = (await db.select().from(assets).where(eq(assets.id, String(job.result?.assetId))))[0]!;
        if (output.metadata.voice !== "female" || JSON.stringify(output.metadata.steps) !== '["broll","sfx","outro"]') throw new Error("Requested enrichments missing");
        const file = await getStorage().localPathFor(output.storageKey), media = await probeMedia(file);
        if (!media.hasVideo || !media.hasAudio || media.durationSec <= 8 || media.durationSec > 15.2) throw new Error("Invalid output");
        await run(bin("ffmpeg"), ["-v", "error", "-i", file, "-f", "null", "-"], { timeoutMs: 120000 });
        const spend = await db.select().from(usageLedger).where(eq(usageLedger.productId, productId));
        if (!spend.some(u => u.kind === "tts")) throw new Error("Missing voice usage accounting");
        console.log(JSON.stringify({ pass: true, assetId: output.id, file, duration: media.durationSec, cost: spend.reduce((sum, u) => sum + u.usdEstimate, 0) })); return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Enrichment timed out");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
