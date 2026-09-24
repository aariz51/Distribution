import { assetCopy, closeDb, eq, getDb, jobs } from "@distribution/db";
import { logger } from "@distribution/core";
import { createProgressWriter, JobQueue, parsePayload } from "@distribution/jobs";
import { copyGenerate } from "@distribution/pipelines";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const row = (await db.select().from(jobs).where(eq(jobs.productId, "3fe71fcc-3101-432d-a1ec-583d785592a4"))).find(j => j.type === "copy.generate" && j.status === "completed")!;
  const payload = parsePayload("copy.generate", row.payload);
  const before = await db.select().from(assetCopy).where(eq(assetCopy.assetId, payload.assetId));
  const queue = await JobQueue.start(db);
  try {
    const result = await copyGenerate({ jobId: row.id, type: "copy.generate", payload, db, queue, log: logger, signal: new AbortController().signal, attempt: 2, maxAttempts: 3, ...createProgressWriter(db, row.id), recordUsage: async () => { throw new Error("provider called during saved copy replay"); } });
    const after = await db.select().from(assetCopy).where(eq(assetCopy.assetId, payload.assetId));
    if (!('reused' in result) || result.reused !== true || before.length !== after.length) throw new Error("copy replay added versions or failed to reuse saved outputs");
    console.log("PASS: replay reuses real saved platform copy without new versions or provider calls");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
