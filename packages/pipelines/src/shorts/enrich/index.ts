import type { JobQueue } from "@distribution/jobs";
import { shortsEnrich } from "./job";

export { shortsEnrich };
export { enrichStepsFor, orderSteps, rebaseWords, ENRICH_ORDER, type EnrichStep, type ClipWord } from "./steps";

/** Register the enrichment handler (called from `registerPipelines`). */
export function registerEnrich(queue: JobQueue): void {
  queue.register("shorts.enrich", shortsEnrich);
}
