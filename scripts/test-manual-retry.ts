import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const queue = await JobQueue.start(db);
  const id = randomUUID();
  const payload = { productId: randomUUID(), assetIds: [randomUUID()] };
  await db.insert(jobs).values({ id, type: "brand.palette", status: "failed", payload, error: { message: "QA retry fixture" } });
  try {
    const result = await Promise.all(Array.from({ length: 8 }, () => queue.retry(id)));
    if (new Set(result.map(j => j.jobId)).size !== 1 || result.filter(j => !j.deduplicated).length !== 1) throw new Error("duplicate manual retries");
    const parent = (await db.select().from(jobs).where(eq(jobs.id, id)))[0]!;
    const child = (await db.select().from(jobs).where(eq(jobs.id, result[0]!.jobId)))[0]!;
    if (parent.result?.retryJobId !== child.id || child.status !== "queued" || !child.pgbossId || JSON.stringify(child.payload) !== JSON.stringify(parent.payload)) throw new Error("retry linkage or payload corrupted");
    await queue.cancel(child.id);
    let rejected = false;
    try { await queue.retry(child.id); } catch { rejected = true; }
    if (!rejected) throw new Error("cancelled job incorrectly accepted as failed retry");
    console.log("PASS: eight manual retries produce one linked job; original failure and payload preserved; non-failed retry rejected");
  } finally { await queue.stop(); await closeDb(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
