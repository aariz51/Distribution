import { and, eq, jobEvents, jobs, sql, type Db } from "@distribution/db";
import { logger, redact } from "@distribution/core";

export type EventLevel = "debug" | "info" | "warn" | "error";

export interface ProgressWriter {
  progress(pct: number, step: string, message?: string, data?: Record<string, unknown>): Promise<void>;
  event(level: EventLevel, message: string, data?: Record<string, unknown>, step?: string): Promise<void>;
  /** True once the job row has gone: the caller should stop and cancel. */
  readonly abandoned: boolean;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Postgres foreign-key violation: the job row this event points at is gone. */
const isMissingJobRow = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23503";

/**
 * Writes `job_events` rows and mirrors the latest step/pct onto the job row.
 * Cheap enough to call on every ffmpeg tick; progress updates closer than 1 %
 * and 750 ms apart are coalesced.
 *
 * Nothing in here may throw. Progress reporting is telemetry, and telemetry that
 * can kill a render is worse than no telemetry: a user deleting a product while
 * its film renders used to take down the whole worker — one unhandled foreign-key
 * violation ended the process and every other job running in it. If the job row
 * has been deleted the writer marks itself `abandoned` so the handler can stop
 * doing expensive work for an owner who no longer exists.
 */
export function createProgressWriter(db: Db, jobId: string): ProgressWriter {
  let lastPct = -1;
  let lastAt = 0;
  let abandoned = false;

  const swallow = (err: unknown, what: string): void => {
    if (isMissingJobRow(err)) {
      if (!abandoned) logger.warn({ jobId }, "job row disappeared mid-run; abandoning progress reporting");
      abandoned = true;
      return;
    }
    logger.warn({ jobId, what, err: redact(String(err instanceof Error ? err.message : err)) }, "progress write failed");
  };

  return {
    get abandoned() {
      return abandoned;
    },
    async progress(pct, step, message, data) {
      if (abandoned) return;
      const p = clampPct(pct);
      const now = Date.now();
      if (p === lastPct && now - lastAt < 750 && !message) return;
      if (Math.abs(p - lastPct) < 1 && now - lastAt < 750 && !message) return;
      lastPct = p;
      lastAt = now;
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(jobs)
            .set({ progressPct: p, currentStep: step, status: "progress", updatedAt: sql`now()` })
            .where(and(eq(jobs.id, jobId), sql`${jobs.status} in ('started','progress')`));
          await tx.insert(jobEvents).values({
            jobId,
            level: "info",
            step,
            pct: p,
            message: redact(message ?? `${step} → ${p}%`),
            data: data ?? null,
          });
        });
      } catch (err) {
        swallow(err, "progress");
      }
    },
    async event(level, message, data, step) {
      if (abandoned) return;
      try {
        await db.insert(jobEvents).values({ jobId, level, step: step ?? null, pct: null, message: redact(message), data: data ?? null });
      } catch (err) {
        swallow(err, "event");
      }
    },
  };
}
