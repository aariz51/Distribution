import type { JobQueue } from "@distribution/jobs";
import { brandPalette } from "./brand/palette";

export { brandPalette };

/** Register every implemented handler. Types in the registry without a
 *  handler here fail fast with "no handler registered" instead of hanging. */
export function registerPipelines(queue: JobQueue): void {
  queue.register("brand.palette", brandPalette);
}
