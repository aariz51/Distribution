import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeDb, eq, getDb, jobs, projects, sourceVideos, sql } from "@distribution/db";
import { startRun, startImportedSource } from "../apps/web/src/lib/runs";
import { getQueue } from "../apps/web/src/lib/queue";
async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use disposable QA database");
  const db = getDb(); const queue = await getQueue();
  const productId = "3fe71fcc-3101-432d-a1ec-583d785592a4", sourceId = randomUUID();
  const original = (await db.select().from(sourceVideos).where(eq(sourceVideos.productId, productId)))[0]!;
  await db.insert(sourceVideos).values({ ...original, id: sourceId, status: "failed" });
  try {
    await db.execute(sql.raw(`create or replace function qa_reject_start() returns trigger language plpgsql as $$ begin if new.source_id = '${sourceId}'::uuid and new.pgboss_id is not null then raise exception 'QA enqueue failure'; end if; return new; end $$`));
    await db.execute(sql.raw("create trigger qa_reject_start before update on jobs for each row execute function qa_reject_start()"));
    let rejected = false;
    try { await startRun(productId, sourceId); } catch { rejected = true; }
    const source = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)))[0]!;
    const attempts = await db.select().from(projects).where(eq(projects.sourceId, sourceId));
    if (!rejected || attempts.length || source.status !== "failed") throw new Error("Failed start left a phantom project/source state");
    const retained = await startImportedSource(productId, sourceId);
    if (retained.processing.status !== "failed" || !("error" in retained.processing)) throw new Error("Import did not return recoverable processing failure");
    const saved = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)))[0]!;
    if (saved.storageKey !== original.storageKey || !saved.failureReason) throw new Error("Imported source lost during queue failure");
    await db.execute(sql.raw(`create or replace function qa_reject_import_diagnostic() returns trigger language plpgsql as $$ begin if new.id = '${sourceId}'::uuid and new.failure_reason is not null then raise exception 'QA diagnostic failure'; end if; return new; end $$`));
    await db.execute(sql.raw("create trigger qa_reject_import_diagnostic before update on source_videos for each row execute function qa_reject_import_diagnostic()"));
    const diagnosticFailed = await startImportedSource(productId, sourceId);
    if (diagnosticFailed.processing.status !== "failed") throw new Error("Diagnostic failure hid the retained source response");
    await db.execute(sql.raw("drop trigger qa_reject_import_diagnostic on source_videos"));
    await db.execute(sql.raw("drop trigger qa_reject_start on jobs"));
    const started = await startRun(productId, sourceId);
    let duplicateRejected = false;
    try { await startRun(productId, sourceId); } catch { duplicateRejected = true; }
    if (!duplicateRejected) throw new Error("Active source submitted twice");
    await queue.cancel(started.jobId);
    const retried = await startRun(productId, sourceId);
    if (retried.jobId === started.jobId) throw new Error("Cancelled ingest was not restartable");
    await queue.cancel(retried.jobId);
    const rows = await db.select().from(jobs).where(eq(jobs.sourceId, sourceId));
    if (rows.length !== 2) throw new Error("Unexpected orphan/duplicate jobs");
    console.log("PASS: actual startRun rolls back failed enqueue, rejects active duplicate, restarts after cancellation despite stale source label");
  } finally {
    await db.execute(sql.raw("drop trigger if exists qa_reject_import_diagnostic on source_videos"));
    await db.execute(sql.raw("drop function if exists qa_reject_import_diagnostic()"));
    await db.execute(sql.raw("drop trigger if exists qa_reject_start on jobs"));
    await db.execute(sql.raw("drop function if exists qa_reject_start()"));
    await queue.stop(); await closeDb();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
