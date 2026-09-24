import { getOwnedJob } from "@/lib/jobs";
import { requireSession } from "@/lib/auth";
import { handler } from "@/lib/api";
import { asc, db, eq, gt, and, jobEvents, jobs } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** Server-Sent Events: tails job_events for one job and closes when the job is terminal. */
export const GET = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await getOwnedJob(session.accountId, id);
  const encoder = new TextEncoder();
  let lastId = Number(new URL(req.url).searchParams.get("after") ?? req.headers.get("last-event-id") ?? 0);
  if (!Number.isSafeInteger(lastId) || lastId < 0) lastId = 0;
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, eventId?: number) => !closed && controller.enqueue(encoder.encode(`${eventId == null ? "" : `id: ${eventId}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = async () => {
        const job = (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0];
        if (closed) return true;
        if (!job) {
          send("error", { error: "job not found" });
          controller.close();
          return true;
        }
        const rows = await db.select().from(jobEvents).where(and(eq(jobEvents.jobId, id), gt(jobEvents.id, lastId))).orderBy(asc(jobEvents.id)).limit(200);
        if (closed) return true;
        for (const r of rows) {
          lastId = r.id;
          send("event", r, r.id);
        }
        if (rows.length < 200) send("status", { status: job.status, progressPct: job.progressPct, currentStep: job.currentStep, attempts: job.attempts, error: job.error, result: job.result });
        if (rows.length < 200 && ["completed", "failed", "cancelled"].includes(job.status)) {
          controller.close();
          return true;
        }
        return false;
      };
      const onAbort = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (req.signal.aborted) onAbort();
        while (!closed) {
          if (await tick()) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        closed = true;
        req.signal.removeEventListener("abort", onAbort);
      }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
});
