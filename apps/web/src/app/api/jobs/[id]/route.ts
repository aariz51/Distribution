import { z } from "zod";
import { ValidationError } from "@distribution/core";
import { getQueue } from "@/lib/queue";
const Action = z.object({ action: z.enum(["cancel", "retry"]) });
import { getOwnedJob } from "@/lib/jobs";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { asc, db, eq, jobEvents } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const job = await getOwnedJob(session.accountId, id);
  const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, id)).orderBy(asc(jobEvents.id)).limit(500);
  return json({ job, events });
});

export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const job = await getOwnedJob(session.accountId, id);
  const { action } = Action.parse(await req.json());
  if (!/^(promo|shorts|source|copy|brand)\./.test(job.type)) throw new ValidationError("Use the publishing workflow to manage this job.");
  const queue = await getQueue();
  if (action === "cancel") {
    if (["completed", "failed", "cancelled"].includes(job.status)) throw new ValidationError("This job has already stopped.");
    await queue.cancel(id);
    return json({ jobId: id, status: "cancelled" });
  }
  if (job.status !== "failed") throw new ValidationError("Only failed jobs can be retried.");
  return json(await queue.retry(id), { status: 202 });
});
