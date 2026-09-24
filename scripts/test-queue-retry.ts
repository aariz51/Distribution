import { randomUUID } from "node:crypto";
import { closeDb, getDb, jobs, eq } from "@distribution/db";
import { PipelineError } from "@distribution/core";
import { JobQueue } from "@distribution/jobs";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable distribution_qa_ database");
  const db = getDb();
  const queue = await JobQueue.start(db);
  queue.register("brand.palette", async ctx => {
    if (ctx.attempt === 1) throw new PipelineError("transient processing failure", { retrySafe: true });
    return { recovered: true };
  });
  try {
    await queue.work(["light"]);
    const { jobId } = await queue.enqueue("brand.palette", { productId: randomUUID(), assetIds: [randomUUID()] }, { maxAttempts: 2 });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const row = (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0]!;
      if (row.status === "completed") {
        if (row.error !== null) throw new Error("successful retry still exposes the previous failure");
        if (row.attempts !== 2 || row.result?.recovered !== true) throw new Error("retry did not execute the handler successfully");
        console.log("PASS: retry succeeds and clears the current error; event history remains available");
        return;
      }
      if (row.status === "failed") throw new Error("retry unexpectedly failed");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("retry did not complete within 60 seconds");
  } finally {
    await queue.stop();
    await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
