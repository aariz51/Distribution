import "./_env.js";
import { closeDb, eq, getDb, jobEvents, jobs, asc } from "@distribution/db";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("usage: job-status.ts <jobId>");
  const db = getDb();
  const job = (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0];
  const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, id)).orderBy(asc(jobEvents.id));
  console.log(JSON.stringify({ status: job?.status, progress: job?.progressPct, step: job?.currentStep, attempts: job?.attempts, error: job?.error, result: job?.result }, null, 2));
  for (const e of events) console.log(`${e.at.toISOString()} [${e.level}] ${e.step ?? "-"} ${e.pct ?? ""} ${e.message}`);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
