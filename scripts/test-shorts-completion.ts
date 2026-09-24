import { closeDb, eq, getDb, projects } from "@distribution/db";
import { reconcileShortsProject } from "../packages/pipelines/src/shorts/completion";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const projectId = process.argv[2]!;
  const expected = process.argv[3];
  const db = getDb();
  try {
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
    await db.update(projects).set({ status: "running" }).where(eq(projects.id, projectId));
    await reconcileShortsProject(db, project.productId, projectId);
    const after = (await db.select().from(projects).where(eq(projects.id, projectId)))[0]!;
    if (after.status !== expected) throw new Error(`Expected ${expected}, got ${after.status}`);
    console.log(`PASS: real deliverable reconciliation reports ${expected}`);
  } finally { await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
