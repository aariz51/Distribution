import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, getDb, closeDb, jobs, sourceVideos } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { getStorage } from "@distribution/storage";
import { sourceProbe } from "../packages/pipelines/src/shorts/probe";
import { sourceIngest } from "../packages/pipelines/src/shorts/ingest";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), batch = randomUUID();
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4", ids: string[] = [];
  try {
    const key = `products/${productId}/qualification-test/${batch}/original.mp4`;
    await getStorage().putFile(key, "/Users/aarizazizrasheed/Downloads/SafeChoice-ad.mp4", { contentType: "video/mp4" });
    queue.register("source.probe", sourceProbe); queue.register("source.ingest", sourceIngest);
    for (let i = 0; i < 5; i++) {
      const id = randomUUID(); ids.push(id);
      await db.insert(sourceVideos).values({ id, productId, kind: "upload", rights: i === 4 ? "unknown" : "owned", status: "discovered", storageKey: key, title: `Real SafeChoice admission regression ${i}` });
      await queue.enqueue("source.probe", { productId, sourceId: id, qualificationBatch: batch }, { productId, sourceId: id, maxAttempts: 1 });
    }
    await queue.work(["light"]);
    const deadline = Date.now() + 45000;
    let finished = false;
    while (Date.now() < deadline) {
      const probes = (await db.select().from(jobs).where(eq(jobs.productId, productId))).filter(j => ids.includes(j.sourceId ?? "") && j.type === "source.probe");
      if (probes.some(j => j.status === "failed")) throw new Error(JSON.stringify(probes.map(j => j.error)));
      if (probes.length === 5 && probes.every(j => j.status === "completed")) { finished = true; break; }
      await new Promise(r => setTimeout(r, 200));
    }
    if (!finished) throw new Error("Metadata jobs unfinished");
    const rows = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId))).filter(s => ids.includes(s.id));
    const states = rows.map(s => (s.probe?.qualification as { state?: string })?.state);
    if (states.filter(s => s === "screening-queued").length !== 3 || states.filter(s => s === "batch-limit").length !== 1 || states.filter(s => s === "needs-rights").length !== 1) throw new Error(`Wrong admission states: ${states}`);
    const ingests = (await db.select().from(jobs).where(eq(jobs.productId, productId))).filter(j => ids.includes(j.sourceId ?? "") && j.type === "source.ingest");
    if (ingests.length !== 3 || ingests.some(j => j.payload.screenOnly !== true || j.projectId)) throw new Error("Wrong screening queue");
    for (const job of ingests.slice(1)) await queue.cancel(job.id);
    console.log("PASS: five concurrent real probes admit exactly three permitted sources, block unknown rights and explicitly defer the fourth permitted source");
    await queue.work(["media"]);
    const screenDeadline = Date.now() + 10 * 60000;
    while (Date.now() < screenDeadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, ingests[0]!.id)))[0]!;
      if (job.status === "completed") throw new Error("Illustrated source incorrectly qualified");
      if (job.status === "failed") {
        if (job.error?.step !== "screening") throw new Error(JSON.stringify(job.error));
        const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, job.sourceId!)))[0]!;
        const report = source.probe?.screening as { status?: string; contentSha256?: string };
        if (report?.status !== "uncertain" || !report.contentSha256) throw new Error("Missing real evidence");
        const descendants = (await db.select().from(jobs).where(eq(jobs.sourceId, source.id))).filter(j => !["source.probe", "source.ingest"].includes(j.type));
        if (descendants.length) throw new Error("Qualification started generation");
        console.log("PASS: actual SafeChoice content screening blocks uncertain figures; no transcription, clipping or paid generation"); return;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error("Screening unfinished");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
