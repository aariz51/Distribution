import { expect, it } from "vitest";
import { hasCompleteScreeningPass, MODEL_HASHES, MUSIC_CLASSES_SHA256 } from "../screening-report";
const hash = "a".repeat(64);
function report() {
  const channel = { status: "allowed", policyVersion: "original-audio-v3", coverage: "complete-audio", durationSec: 1, windows: 2, rejectedWindows: 0, uncertainWindows: 0, maxMusicScore: .001, streamIndex: 1, channel: 0 };
  return { status: "allowed", policyVersion: "original-media-v3", contentSha256: hash, reason: "No findings", audio: { ...channel, modelSha256: MODEL_HASHES.audio, musicClassesSha256: MUSIC_CLASSES_SHA256, coverage: "all-audio-streams-and-channels", streams: 1, streamLayouts: [{ index: 1, channels: 1 }], channels: [channel] }, visual: { status: "allowed", policyVersion: "original-visual-v2", coverage: "every-decoded-frame", framesDecoded: 30, expectedFrames: 30, modelHashes: { ...MODEL_HASHES } } };
}
it("requires evidence for all channels and every decoded frame", () => {
  expect(hasCompleteScreeningPass(report(), hash)).toBe(true);
  for (const mutate of [
    (r: ReturnType<typeof report>) => { r.visual.expectedFrames++; },
    (r: ReturnType<typeof report>) => { r.audio.streamLayouts[0]!.channels = 2; },
    (r: ReturnType<typeof report>) => { r.audio.channels[0]!.status = "uncertain"; },
    (r: ReturnType<typeof report>) => { r.audio.maxMusicScore = NaN; },
    (r: ReturnType<typeof report>) => { r.audio.channels = []; },
    (r: ReturnType<typeof report>) => { r.policyVersion = "original-media-v1"; },
  ]) { const r = report(); mutate(r); expect(hasCompleteScreeningPass(r, hash)).toBe(false); }
});
it("invalidates changed bytes and models", () => {
  expect(hasCompleteScreeningPass(report(), "b".repeat(64))).toBe(false);
  const r = report(); r.audio.modelSha256 = "b".repeat(64) as typeof MODEL_HASHES.audio;
  expect(hasCompleteScreeningPass(r, hash)).toBe(false);
});
it("does not accept a bare allowed label", () => {
  expect(hasCompleteScreeningPass({ status: "allowed", policyVersion: "original-media-v3", contentSha256: hash, reason: "OK" }, hash)).toBe(false);
});
it("rejects contradictory audio duration, window coverage and duplicate stream layouts", () => {
  for (const mutate of [
    (r: ReturnType<typeof report>) => { r.audio.durationSec = 3600; },
    (r: ReturnType<typeof report>) => { r.audio.durationSec = 3600; r.audio.channels[0]!.durationSec = 3600; },
    (r: ReturnType<typeof report>) => { r.audio.channels[0]!.durationSec = .1; },
    (r: ReturnType<typeof report>) => { r.audio.channels[0]!.windows = 100; r.audio.windows = 100; },
    (r: ReturnType<typeof report>) => { r.audio.streams = 2; r.audio.streamLayouts.push({ ...r.audio.streamLayouts[0]! }); },
  ]) { const r = report(); mutate(r); expect(hasCompleteScreeningPass(r, hash)).toBe(false); }
});
