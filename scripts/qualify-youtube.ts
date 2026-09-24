/** Real QA source qualification; never substitutes synthetic content or claims an uncertain pass. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getDb, closeDb, eq, jobs, sourceVideos } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { sourceProbe } from "../packages/pipelines/src/shorts/probe";
import { sourceIngest } from "../packages/pipelines/src/shorts/ingest";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const url = process.argv[2]; if (!url) throw new Error("Supply YouTube URL");
  const db = getDb(), queue = await JobQueue.start(db);
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4", sourceId = randomUUID();
  try {
    await db.insert(sourceVideos).values({ id: sourceId, productId, kind: "youtube", url, rights: "unknown", status: "discovered" });
    queue.register("source.probe", sourceProbe); queue.register("source.ingest", sourceIngest);
    await queue.enqueue("source.probe", { productId, sourceId, qualificationBatch: randomUUID() }, { productId, sourceId, maxAttempts: 1 });
    await queue.work(["light", "media"]);
    console.log(JSON.stringify({ productId, sourceId, url }));
    let last = "";
    const deadline = Date.now() + 14 * 3600000;
    while (Date.now() < deadline) {
      const work = await db.select().from(jobs).where(eq(jobs.sourceId, sourceId));
      const state = work.map(j => `${j.type}:${j.status}:${j.currentStep}:${j.progressPct}`).join(" ");
      if (state !== last) { console.log(state); last = state; }
      if (work.length && work.every(j => ["failed", "completed", "cancelled"].includes(j.status))) {
        const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)))[0]!;
        const evidence = { source, jobs: work.map(j => ({ id: j.id, type: j.type, status: j.status, result: j.result, error: j.error })) };
        await writeFile(fileURLToPath(new URL(`../storage/tmp/youtube-qualification-${sourceId}.json`, import.meta.url)), JSON.stringify(evidence, null, 2));
        console.log(JSON.stringify({ sourceId, rights: source.rights, status: source.status, screening: (source.probe?.screening as { status?: string })?.status, failureReason: source.failureReason }));
        return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error("Qualification exceeded bounded runtime");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
