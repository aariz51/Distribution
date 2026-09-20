import { z } from "zod";

/** Queues group jobs by the resource they contend for. Concurrency and retry
 *  policy are per queue (Gate 3 cost controls). */
export const QueueName = z.enum(["light", "media", "llm", "render", "publish"]);
export type QueueName = z.infer<typeof QueueName>;

export const QUEUE_POLICY: Record<QueueName, { retryLimit: number; retryDelay: number; retryBackoff: boolean; expireInSeconds: number; concurrencyEnv: string; defaultConcurrency: number }> = {
  light: { retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInSeconds: 10 * 60, concurrencyEnv: "WORKER_LIGHT_CONCURRENCY", defaultConcurrency: 4 },
  media: { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 4 * 60 * 60, concurrencyEnv: "WORKER_MEDIA_CONCURRENCY", defaultConcurrency: 2 },
  llm: { retryLimit: 4, retryDelay: 10, retryBackoff: true, expireInSeconds: 20 * 60, concurrencyEnv: "WORKER_LLM_CONCURRENCY", defaultConcurrency: 4 },
  render: { retryLimit: 1, retryDelay: 60, retryBackoff: false, expireInSeconds: 6 * 60 * 60, concurrencyEnv: "WORKER_RENDER_CONCURRENCY", defaultConcurrency: 1 },
  publish: { retryLimit: 3, retryDelay: 120, retryBackoff: true, expireInSeconds: 3 * 60 * 60, concurrencyEnv: "WORKER_PUBLISH_CONCURRENCY", defaultConcurrency: 1 },
};

export const DEAD_LETTER_QUEUE = "dlq";

/** Every job type declares its payload schema and the queue it runs on. Adding
 *  a pipeline step = adding a row here plus a handler in packages/pipelines. */
export const JOB_TYPES = {
  "brand.palette": {
    queue: "light",
    payload: z.object({ productId: z.uuid(), assetIds: z.array(z.uuid()).min(1) }),
  },
  "source.probe": {
    queue: "light",
    payload: z.object({ productId: z.uuid(), sourceId: z.uuid() }),
  },
  "source.ingest": {
    queue: "media",
    payload: z.object({ productId: z.uuid(), sourceId: z.uuid(), projectId: z.uuid().optional() }),
  },
  "source.transcribe": {
    queue: "media",
    payload: z.object({ productId: z.uuid(), sourceId: z.uuid(), projectId: z.uuid(), provider: z.string().optional() }),
  },
  "shorts.rank": {
    queue: "llm",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid(), transcriptId: z.uuid() }),
  },
  "shorts.cut": {
    queue: "media",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid(), candidateId: z.uuid() }),
  },
  "shorts.thumbnail": {
    queue: "media",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid(), assetId: z.uuid() }),
  },
  "copy.generate": {
    queue: "llm",
    payload: z.object({ productId: z.uuid(), assetId: z.uuid(), platforms: z.array(z.string()).min(1) }),
  },
  "publish.post": {
    queue: "publish",
    payload: z.object({ scheduleId: z.uuid() }),
  },
  "publish.poll": {
    queue: "publish",
    payload: z.object({ scheduleId: z.uuid() }),
  },
  "shorts.enrich": {
    queue: "media",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid(), assetId: z.uuid(), steps: z.array(z.enum(["broll", "sfx", "outro"])).min(1) }),
  },
  "promo.run": {
    queue: "llm",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid(), referenceUrl: z.string().optional(), referenceId: z.uuid().optional(), durationSec: z.number().min(15).max(90).default(33) }),
  },
  "promo.analyze_reference": {
    queue: "llm",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid(), referenceUrl: z.string().optional(), referenceId: z.uuid().optional() }),
  },
  "promo.storyboard": {
    queue: "llm",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid() }),
  },
  "promo.build": {
    queue: "render",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid() }),
  },
  "promo.render": {
    queue: "render",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid(), composition: z.enum(["PromoVertical", "PromoLandscape", "PromoStorePortrait", "PromoStoreLandscape"]) }),
  },
  "promo.finalize": {
    queue: "media",
    payload: z.object({ productId: z.uuid(), projectId: z.uuid() }),
  },
} as const satisfies Record<string, { queue: QueueName; payload: z.ZodType }>;

export type JobTypeName = keyof typeof JOB_TYPES;
export type JobPayload<T extends JobTypeName> = z.infer<(typeof JOB_TYPES)[T]["payload"]>;

export function queueFor(type: JobTypeName): QueueName {
  return JOB_TYPES[type].queue;
}

export function parsePayload<T extends JobTypeName>(type: T, payload: unknown): JobPayload<T> {
  return JOB_TYPES[type].payload.parse(payload) as JobPayload<T>;
}

/** Envelope stored in pg-boss `data`. The app `jobs` row is the source of truth. */
export interface JobEnvelope {
  jobId: string;
  type: JobTypeName;
}
