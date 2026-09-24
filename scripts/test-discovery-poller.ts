import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs, products, sql } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { enqueueConnectedSourceChecks } from "../apps/worker/src/connected-source-poller";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), id = randomUUID();
  try {
    const base = (await db.select().from(products).limit(1))[0]!;
    await db.insert(products).values({ ...base, id, slug: `poller-${id}`, sources: { connected: [{ kind: "youtube_channel", url: "https://www.youtube.com/@BBC", rights: "owned", autoQueue: false }] } });
    await Promise.all([enqueueConnectedSourceChecks(db, queue), enqueueConnectedSourceChecks(db, queue)]);
    let saved = await db.select().from(jobs).where(eq(jobs.productId, id));
    if (saved.length !== 1 || saved[0]!.type !== "source.discover") throw new Error("Concurrent pollers duplicated or lost discovery");
    await queue.cancel(saved[0]!.id);
    await enqueueConnectedSourceChecks(db, queue);
    if ((await db.select().from(jobs).where(eq(jobs.productId, id))).length !== 1) throw new Error("Daily cooldown did not survive a new scheduler call");
    await db.update(jobs).set({ createdAt: sql`now() - interval '25 hours'` }).where(eq(jobs.id, saved[0]!.id));
    await enqueueConnectedSourceChecks(db, queue);
    saved = await db.select().from(jobs).where(eq(jobs.productId, id));
    if (saved.length !== 2) throw new Error("Next daily scan not scheduled");
    for (const job of saved) await queue.cancel(job.id);
    console.log("PASS: two scheduler instances queue one scan, persisted 24-hour cooldown prevents repeats, next-day check queues; jobs cancelled before network or media work");
  } finally {
    await db.update(products).set({ sources: { connected: [] } }).where(eq(products.id, id));
    await queue.stop(); await closeDb();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
