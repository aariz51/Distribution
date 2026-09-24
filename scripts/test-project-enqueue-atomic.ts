import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs, projects, sourceVideos, sql } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use disposable QA database");
  const db = getDb(); const queue = await JobQueue.start(db);
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4";
  const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId)))[0]!;
  try {
    for (const fail of [true, false]) {
      const projectId = randomUUID(); let jobId = "";
      let rejected = false;
      try {
        await db.transaction(async tx => {
          await tx.insert(projects).values({ id: projectId, productId, sourceId: source.id, kind: "shorts", profileVersion: 1, status: "running" });
          await tx.update(sourceVideos).set({ status: "queued" }).where(eq(sourceVideos.id, source.id));
          const job = await queue.enqueueInTransaction(tx, "source.ingest", { productId, sourceId: source.id, projectId }, { productId, sourceId: source.id, projectId, singletonKey: `qa-project:${projectId}` });
          jobId = job.jobId;
          if (fail) throw new Error("injected failure after transport creation");
        });
      } catch (error) { if (!fail) throw error; rejected = true; }
      const project = await db.select().from(projects).where(eq(projects.id, projectId));
      const app = await db.select().from(jobs).where(eq(jobs.id, jobId));
      const transport = await db.execute(sql`select id from pgboss.job where id = ${jobId}::uuid`);
      const src = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, source.id)))[0]!;
      if (fail) {
        if (!rejected || project.length || app.length || transport.rows.length || src.status !== source.status) throw new Error("outer rollback left project/source/job effects");
      } else {
        if (project.length !== 1 || app.length !== 1 || transport.rows.length !== 1 || src.status !== "queued") throw new Error("atomic commit omitted required state");
        await queue.cancel(jobId);
      }
    }
    console.log("PASS: project, source state, app job and pg-boss message commit or roll back together");
  } finally {
    await db.update(sourceVideos).set({ status: source.status }).where(eq(sourceVideos.id, source.id));
    await queue.stop(); await closeDb();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
