import "dotenv/config";
import { assets, closeDb, eq, getDb, jobs } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { registerPromo } from "@distribution/pipelines";
import { getStorage } from "@distribution/storage";
import { bin, probeMedia, run } from "@distribution/media";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const projectId = "2f8461d4-a346-44c2-906e-44b7019a1114";
  const files = await db.select().from(assets).where(eq(assets.projectId, projectId));
  const parent = files.find(a => a.type === "promo_vertical")!;
  const original = parent;
  process.env.WORKER_MEDIA_CONCURRENCY = "1";
  process.env.WORKER_RENDER_CONCURRENCY = "1";
  process.env.REMOTION_CONCURRENCY = "1";
  const queue = await JobQueue.start(db);
  registerPromo(queue);
  try {
    await queue.work(["render", "media"]);
    const { jobId } = await queue.enqueue("promo.render", { productId: parent.productId, projectId, composition: "PromoVertical" }, { productId: parent.productId, projectId, maxAttempts: 1 });
    const deadline = Date.now() + 5 * 60_000;
    let previous = "";
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      const state = `${job.status}:${job.currentStep}`;
      if (state !== previous) { console.log(state); previous = state; }
      if (job.status === "failed") throw new Error(JSON.stringify(job.error));
      if (job.status === "completed") {
        const outputs = (await db.select().from(assets).where(eq(assets.projectId, projectId))).filter(a => a.type === "promo_vertical");
        if (outputs.length !== 1 || outputs[0]!.id !== original.id || job.result?.assetId !== original.id) throw new Error("retry duplicated or changed output identity");
        const result = outputs[0]!;

        const file = await getStorage().localPathFor(result.storageKey);
        const probe = await probeMedia(file);
        if (!probe.hasAudio || !probe.hasVideo || Math.abs(probe.durationSec - parent.durationSec!) > 0.1) throw new Error("invalid enriched output");
        await run(bin("ffmpeg"), ["-v", "error", "-i", file, "-f", "null", "-"], { timeoutMs: 120_000 });
        console.log("PASS: staged SafeChoice promo rerender produces valid media and preserves output ID without duplicates");
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error("promo retry timed out");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
