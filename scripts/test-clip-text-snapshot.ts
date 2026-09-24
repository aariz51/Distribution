import "dotenv/config";
import { randomUUID } from "node:crypto";
import { assets, candidates, closeDb, eq, getDb, jobs, projects, products } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { registerPipelines } from "@distribution/pipelines";
import { getStorage } from "@distribution/storage";
import { bin, run } from "@distribution/media";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  const old = (await db.select().from(candidates).where(eq(candidates.id, "981aae91-a73d-438a-b75b-e71aecfb212b")))[0]!;
  const project = (await db.select().from(projects).where(eq(projects.id, old.projectId)))[0]!;
  const product = (await db.select().from(products).where(eq(products.id, project.productId)))[0]!;
  if (product.contentPreferences.voice !== "none") throw new Error("Silent outro required for this bounded test");
  const projectId = randomUUID(), candidateId = randomUUID();
  await db.insert(projects).values({ ...project, id: projectId, status: "running" });
  await db.insert(candidates).values({ ...old, id: candidateId, projectId, endSec: old.startSec + 8, selected: true });
  const queue = await JobQueue.start(db); registerPipelines(queue);
  process.env.WORKER_MEDIA_CONCURRENCY = "1"; process.env.WORKER_LLM_CONCURRENCY = "1";
  try {
    await queue.work(["media", "llm"]);
    await queue.enqueue("shorts.cut", { productId: project.productId, projectId, candidateId }, { productId: project.productId, projectId, maxAttempts: 1 });
    console.log(JSON.stringify({ projectId, candidateId }));
    const deadline = Date.now() + 600000; let previous = "";
    while (Date.now() < deadline) {
      const rows = await db.select().from(jobs).where(eq(jobs.projectId, projectId));
      const state = rows.map(j => `${j.type}:${j.status}`).join(" "); if (state !== previous) { console.log(state); previous = state; }
      const failed = rows.find(j => j.status === "failed"); if (failed) throw new Error(JSON.stringify(failed.error));
      if (rows.length > 1 && rows.every(j => j.status === "completed")) {
        const clip = (await db.select().from(assets).where(eq(assets.candidateId, candidateId))).find(a => a.type === "clip")!;
        const snapshot = clip.metadata.textSnapshot as { version: number; titleOverlayKey: string; titleBandPixels: number; captionPreset: string };
        if (snapshot.version !== 1 || !snapshot.titleOverlayKey || !snapshot.captionPreset || !Number.isInteger(snapshot.titleBandPixels)) throw new Error("Incomplete persisted text snapshot");
        const png = await getStorage().localPathFor(snapshot.titleOverlayKey);
        await run(bin("ffmpeg"), ["-v", "error", "-i", png, "-f", "null", "-"], { timeoutMs: 30000 });
        await run(bin("ffmpeg"), ["-v", "error", "-i", await getStorage().localPathFor(clip.storageKey), "-f", "null", "-"], { timeoutMs: 60000 });
        console.log(JSON.stringify({ pass: true, clipId: clip.id, snapshot })); return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error("Timed out");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
