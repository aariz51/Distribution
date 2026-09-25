import { describe, expect, it } from "vitest";
import { coverSampleWindow } from "../thumbnail";

describe("cover frame sampling", () => {
  it("samples the original source over the clip's range, away from the burned captions", () => {
    const w = coverSampleWindow({ clipPath: "/clip.mp4", clipDurationSec: 50, sourcePath: "/source.mp4", sourceDurationSec: 900, startSec: 400, endSec: 450 });
    expect(w.from).toBe("source");
    expect(w.path).toBe("/source.mp4");
    expect(w.startSec).toBeCloseTo(404);
    expect(w.durationSec).toBeCloseTo(42);
  });

  it("falls back to the clip when the source file is gone", () => {
    const w = coverSampleWindow({ clipPath: "/clip.mp4", clipDurationSec: 50, startSec: 400, endSec: 450 });
    expect(w).toMatchObject({ path: "/clip.mp4", from: "clip" });
    expect(w.startSec).toBeCloseTo(4);
  });

  it("falls back to the clip when the recorded range does not fit the source", () => {
    expect(coverSampleWindow({ clipPath: "/c", clipDurationSec: 30, sourcePath: "/s", sourceDurationSec: 100, startSec: 90, endSec: 130 }).from).toBe("clip");
    expect(coverSampleWindow({ clipPath: "/c", clipDurationSec: 30, sourcePath: "/s", sourceDurationSec: 100, startSec: 50, endSec: 50 }).from).toBe("clip");
    expect(coverSampleWindow({ clipPath: "/c", clipDurationSec: 30, sourcePath: "/s", sourceDurationSec: 100 }).from).toBe("clip");
  });
});
