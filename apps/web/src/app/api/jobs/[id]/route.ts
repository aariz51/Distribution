import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { asc, db, eq, jobEvents, jobs } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req, ctx: Ctx) => {
  await requireSession();
  const { id } = await ctx.params;
  const job = (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0];
  if (!job) throw new NotFound("job");
  const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, id)).orderBy(asc(jobEvents.id)).limit(500);
  return json({ job, events });
});
