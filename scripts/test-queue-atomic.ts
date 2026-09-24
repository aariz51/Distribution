import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs, sql } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use a disposable QA database");
  const db = getDb();
  const queue = await JobQueue.start(db);
  const singletonKey = `qa-concurrent-${randomUUID()}`;
  const payload = { productId: randomUUID(), assetIds: [randomUUID()] };
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => queue.enqueue("brand.palette", payload, { singletonKey })));
    if (new Set(results.map(r => r.jobId)).size !== 1 || results.filter(r => !r.deduplicated).length !== 1) throw new Error("singleton race created multiple identities");
    const rows = await db.select().from(jobs).where(eq(jobs.singletonKey, singletonKey));
    if (rows.length !== 1 || !rows[0]!.pgbossId) throw new Error("singleton race orphaned an app job");
    await queue.cancel(results[0]!.jobId);
    console.log("PASS: eight concurrent submissions share one app/queue identity");
    await db.execute(sql.raw(`create or replace function qa_reject_queue_link() returns trigger language plpgsql as $$ begin if new.singleton_key like 'qa-rollback-%' and new.pgboss_id is not null then raise exception 'QA forced rollback after transport insertion'; end if; return new; end $$`));
    await db.execute(sql.raw(`create trigger qa_reject_queue_link before update on jobs for each row execute function qa_reject_queue_link()`));
    const rollbackKey = `qa-rollback-${randomUUID()}`;
    let rejected = false;
    try { await queue.enqueue("brand.palette", payload, { singletonKey: rollbackKey }); } catch { rejected = true; }
    if (!rejected) throw new Error("rollback fault did not fire");
    const appRows = await db.select().from(jobs).where(eq(jobs.singletonKey, rollbackKey));
    const transport = await db.execute(sql`select id from pgboss.job where singleton_key = ${rollbackKey}`);
    if (appRows.length || transport.rows.length) throw new Error("failed handoff left an app or queue record behind");
    console.log("PASS: a failure after transport insertion rolls back both app and queue records");
  } finally {
    await db.execute(sql.raw("drop trigger if exists qa_reject_queue_link on jobs"));
    await db.execute(sql.raw("drop function if exists qa_reject_queue_link()"));
    await queue.stop(); await closeDb();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
