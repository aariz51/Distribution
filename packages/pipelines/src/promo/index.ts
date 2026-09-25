import { promoAnalyzeReference, promoRun, promoStoryboard } from "./showreel-jobs";
import type { JobQueue } from "@distribution/jobs";
import { promoBuild, promoFinalize, promoRender } from "./jobs";

export { promoRun, promoBuild, promoRender, promoFinalize };
export * from "./storyboard-rules";
export * from "./structures";
export * from "./theme";
export * from "./creative-direction";
export * from "./showreel";
export { stagePromoAssets, writeShowreel, collectEvidence } from "./showreel-jobs";
export { fetchReference, referenceEvidence, evidenceText, type ReferenceEvidence } from "./breakdown";
export { promoSpendUsd, promoCapUsd } from "./director";

/** Provider-backed handlers run only for explicitly requested LLM/reference jobs. */
export function registerPromo(queue: JobQueue): void {
  queue.register("promo.run", promoRun);
  queue.register("promo.analyze_reference", promoAnalyzeReference);
  queue.register("promo.storyboard", promoStoryboard);
  queue.register("promo.build", promoBuild);
  queue.register("promo.render", promoRender);
  queue.register("promo.finalize", promoFinalize);
}
