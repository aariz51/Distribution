import { promoAnalyzeReference, promoStoryboard } from "./reference";
import type { JobQueue } from "@distribution/jobs";
import { promoBuild, promoFinalize, promoRender, promoRun } from "./jobs";

export { promoRun, promoBuild, promoRender, promoFinalize };
export * from "./storyboard-rules";
export * from "./structures";
export * from "./theme";
export * from "./creative-direction";

/** Provider-backed handlers run only for explicitly requested LLM/reference jobs. */
export function registerPromo(queue: JobQueue): void {
  queue.register("promo.run", promoRun);
  queue.register("promo.analyze_reference", promoAnalyzeReference);
  queue.register("promo.storyboard", promoStoryboard);
  queue.register("promo.build", promoBuild);
  queue.register("promo.render", promoRender);
  queue.register("promo.finalize", promoFinalize);
}
