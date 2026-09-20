import { z } from "zod";

/** Mirrors autoshorts `models.rs:124-148` NormalizedTranscript exactly so the
 *  ported ranking/caption logic and its tests keep the same shape. */
export const TranscriptWord = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  speaker: z.string().optional(),
  confidence: z.number().optional(),
});
export type TranscriptWord = z.infer<typeof TranscriptWord>;

export const TranscriptSegment = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  speaker: z.string().optional(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const NormalizedTranscript = z.object({
  language: z.string().nullable(),
  duration: z.number(),
  speakers: z.array(z.string()),
  words: z.array(TranscriptWord),
  segments: z.array(TranscriptSegment),
});
export type NormalizedTranscript = z.infer<typeof NormalizedTranscript>;

/** Mirrors `models.rs` CandidateDraft. */
export const CandidateDraft = z.object({
  startSec: z.number(),
  endSec: z.number(),
  score: z.number().min(0).max(1),
  hook: z.string(),
  rationale: z.string(),
  featureIds: z.array(z.uuid()).default([]),
});
export type CandidateDraft = z.infer<typeof CandidateDraft>;
