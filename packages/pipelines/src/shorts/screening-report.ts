import { z } from "zod";
export const SCREENING_POLICY_VERSION = "original-media-v3";
export const MUSIC_CLASSES_SHA256 = "4123c3a65f9e0b42347f8091fa36a8097dd4052b7b751a9e2ccb01d96cf82493";
export const ScreeningReport = z.object({
  status: z.enum(["allowed", "rejected", "uncertain"]),
  policyVersion: z.literal(SCREENING_POLICY_VERSION),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string(),
  audio: z.record(z.string(), z.unknown()).optional(),
  visual: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export const MODEL_HASHES = {
  audio: "13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744",
  "object_detection_yolox_2022nov.onnx": "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063",
  "gender_googlenet.onnx": "af24a4eaa9eaf70913cc9a337a0387c86f11549cbd9bbc16bffeefcdcf88cbf4",
  "face_detection_yunet_2023mar.onnx": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
} as const;
const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
/** A status string alone is never acceptance evidence. */
export function hasCompleteScreeningPass(value: unknown, hash: string): boolean {
  const parsed = ScreeningReport.safeParse(value);
  if (!parsed.success) return false;
  const r = parsed.data, a = r.audio, v = r.visual;
  if (r.status !== "allowed" || r.contentSha256 !== hash || r.error || !a || !v) return false;
  if (a.status !== "allowed" || a.policyVersion !== "original-audio-v3" || a.coverage !== "all-audio-streams-and-channels" || a.modelSha256 !== MODEL_HASHES.audio || a.musicClassesSha256 !== MUSIC_CLASSES_SHA256 || !finitePositive(a.durationSec) || !finitePositive(a.windows) || !Number.isInteger(a.windows) || a.rejectedWindows !== 0 || a.uncertainWindows !== 0 || typeof a.maxMusicScore !== "number" || !Number.isFinite(a.maxMusicScore) || a.maxMusicScore < 0 || a.maxMusicScore >= .05) return false;
  if (!Array.isArray(a.channels) || !Array.isArray(a.streamLayouts) || a.streamLayouts.length !== a.streams || !a.channels.length) return false;
  const seen = new Set<string>();
  let windows = 0;
  for (const channel of a.channels) {
    if (!channel || typeof channel !== "object") return false;
    const c = channel as Record<string, unknown>;
    const key = `${c.streamIndex}:${c.channel}`;
    if (seen.has(key) || c.status !== "allowed" || c.policyVersion !== "original-audio-v3" || c.coverage !== "complete-audio" || !finitePositive(c.durationSec) || !finitePositive(c.windows) || !Number.isInteger(c.windows) || c.rejectedWindows !== 0 || c.uncertainWindows !== 0 || typeof c.maxMusicScore !== "number" || !Number.isFinite(c.maxMusicScore) || c.maxMusicScore < 0 || c.maxMusicScore >= .05) return false;
    seen.add(key); windows += c.windows;
    if (Math.abs(c.durationSec - a.durationSec) > Math.max(.25, a.durationSec * .001)) return false;
    // Each YAMNet patch covers .975s with .48s hops. Account for sample-level
    // floating-point rounding and the producer's final padded chunk.
    const minimumWindows = Math.max(1, Math.ceil((c.durationSec - .975) / .48 - 1e-8) + 1);
    const maximumWindows = Math.max(1, Math.ceil(c.durationSec / .48 + 1e-8));
    if (c.windows < minimumWindows || c.windows > maximumWindows) return false;
  }
  const expected = new Set<string>();
  const streamIndices = new Set<number>();
  for (const layout of a.streamLayouts) {
    if (!layout || !Number.isInteger(layout.index) || layout.index < 0 || !Number.isInteger(layout.channels) || layout.channels < 1 || layout.channels > 8) return false;
    if (streamIndices.has(layout.index)) return false;
    streamIndices.add(layout.index);
    for (let i = 0; i < layout.channels; i++) expected.add(`${layout.index}:${i}`);
  }
  if (windows !== a.windows || seen.size !== expected.size || [...expected].some(key => !seen.has(key))) return false;
  if (v.status !== "allowed" || v.policyVersion !== "original-visual-v2" || v.coverage !== "every-decoded-frame" || !finitePositive(v.framesDecoded) || !Number.isInteger(v.framesDecoded) || v.framesDecoded !== v.expectedFrames || !v.modelHashes || typeof v.modelHashes !== "object") return false;
  const hashes = v.modelHashes as Record<string, unknown>;
  return Object.entries(MODEL_HASHES).filter(([key]) => key !== "audio").every(([key, expected]) => hashes[key] === expected);
}
