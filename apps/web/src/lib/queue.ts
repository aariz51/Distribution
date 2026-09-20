import "./env";
import { JobQueue } from "@distribution/jobs";
import { db } from "./db";

// One pg-boss client per server process (survives HMR in dev via globalThis).
const g = globalThis as unknown as { __distQueue?: Promise<JobQueue> };

export function getQueue(): Promise<JobQueue> {
  g.__distQueue ??= JobQueue.start(db);
  return g.__distQueue;
}
