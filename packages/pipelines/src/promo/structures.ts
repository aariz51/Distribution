import type { SceneKind } from "@distribution/promo-kit/schema";

/**
 * Named act structures, each a different film — not one skeleton re-skinned.
 * Which one a product gets depends on what it actually is and what assets it
 * has, so two products do not get the same running order by default. This is
 * the deterministic stand-in for the reference-derived structure; when a
 * reference video is supplied the analysis picks the acts instead.
 */
export interface Structure {
  id: string;
  /** Why this structure suits the product — surfaced in CREATIVE_DIRECTION.md. */
  rationale: string;
  /** Relative weights; converted to frames against the target duration. */
  beats: { kind: SceneKind; weight: number }[];
}

export const STRUCTURES: Record<string, Structure> = {
  /** Consumer app with screens: anxiety → the one action → the payoff → breadth → exit. */
  reveal: {
    id: "reveal",
    rationale:
      "The product's value is a moment of relief, so the film withholds the interface until the payoff has landed: the problem is stated in type, one action answers it, the result is shown large, and only then does the breadth of the app appear.",
    beats: [
      { kind: "hook", weight: 3.5 },
      { kind: "oneTap", weight: 2.5 },
      { kind: "press", weight: 2 },
      // Proof comes from an uploaded product screen, never an invented score.
      { kind: "dashboard", weight: 4 },
      { kind: "orbit", weight: 5 },
      { kind: "dashboard", weight: 5 },
      { kind: "tagline", weight: 3 },
      { kind: "logo", weight: 5 },
    ],
  },
  /** Developer / system product: the machine speaks. Mono bookends, split truth, procedure. */
  system: {
    id: "system",
    rationale:
      "The product is a system the user delegates to, so the film alternates the human voice and the machine voice: a monospace line opens on an inverted ground, a split screen shows both sides of the same second, and the steps are numbered rather than narrated.",
    beats: [
      { kind: "typewriter", weight: 3.5 },
      { kind: "split", weight: 5 },
      { kind: "steps", weight: 5 },
      { kind: "dashboard", weight: 5 },
      { kind: "typewriter", weight: 3 },
      { kind: "logo", weight: 4.5 },
    ],
  },
  /** Content / workflow product with several surfaces: breadth first, proof second. */
  survey: {
    id: "survey",
    rationale:
      "The product earns attention by how much it covers, so the film opens on range — many surfaces moving at once — then narrows to one screen held long enough to read, and closes on the procedure that makes it repeatable.",
    beats: [
      { kind: "hook", weight: 3 },
      { kind: "orbit", weight: 5.5 },
      { kind: "features", weight: 5 },
      { kind: "dashboard", weight: 5 },
      { kind: "steps", weight: 4.5 },
      { kind: "tagline", weight: 2.5 },
      { kind: "logo", weight: 4.5 },
    ],
  },
  /** Minimal assets: carry the film on type and rhythm alone. */
  typographic: {
    id: "typographic",
    rationale:
      "There is not enough product imagery to carry a film, so the structure leans on type and rhythm: a stated problem, a split that contrasts before and after, a numbered procedure, and a three-word close.",
    beats: [
      { kind: "hook", weight: 4 },
      { kind: "split", weight: 5.5 },
      { kind: "steps", weight: 5 },
      { kind: "typewriter", weight: 4 },
      { kind: "tagline", weight: 3 },
      { kind: "logo", weight: 4.5 },
    ],
  },
};

const SYSTEM_WORDS = /\b(dev|api|sdk|cli|infra|data|analytics|automation|agent|platform|integration|devtool|engineer|backend|security|observability|workflow engine)\b/i;
const SURVEY_WORDS = /\b(content|social|media|creator|marketing|productivity|notes|collaboration|crm|project|design|education|learning|course|study)\b/i;

export interface StructureInput {
  category: string;
  tags: string[];
  screenCount: number;
  featureCount: number;
  painPointCount: number;
}

/** Deterministic choice, so the same profile always produces the same film. */
export function chooseStructure(input: StructureInput): Structure {
  const haystack = `${input.category} ${input.tags.join(" ")}`;
  if (input.screenCount < 2) return STRUCTURES.typographic!;
  if (SYSTEM_WORDS.test(haystack)) return STRUCTURES.system!;
  if (SURVEY_WORDS.test(haystack) && input.screenCount >= 4) return STRUCTURES.survey!;
  if (input.screenCount >= 3 && input.featureCount >= 3) return STRUCTURES.reveal!;
  return input.painPointCount >= 2 ? STRUCTURES.typographic! : STRUCTURES.reveal!;
}
