import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs, projects } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4", projectId = randomUUID();
  await db.insert(projects).values({ id: projectId, productId, kind: "shorts", profileVersion: 1, status: "running" });
  const queue = await JobQueue.start(db);
  queue.register("brand.palette", async () => { throw new Error("QA processing failure"); });
  async function check(expected: string) {
    const p = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
    if (p.status !== expected) throw new Error(`Expected project ${expected}, got ${p.status}`);
  }
  try {
    await queue.work(["light"]);
    const { jobId } = await queue.enqueue("brand.palette", { productId, assetIds: [randomUUID()] }, { projectId, productId, maxAttempts: 1 });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const j = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      if (j.status === "failed") break;
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 200));
    await check("failed");
    const child = await queue.retry(jobId);
    await check("running");
    await queue.cancel(child.jobId);
    await check("cancelled");
    console.log("PASS: terminal processing failure, manual retry and cancellation update the project status");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
