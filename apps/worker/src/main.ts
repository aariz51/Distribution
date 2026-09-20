import "./env.js";
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
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
