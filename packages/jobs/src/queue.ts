import { withProviderBudget } from "@distribution/core/provider-budget";
import { reconcileJobProject } from "./project-state";
import { fromDrizzle, PgBoss, type Job, type JobWithMetadata } from "pg-boss";
import { productBudget, and, databaseUrl, eq, jobs, sql, usageLedger, type Db } from "@distribution/db";
import { isRetrySafe, logger, newId, PipelineError, redact, type Logger } from "@distribution/core";
import {
  executionSecondsFor,
  DEAD_LETTER_QUEUE,
  JOB_TYPES,
  QUEUE_POLICY,
  QueueName,
  parsePayload,
  queueFor,
  type JobEnvelope,
  type JobPayload,
  type JobTypeName,
} from "./registry";
import { createProgressWriter, type ProgressWriter } from "./progress";

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
    const queue = new JobQueue(boss, db);
    await queue.reclaimStaleJobs();
    return queue;
  }

  /** Reconcile interrupted app rows with pg-boss, which owns execution leases.
   * Starting another web client or worker never revokes an active lease.
   * pg-boss schedules retries itself; resending an existing job ID is not recovery.
   */
  async reclaimStaleJobs(): Promise<{ requeued: number; failed: number }> {
    const rows = await this.db.select({ row: jobs, revision: sql<string>`${jobs.updatedAt}::text` }).from(jobs)
      .where(sql`${jobs.status} in ('started','progress','retrying')`);
    let requeued = 0;
    let failed = 0;
    for (const { row, revision } of rows) {
      const type = row.type as JobTypeName;
      if (!JOB_TYPES[type]) continue;
      const transport = await this.boss.getJobById(queueFor(type), row.pgbossId ?? row.id);
      if (transport?.state === "active") continue;
      const pending = transport?.state === "created" || transport?.state === "retry";
      const status = pending ? (transport.state === "retry" ? "retrying" : "queued")
        : transport?.state === "cancelled" ? "cancelled" : "failed";
      if (row.status === status) continue;
      const message = pending ? "pg-boss scheduled this job for another attempt"
        : `processing ended without a recorded result (queue state: ${transport?.state ?? "missing"})`;
      const changed = await this.db.update(jobs).set({
        status,
        ...(pending ? { currentStep: "retry", completedAt: null } : {
          error: { message, name: "InterruptedError", retrySafe: false },
          completedAt: sql`now()`,
        }),
        updatedAt: sql`now()`,
      }).where(and(eq(jobs.id, row.id), eq(jobs.status, row.status), sql`${jobs.updatedAt} = ${revision}::timestamptz`))
        .returning({ id: jobs.id });
      if (!changed.length) continue; // The worker advanced after our snapshot.
      await createProgressWriter(this.db, row.id).event("warn", message, undefined, "recover");
      await reconcileJobProject(this.db, row.id);
      if (pending) requeued++; else failed++;
    }
    return { requeued, failed };
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, close: true, timeout: 30_000 });
  }

  /** Insert the app job row and hand pg-boss an envelope with the same id. */
  async enqueue<T extends JobTypeName>(type: T, payload: JobPayload<T>, opts: EnqueueOptions = {}): Promise<{ jobId: string; deduplicated: boolean }> {
    return this.enqueueOn(this.db, type, payload, opts);
  }

  /** Commit a domain mutation and its queue message in the caller's transaction. */
  async enqueueInTransaction<T extends JobTypeName>(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], type: T, payload: JobPayload<T>, opts: EnqueueOptions = {}): Promise<{ jobId: string; deduplicated: boolean }> {
    return this.enqueueOn(tx, type, payload, opts);
  }

  private async enqueueOn<T extends JobTypeName>(database: Pick<Db, "transaction">, type: T, payload: JobPayload<T>, opts: EnqueueOptions): Promise<{ jobId: string; deduplicated: boolean }> {
    const parsed = parsePayload(type, payload);
    const queue = queueFor(type);
    const policy = QUEUE_POLICY[queue];
    const jobId = newId();
    const maxAttempts = opts.maxAttempts ?? policy.retryLimit + 1;

    return database.transaction(async tx => {
      if (opts.singletonKey) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`enqueue:${opts.singletonKey}`}, 0))`);
        const existing = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.singletonKey, opts.singletonKey), sql`${jobs.status} in ('queued','started','progress','retrying')`))
          .limit(1);
        if (existing[0]) return { jobId: existing[0].id, deduplicated: true };
      }

      await tx.insert(jobs).values({
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
        db: fromDrizzle(tx, sql),
        id: jobId,
        priority: opts.priority ?? 0,
        singletonKey: opts.singletonKey,
        startAfter: opts.startAfter,
        retryLimit: maxAttempts - 1,
        expireInSeconds: executionSecondsFor(type),
      });
      if (!bossId) {
        throw new PipelineError("queue refused job submission; no job was created", { retrySafe: true, step: "enqueue" });
      }
      await tx.update(jobs).set({ pgbossId: bossId }).where(eq(jobs.id, jobId));
      return { jobId, deduplicated: false };
    });
  }

  async retry(jobId: string): Promise<{ jobId: string; deduplicated: boolean }> {
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`retry:${jobId}`}, 0))`);
      const row = (await tx.select().from(jobs).where(eq(jobs.id, jobId)))[0];
      if (!row || row.status !== "failed") throw new PipelineError("Only failed jobs can be retried", { step: "retry" });
      if (typeof row.result?.retryJobId === "string") return { jobId: row.result.retryJobId, deduplicated: true };
      const type = row.type as JobTypeName;
      if (!JOB_TYPES[type]) throw new PipelineError("This job type is no longer supported", { step: "retry" });
      const retried = await this.enqueueOn(tx, type, parsePayload(type, row.payload), {
        ...(row.productId ? { productId: row.productId } : {}),
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(row.assetId ? { assetId: row.assetId } : {}),
        ...(row.sourceId ? { sourceId: row.sourceId } : {}),
        priority: row.priority, maxAttempts: row.maxAttempts, singletonKey: `retry:${jobId}`,
      });
      await tx.update(jobs).set({ result: { ...row.result, retryJobId: retried.jobId }, updatedAt: sql`now()` }).where(eq(jobs.id, jobId));
      await reconcileJobProject(tx, jobId);
      return retried;
    });
  }

  async cancel(jobId: string): Promise<void> {
    const changed = await this.db.transaction(async tx => {
      const row = (await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update"))[0];
      if (!row || ["completed", "failed", "cancelled"].includes(row.status)) return [];
      const root = await tx.update(jobs).set({ status: "cancelled", completedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(jobs.id, jobId)).returning({ id: jobs.id, type: jobs.type });
      // Qualification parents and descendant admission lock the same parent row.
      // Children committed first are cancelled here; later admission sees cancelled.
      const batch = row.type === "source.search" ? row.id : row.type === "source.probe" ? row.payload.qualificationBatch : null;
      if (typeof batch !== "string") return root;
      const descendants = await tx.update(jobs).set({ status: "cancelled", completedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(sql`${jobs.payload}->>'qualificationBatch' = ${batch}`, sql`${jobs.status} in ('queued','started','progress','retrying')`, row.type === "source.probe" ? eq(jobs.sourceId, row.sourceId!) : sql`true`))
        .returning({ id: jobs.id, type: jobs.type });
      return [...root, ...descendants];
    });
    for (const row of changed) {
      await this.boss.cancel(queueFor(row.type as JobTypeName), row.id);
      await reconcileJobProject(this.db, row.id);
    }
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
    const claimed = await this.db
      .update(jobs)
      .set({ status: "started", attempts: attempt, startedAt: row.startedAt ?? sql`now()`, currentStep: "start", updatedAt: sql`now()` })
      .where(and(eq(jobs.id, jobId), sql`${jobs.status} not in ('completed','cancelled')`)).returning({ id: jobs.id });
    if (!claimed.length) return;
    const writer = createProgressWriter(this.db, jobId);
    await writer.event("info", attempt > 1 ? `retry ${attempt}/${row.maxAttempts}` : "started", undefined, "start");

    const cancellation = new AbortController();
    const signal = AbortSignal.any([job.signal, cancellation.signal]);
    let checking = false;
    const cancellationPoll = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).then(rows => {
        if (!rows[0] || rows[0].status === "cancelled") cancellation.abort(new Error("Job cancelled"));
      }).catch(err => log.warn({ err: redact(String(err)) }, "cancellation check failed"))
        .finally(() => { checking = false; });
    }, 500);
    cancellationPoll.unref();

    const started = Date.now();
    try {
      const payload = parsePayload(type, row.payload);
      const payloadProductId = "productId" in payload ? payload.productId : undefined;
      if (row.productId && payloadProductId && row.productId !== payloadProductId) throw new PipelineError("Job product does not match payload", { retrySafe: false });
      const budgetProductId = row.productId ?? payloadProductId;
      const ctx: JobContext<JobTypeName> = {
        jobId,
        type,
        payload,
        attempt,
        maxAttempts: row.maxAttempts,
        db: this.db,
        log,
        signal,
        queue: this,
        ...writer,
        recordUsage: async (u) => {
          await this.db.insert(usageLedger).values({
            accountId: u.accountId,
            productId: u.productId ?? budgetProductId,
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

      const result = budgetProductId
        ? await withProviderBudget(productBudget(this.db, budgetProductId, jobId), () => handler(ctx))
        : await handler(ctx);
      const completed = await this.db
        .update(jobs)
        .set({ status: "completed", progressPct: 100, currentStep: "done", error: null, result: (result as Record<string, unknown>) ?? null, completedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(jobs.id, jobId), sql`${jobs.status} in ('started','progress')`)).returning({ id: jobs.id });
      await reconcileJobProject(this.db, jobId);
      if (completed.length) await writer.event("info", `completed in ${Math.round((Date.now() - started) / 1000)}s`, undefined, "done");
    } catch (err) {
      const current = (await this.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)))[0];
      if (!current || current.status === "cancelled") return;
      const retrySafe = isRetrySafe(err);
      const willRetry = retrySafe && attempt < row.maxAttempts;
      await this.finishFailed(jobId, err, attempt, willRetry);
      if (willRetry) throw err; // let pg-boss schedule the retry
      // not retry-safe (or out of attempts): swallow so pg-boss completes; our row is failed.
    } finally {
      clearInterval(cancellationPoll);
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
      .where(and(eq(jobs.id, jobId), sql`${jobs.status} not in ('cancelled','completed')`));
    if (!willRetry) await reconcileJobProject(this.db, jobId);
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
