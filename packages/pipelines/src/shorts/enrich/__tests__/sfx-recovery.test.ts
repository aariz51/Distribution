import { describe, expect, it } from "vitest";
import { PipelineError } from "@distribution/core";
import { sfxRecoveryWindows } from "../sfx-recovery";

const blocked = (audio: unknown, visual: unknown = { status: "allowed" }) =>
  new PipelineError("Finished clip blocked: Music detected in the finished audio", { step: "final_screening", retrySafe: false, details: { screening: { audio, visual } } });

// The real SafeChoice case: a riser at 0.70 s (1.8 s long) and an attention
// cue at 2.35 s; YAMNet heard music at 1.44–2.90 s.
const PLAN = [
  { at: 0.7, end: 2.5, effect: "riser" },
  { at: 2.35, end: 2.6, effect: "attention" },
  { at: 22.91, end: 24.1, effect: "boom" },
];
const MUSIC = [
  { label: "Music", status: "uncertain", startSec: 1.44, endSec: 2.415 },
  { label: "Music", status: "rejected", startSec: 1.92, endSec: 2.895 },
];

describe("sound effect recovery after a music block", () => {
  it("returns padded windows when every music finding sits under a placed effect", () => {
    const w = sfxRecoveryWindows(blocked({ status: "rejected", findings: MUSIC }), PLAN);
    expect(w).toEqual([[1.34, 2.515], [1.82, 2.995]].map(([a, b]) => [expect.closeTo(a!, 5), expect.closeTo(b!, 5)]));
  });

  it("refuses when music is heard where no effect plays (the source itself)", () => {
    expect(sfxRecoveryWindows(blocked({ status: "rejected", findings: [{ label: "Music", status: "rejected", startSec: 10, endSec: 11 }] }), PLAN)).toBeNull();
  });

  it("refuses when any one finding is outside the effects", () => {
    expect(sfxRecoveryWindows(blocked({ status: "rejected", findings: [...MUSIC, { label: "Music", status: "rejected", startSec: 15, endSec: 16 }] }), PLAN)).toBeNull();
  });

  it("recovers when the picture was not assessed because audio failed first (the real report)", () => {
    expect(sfxRecoveryWindows(blocked({ status: "rejected", findings: MUSIC }, { reason: "Audio already rejected", status: "not-run" }), PLAN)).not.toBeNull();
  });

  it("refuses when the picture was also blocked", () => {
    expect(sfxRecoveryWindows(blocked({ status: "rejected", findings: MUSIC }, { status: "uncertain" }), PLAN)).toBeNull();
  });

  it("refuses findings without a location or of another kind", () => {
    expect(sfxRecoveryWindows(blocked({ status: "rejected", findings: [{ label: "Music", status: "rejected" }] }), PLAN)).toBeNull();
    expect(sfxRecoveryWindows(blocked({ status: "rejected", findings: [{ label: "Speech", status: "rejected", startSec: 1, endSec: 2 }] }), PLAN)).toBeNull();
  });

  it("refuses errors that are not screening blocks, and plans with no effects", () => {
    expect(sfxRecoveryWindows(new Error("ffmpeg crashed"), PLAN)).toBeNull();
    expect(sfxRecoveryWindows(blocked({ status: "rejected", findings: MUSIC }), [])).toBeNull();
  });
});
