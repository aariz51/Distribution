import { candidates, closeDb, eq, getDb, jobs, projects, usageLedger } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { shortsRank } from "@distribution/pipelines";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const projectId = "5b433aab-0520-4980-9aed-1e1a2343fa24";
  const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
  const before = await db.select().from(candidates).where(eq(candidates.projectId, projectId));
  const oldJobs = new Set((await db.select().from(jobs).where(eq(jobs.projectId, projectId))).map(j => j.id));
  const costBefore = await db.select().from(usageLedger).where(eq(usageLedger.productId, project.productId));
  const queue = await JobQueue.start(db);
  queue.register("shorts.rank", shortsRank);
  try {
    await queue.work(["llm"]);
    const { jobId } = await queue.enqueue("shorts.rank", { productId: project.productId, projectId, transcriptId: before[0]!.transcriptId }, { productId: project.productId, projectId });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const job = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      if (job.status === "failed") throw new Error(JSON.stringify(job.error));
      if (job.status === "completed") {
        const after = await db.select().from(candidates).where(eq(candidates.projectId, projectId));
        const identity = (rows: typeof before) => rows.map(c => c.id).sort().join(",");
        const costAfter = await db.select().from(usageLedger).where(eq(usageLedger.productId, project.productId));
        if (identity(before) !== identity(after) || costBefore.length !== costAfter.length || job.result?.reused !== true) throw new Error("ranking retry replaced candidates or called a provider");
        console.log("PASS: real ranking retry preserves candidate IDs and uses no provider credits");
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error("ranking retry timed out");
  } finally {
    for (const j of await db.select().from(jobs).where(eq(jobs.projectId, projectId))) if (!oldJobs.has(j.id) && j.type === "shorts.cut" && j.status === "queued") await queue.cancel(j.id);
    await queue.stop(); await closeDb();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
