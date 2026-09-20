import { PgBoss, type Job, type JobWithMetadata } from "pg-boss";
import { and, databaseUrl, eq, jobs, sql, usageLedger, type Db } from "@distribution/db";
import { isRetrySafe, logger, newId, PipelineError, redact, type Logger } from "@distribution/core";
import {
  DEAD_LETTER_QUEUE,
  JOB_TYPES,
  QUEUE_POLICY,
  QueueName,
  parsePayload,
  queueFor,
  type JobEnvelope,
  type JobPayload,
  type JobTypeName,
} from "./registry.js";
import { createProgressWriter, type ProgressWriter } from "./progress.js";

export interface EnqueueOptions {
  productId?: string;
  projectId?: string;
  assetId?: string;
  sourceId?: string;
  priority?: number;
  /** Same key while a job is queued/active → the second enqueue is a no-op (idempotency). */
  singletonKey?: string;
  startAfter?: Date;
  maxAttempts?: number;
}

export interface UsageRecord {
  provider: string;
  model?: string;
  kind: "chat" | "stt" | "tts" | "render" | "download" | "storage";
  purpose?: string;
  inputTokens?: number;
  outputTokens?: number;
  seconds?: number;
  bytes?: number;
  usdEstimate?: number;
  accountId: string;
  productId?: string;
}

export interface JobContext<T extends JobTypeName> extends ProgressWriter {
  jobId: string;
  type: T;
  payload: JobPayload<T>;
  attempt: number;
  maxAttempts: number;
  db: Db;
  log: Logger;
  signal: AbortSignal;
  queue: JobQueue;
  recordUsage(u: UsageRecord): Promise<void>;
}

export type JobHandler<T extends JobTypeName> = (ctx: JobContext<T>) => Promise<Record<string, unknown> | void>;

type AnyHandler = (ctx: JobContext<JobTypeName>) => Promise<Record<string, unknown> | void>;

export class JobQueue {
  private handlers = new Map<JobTypeName, AnyHandler>();
  private workerIds: string[] = [];

  private constructor(
    readonly boss: PgBoss,
    readonly db: Db,
  ) {}

  static async start(db: Db, opts: { connectionString?: string } = {}): Promise<JobQueue> {
    const boss = new PgBoss({
      connectionString: opts.connectionString ?? databaseUrl(),
      schema: process.env.PGBOSS_SCHEMA ?? "pgboss",
      max: Number(process.env.PGBOSS_POOL_MAX ?? 5),
    });
    boss.on("error", (err) => logger.error({ err: redact(String(err)) }, "pg-boss error"));
    await boss.start();
    await boss.createQueue(DEAD_LETTER_QUEUE, { retryLimit: 0, retentionSeconds: 30 * 24 * 3600 });
    for (const q of QueueName.options) {
      const p = QUEUE_POLICY[q];
      await boss.createQueue(q, {
        retryLimit: p.retryLimit,
        retryDelay: p.retryDelay,
        retryBackoff: p.retryBackoff,
        expireInSeconds: p.expireInSeconds,
        deadLetter: DEAD_LETTER_QUEUE,
        retentionSeconds: 14 * 24 * 3600,
      });
    }
    return new JobQueue(boss, db);
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, close: true, timeout: 30_000 });
  }

  /** Insert the app job row and hand pg-boss an envelope with the same id. */
  async enqueue<T extends JobTypeName>(type: T, payload: JobPayload<T>, opts: EnqueueOptions = {}): Promise<{ jobId: string; deduplicated: boolean }> {
    const parsed = parsePayload(type, payload);
    const queue = queueFor(type);
    const policy = QUEUE_POLICY[queue];
    const jobId = newId();
    const maxAttempts = opts.maxAttempts ?? policy.retryLimit + 1;

    if (opts.singletonKey) {
      const existing = await this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.singletonKey, opts.singletonKey), sql`${jobs.status} in ('queued','started','progress','retrying')`))
        .limit(1);
      if (existing[0]) return { jobId: existing[0].id, deduplicated: true };
    }

    await this.db.insert(jobs).values({
      id: jobId,
      type,
      productId: opts.productId ?? null,
      projectId: opts.projectId ?? null,
      assetId: opts.assetId ?? null,
      sourceId: opts.sourceId ?? null,
      status: "queued",
      priority: opts.priority ?? 0,
      maxAttempts,
      payload: parsed as Record<string, unknown>,
      singletonKey: opts.singletonKey ?? null,
    });

    const envelope: JobEnvelope = { jobId, type };
    const bossId = await this.boss.send(queue, envelope, {
      id: jobId,
      priority: opts.priority ?? 0,
      singletonKey: opts.singletonKey,
      startAfter: opts.startAfter,
      retryLimit: maxAttempts - 1,
    });
    if (!bossId) {
      // pg-boss refused (singleton collision at its layer). Mark ours cancelled.
      await this.db.update(jobs).set({ status: "cancelled", error: { message: "duplicate singleton" } }).where(eq(jobs.id, jobId));
      return { jobId, deduplicated: true };
    }
    await this.db.update(jobs).set({ pgbossId: bossId }).where(eq(jobs.id, jobId));
    return { jobId, deduplicated: false };
  }

  async cancel(jobId: string): Promise<void> {
    const row = await this.db.select({ type: jobs.type }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    const type = row[0]?.type as JobTypeName | undefined;
    if (!type) return;
    await this.boss.cancel(queueFor(type), jobId);
    await this.db.update(jobs).set({ status: "cancelled", completedAt: sql`now()` }).where(eq(jobs.id, jobId));
  }

  register<T extends JobTypeName>(type: T, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as unknown as AnyHandler);
  }

  /** Start one poller per queue with the configured local concurrency. */
  async work(queues: QueueName[] = QueueName.options): Promise<void> {
    for (const q of queues) {
      const policy = QUEUE_POLICY[q];
      const concurrency = Number(process.env[policy.concurrencyEnv] ?? policy.defaultConcurrency);
      const id = await this.boss.work(
        q,
        { batchSize: 1, localConcurrency: concurrency, includeMetadata: true, pollingIntervalSeconds: 2 } as const,
        async (batch: JobWithMetadata<JobEnvelope>[]) => {
          for (const job of batch) await this.execute(q, job);
        },
      );
      this.workerIds.push(id);
      logger.info({ queue: q, concurrency }, "worker polling");
    }
  }

  private async execute(queue: QueueName, job: JobWithMetadata<JobEnvelope>): Promise<void> {
    const { jobId, type } = job.data;
    const handler = this.handlers.get(type);
    const attempt = (job.retryCount ?? 0) + 1;
    const log = logger.child({ jobId, jobType: type, queue, attempt });
    const row = (await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1))[0];
    if (!row) {
      log.warn("job row missing; completing pg-boss job");
      return;
    }
    if (row.status === "cancelled") {
      log.info("job cancelled before start");
      return;
    }
    if (!handler) {
      await this.finishFailed(jobId, new PipelineError(`no handler registered for ${type}`), attempt, false);
      return;
    }
    await this.db
      .update(jobs)
      .set({ status: "started", attempts: attempt, startedAt: row.startedAt ?? sql`now()`, currentStep: "start", updatedAt: sql`now()` })
      .where(eq(jobs.id, jobId));
    const writer = createProgressWriter(this.db, jobId);
    await writer.event("info", attempt > 1 ? `retry ${attempt}/${row.maxAttempts}` : "started", undefined, "start");

    const ctx: JobContext<JobTypeName> = {
      jobId,
      type,
      payload: parsePayload(type, row.payload),
      attempt,
      maxAttempts: row.maxAttempts,
      db: this.db,
      log,
      signal: job.signal,
      queue: this,
      ...writer,
      recordUsage: async (u) => {
        await this.db.insert(usageLedger).values({
          accountId: u.accountId,
          productId: u.productId ?? row.productId,
          jobId,
          provider: u.provider,
          model: u.model ?? null,
          kind: u.kind,
          purpose: u.purpose ?? null,
          inputTokens: u.inputTokens ?? null,
          outputTokens: u.outputTokens ?? null,
          seconds: u.seconds ?? null,
          bytes: u.bytes ?? null,
          usdEstimate: u.usdEstimate ?? 0,
        });
        await this.db
          .update(jobs)
          .set({ cost: sql`jsonb_set(coalesce(${jobs.cost}, '{}'::jsonb), '{usd_estimate}', to_jsonb(coalesce((${jobs.cost}->>'usd_estimate')::float8, 0) + ${u.usdEstimate ?? 0}))` })
          .where(eq(jobs.id, jobId));
      },
    };

    const started = Date.now();
    try {
      const result = await handler(ctx);
      await this.db
        .update(jobs)
        .set({ status: "completed", progressPct: 100, currentStep: "done", result: (result as Record<string, unknown>) ?? null, completedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(jobs.id, jobId));
      await writer.event("info", `completed in ${Math.round((Date.now() - started) / 1000)}s`, undefined, "done");
    } catch (err) {
      const retrySafe = isRetrySafe(err);
      const willRetry = retrySafe && attempt < row.maxAttempts;
      await this.finishFailed(jobId, err, attempt, willRetry);
      if (willRetry) throw err; // let pg-boss schedule the retry
      // not retry-safe (or out of attempts): swallow so pg-boss completes; our row is failed.
    }
  }

  private async finishFailed(jobId: string, err: unknown, attempt: number, willRetry: boolean): Promise<void> {
    const e = err instanceof Error ? err : new Error(String(err));
    const pe = err instanceof PipelineError ? err : undefined;
    const errorJson = {
      message: redact(e.message),
      name: e.name,
      step: pe?.step ?? null,
      retrySafe: pe?.retrySafe ?? false,
      details: pe?.details ?? null,
      stack: process.env.NODE_ENV === "production" ? undefined : redact(e.stack ?? ""),
    };
    await this.db
      .update(jobs)
      .set({
        status: willRetry ? "retrying" : "failed",
        error: errorJson,
        attempts: attempt,
        completedAt: willRetry ? null : sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(jobs.id, jobId));
    const writer = createProgressWriter(this.db, jobId);
    await writer.event("error", willRetry ? `failed, will retry: ${e.message}` : `failed: ${e.message}`, { step: pe?.step, retrySafe: pe?.retrySafe, details: pe?.details }, pe?.step);
  }
}

/** Convenience for code that only enqueues (the web app). */
export async function enqueueOnly(db: Db): Promise<JobQueue> {
  return JobQueue.start(db);
}

export { JOB_TYPES };
export type { Job };
