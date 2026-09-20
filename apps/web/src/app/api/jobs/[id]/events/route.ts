import { requireSession } from "@/lib/auth";
import { handler } from "@/lib/api";
import { asc, db, eq, gt, and, jobEvents, jobs } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** Server-Sent Events: tails job_events for one job and closes when the job is terminal. */
export const GET = handler(async (req, ctx: Ctx) => {
  await requireSession();
  const { id } = await ctx.params;
  const encoder = new TextEncoder();
  let lastId = Number(new URL(req.url).searchParams.get("after") ?? 0);
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = async () => {
        const job = (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0];
        if (!job) {
          send("error", { error: "job not found" });
          controller.close();
          return true;
        }
        const rows = await db.select().from(jobEvents).where(and(eq(jobEvents.jobId, id), gt(jobEvents.id, lastId))).orderBy(asc(jobEvents.id)).limit(200);
        for (const r of rows) {
          lastId = r.id;
          send("event", r);
        }
        send("status", { status: job.status, progressPct: job.progressPct, currentStep: job.currentStep, attempts: job.attempts, error: job.error, result: job.result });
        if (["completed", "failed", "cancelled"].includes(job.status)) {
          controller.close();
          return true;
        }
        return false;
      };
      req.signal.addEventListener("abort", () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      while (!closed) {
        if (await tick()) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
});
