import { randomUUID } from "node:crypto";
import { closeDb, getDb, jobs, eq } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const queue = await JobQueue.start(db);
  let called = false;
  queue.register("brand.palette", async () => { called = true; return {}; });
  try {
    const { jobId } = await queue.enqueue("brand.palette", { productId: randomUUID(), assetIds: [randomUUID()] }, { maxAttempts: 1 });
    await db.update(jobs).set({ payload: { productId: "invalid" } }).where(eq(jobs.id, jobId));
    await queue.work(["light"]);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const row = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      if (row.status === "failed") {
        if (called || !row.error || !row.completedAt) throw new Error("Invalid payload was not handled safely");
        console.log("PASS: invalid persisted payload fails with recorded error without invoking handler");
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("Malformed job remained active");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
