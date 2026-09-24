import "./env.js";
import { enqueueConnectedSourceChecks } from "./connected-source-poller";
import os from "node:os";
import { logger } from "@distribution/core";
import { getDb, closeDb, workerHeartbeats, sql } from "@distribution/db";
import { JobQueue, QueueName } from "@distribution/jobs";
import { registerPipelines } from "@distribution/pipelines";
import { getStorage } from "@distribution/storage";

const workerId = `${os.hostname()}-${process.pid}`;

async function main() {
  const db = getDb();
  getStorage(); // fail fast on misconfiguration
  const queues = (process.env.WORKER_QUEUES?.split(",").map((s) => s.trim()).filter(Boolean) as QueueName[] | undefined) ?? QueueName.options;
  for (const q of queues) QueueName.parse(q);

  const queue = await JobQueue.start(db);
  registerPipelines(queue);
  await queue.work(queues);

  const beat = async () => {
    await db
      .insert(workerHeartbeats)
      .values({ workerId, hostname: os.hostname(), queues })
      .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: sql`now()`, queues } });
    await queue.reclaimStaleJobs();
    if (queues.includes("light")) await enqueueConnectedSourceChecks(db, queue);
  };
  await beat();
  const timer = setInterval(() => beat().catch((err) => logger.warn({ err }, "heartbeat failed")), 30_000);

  logger.info({ workerId, queues, storage: process.env.STORAGE_ROOT ?? "./storage" }, "worker ready");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker stopping");
    clearInterval(timer);
    try {
      await queue.stop();
    } finally {
      await closeDb();
      process.exit(0);
    }
  };
  // A single unhandled rejection used to end the process and every render in
  // it. Log it and keep serving: pg-boss will retry or expire the affected job,
  // and the other jobs in flight are unrelated to whatever threw.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: String(reason instanceof Error ? reason.stack ?? reason.message : reason) }, "unhandled rejection; worker staying up");
  });
  // An uncaught exception may have corrupted state, so this one does stop the
  // worker — but gracefully, so in-flight jobs are released back to the queue
  // for another worker rather than being left marked as running.
  process.on("uncaughtException", (err) => {
    logger.error({ err: err.stack ?? err.message }, "uncaught exception; shutting down gracefully");
    void shutdown("uncaughtException");
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
