import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, getDb, sql } from "@distribution/db";
import { executionSecondsFor, JobQueue, SOURCE_SCREENING_TIMEOUT_SECONDS } from "@distribution/jobs";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db);
  const ids: string[] = [];
  try {
    const sourceId = randomUUID();
    const pending = await queue.enqueue("source.ingest", { productId: "3fe71fcc-3101-432d-a1ec-583d785592a4", sourceId }); ids.push(pending.jobId);
    const rows = await db.execute(sql`select expire_seconds from pgboss.job where id = ${pending.jobId}::uuid`);
    if (Number(rows.rows[0]?.expire_seconds) !== executionSecondsFor("source.ingest") || Number(rows.rows[0]?.expire_seconds) <= SOURCE_SCREENING_TIMEOUT_SECONDS) throw new Error("Transport expires before screening can finish");
    console.log("PASS: actual pg-boss source job has14hour expiry, exceeding bounded12hour screening; queued regression cancelled without running");
  } finally { for (const id of ids) await queue.cancel(id); await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
