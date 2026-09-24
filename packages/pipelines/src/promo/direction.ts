import { z } from "zod";

/** Model output controls editing rhythm; product copy stays tied to supplied facts. */
export const DirectedStructure = z.object({
  id: z.literal("reference-directed"),
  rationale: z.string().min(10).max(1800),
  beats: z.array(z.object({
    kind: z.enum(["hook", "oneTap", "press", "features", "orbit", "dashboard", "tagline", "logo", "typewriter", "split", "steps"]),
    weight: z.number().min(1).max(8),
  })).min(4).max(10),
}).refine(s => s.beats.at(-1)?.kind === "logo", "The final beat must be the product lockup");

export const ReferenceAnalysis = z.object({
  summary: z.string().min(10).max(2500),
  visualLanguage: z.array(z.string().max(250)).min(1).max(10),
  beats: z.array(z.object({ atSec: z.number().nonnegative(), description: z.string().max(500) })).min(1).max(12),
});

export function parseModelJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}
