import { eq, jobEvents, jobs, sql, type Db } from "@distribution/db";
import { redact } from "@distribution/core";

export type EventLevel = "debug" | "info" | "warn" | "error";

export interface ProgressWriter {
  progress(pct: number, step: string, message?: string, data?: Record<string, unknown>): Promise<void>;
  event(level: EventLevel, message: string, data?: Record<string, unknown>, step?: string): Promise<void>;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Writes `job_events` rows and mirrors the latest step/pct onto the job row.
 *  Cheap enough to call on every ffmpeg progress tick; the writer coalesces
 *  progress updates closer than 1 % and 750 ms apart. */
export function createProgressWriter(db: Db, jobId: string): ProgressWriter {
  let lastPct = -1;
  let lastAt = 0;
  return {
    async progress(pct, step, message, data) {
      const p = clampPct(pct);
      const now = Date.now();
      if (p === lastPct && now - lastAt < 750 && !message) return;
      if (Math.abs(p - lastPct) < 1 && now - lastAt < 750 && !message) return;
      lastPct = p;
      lastAt = now;
      await db.transaction(async (tx) => {
        await tx
          .update(jobs)
          .set({ progressPct: p, currentStep: step, status: "progress", updatedAt: sql`now()` })
          .where(eq(jobs.id, jobId));
        await tx.insert(jobEvents).values({
          jobId,
          level: "info",
          step,
          pct: p,
          message: redact(message ?? `${step} → ${p}%`),
          data: data ?? null,
        });
      });
    },
    async event(level, message, data, step) {
      await db.insert(jobEvents).values({ jobId, level, step: step ?? null, pct: null, message: redact(message), data: data ?? null });
    },
  };
}
