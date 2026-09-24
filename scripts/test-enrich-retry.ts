import "dotenv/config";
import { assets, closeDb, eq, getDb, jobs } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { shortsEnrich } from "@distribution/pipelines";
import { getStorage } from "@distribution/storage";
import { bin, probeMedia, run } from "@distribution/media";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const projectId = "5b433aab-0520-4980-9aed-1e1a2343fa24";
  const files = await db.select().from(assets).where(eq(assets.projectId, projectId));
  const parent = files.find(a => a.type === "clip")!;
  const original = files.find(a => a.derivedFromAssetId === parent.id && a.type === "clip_enriched")!;
  process.env.WORKER_MEDIA_CONCURRENCY = "1";
  const queue = await JobQueue.start(db);
  queue.register("shorts.enrich", shortsEnrich);
  try {
    await queue.work(["media"]);
    const { jobId } = await queue.enqueue("shorts.enrich", { productId: parent.productId, projectId, assetId: parent.id, steps: ["sfx", "outro"] }, { productId: parent.productId, projectId, maxAttempts: 1 });
    const deadline = Date.now() + 5 * 60_000;
    let previous = "";
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      const state = `${job.status}:${job.currentStep}`;
      if (state !== previous) { console.log(state); previous = state; }
      if (job.status === "failed") throw new Error(JSON.stringify(job.error));
      if (job.status === "completed") {
        const outputs = (await db.select().from(assets).where(eq(assets.projectId, projectId))).filter(a => a.derivedFromAssetId === parent.id && a.type === "clip_enriched");
        if (outputs.length !== 1 || outputs[0]!.id !== original.id || job.result?.assetId !== original.id) throw new Error("retry duplicated or changed output identity");
        const result = outputs[0]!;
        if (JSON.stringify(result.metadata.steps) !== '["sfx","outro"]' || Object.keys(result.metadata.skipped as object).length) throw new Error("missing requested enrichment");
        const file = await getStorage().localPathFor(result.storageKey);
        const probe = await probeMedia(file);
        if (!probe.hasAudio || !probe.hasVideo || probe.durationSec <= parent.durationSec!) throw new Error("invalid enriched output");
        await run(bin("ffmpeg"), ["-v", "error", "-i", file, "-f", "null", "-"], { timeoutMs: 120_000 });
        console.log("PASS: strict SFX/outro rerender produces valid media and preserves output ID without duplicates");
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error("enrichment retry timed out");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
