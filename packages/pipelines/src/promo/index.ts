import type { JobQueue } from "@distribution/jobs";
import { promoBuild, promoFinalize, promoRender, promoRun } from "./jobs";

export { promoRun, promoBuild, promoRender, promoFinalize };
export * from "./storyboard-rules";
export * from "./structures";
export * from "./theme";
export * from "./creative-direction";

/**
 * Register the promo handlers. `promo.analyze_reference` and `promo.storyboard`
 * are the opt-in, provider-backed path; they are registered only when
 * PROMO_LLM_ENABLED is set, so a default deployment cannot spend credits on a
 * promo without the operator asking for it.
 */
export function registerPromo(queue: JobQueue): void {
  queue.register("promo.run", promoRun);
  queue.register("promo.build", promoBuild);
  queue.register("promo.render", promoRender);
  queue.register("promo.finalize", promoFinalize);
}
