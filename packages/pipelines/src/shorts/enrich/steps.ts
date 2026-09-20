import type { ContentPreferences, TranscriptWord } from "@distribution/core";

export type EnrichStep = "broll" | "sfx" | "outro";

/** Fixed application order, mirroring the desktop chain (`lib.rs:698-822` then `:862-927`):
 *  B-roll first so sound is timed against the edit, outro last so the end card sits
 *  on whichever artefact ships. */
export const ENRICH_ORDER: readonly EnrichStep[] = ["broll", "sfx", "outro"] as const;

/** Steps the auto-chain should run for a product, from its content preference flags. */
export function enrichStepsFor(prefs: Pick<ContentPreferences, "broll" | "sfx" | "outro">): EnrichStep[] {
  return ENRICH_ORDER.filter((s) => prefs[s]);
}

/** Put any requested subset back into the fixed order, dropping duplicates. */
export function orderSteps(requested: readonly EnrichStep[]): EnrichStep[] {
  const want = new Set(requested);
  return ENRICH_ORDER.filter((s) => want.has(s));
}

export interface ClipWord {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

/** Words overlapping [startSec, endSec), rebased so the clip starts at 0 — the shape
 *  `broll_pipeline.py --transcript`, `sfx_mix.py --transcript` and `outro.py --transcript`
 *  read (`broll.rs:81-109`, `lib.rs:887-911`). Returns [] when nothing overlaps. */
export function rebaseWords(words: readonly TranscriptWord[], startSec: number, endSec: number): ClipWord[] {
  return words
    .filter((w) => w.end > startSec && w.start < endSec)
    .map((w) => ({ text: w.text, start: w.start - startSec, end: w.end - startSec, ...(w.speaker ? { speaker: w.speaker } : {}) }));
}
