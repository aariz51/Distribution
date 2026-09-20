import { describe, expect, it } from "vitest";
import { DEFAULT_CROP_X, DEFAULT_CROP_Y, facetrackArgv, lastJsonLine, parseFacetrackOutput, planFromTrackResult } from "../facetrack-plan";

describe("parseFacetrackOutput (facetrack.rs:134-177)", () => {
  it("static: integer offsets and a summary", () => {
    const out = '{"mode": "static", "out_w": 608, "out_h": 1080, "samples": 40, "coverage": 0.875, "cuts": 1, "x": 312, "y": 0}\n';
    expect(parseFacetrackOutput(out)).toEqual({ x: "312", y: "0", summary: "static track, coverage 88%, 1 cut(s)" });
  });

  it("dynamic: expressions win over numeric offsets", () => {
    const out =
      '{"mode": "dynamic", "out_w": 608, "out_h": 1080, "samples": 40, "coverage": 0.6, "cuts": 2, "x_expr": "if(lt(t,1),100,200)", "keys_x": 5, "y": 0, "x": 150}';
    expect(parseFacetrackOutput(out)).toEqual({ x: "if(lt(t,1),100,200)", y: "0", summary: "dynamic track, coverage 60%, 2 cut(s)" });
  });

  it("none: falls back to the centre crop", () => {
    expect(parseFacetrackOutput('{"mode": "none", "reason": "insufficient-faces", "samples": 2, "coverage": 0.05}')).toBeNull();
    expect(parseFacetrackOutput('{"mode": "none"}')).toBeNull();
  });

  it("takes the last JSON line and ignores log noise", () => {
    const out = 'loading model\n{"mode": "none", "reason": "first attempt"}\n[ WARN:0] something\n  {"mode": "static", "x": 10, "y": 20}\r\ntrailing text\n';
    expect(lastJsonLine(out)).toBe('  {"mode": "static", "x": 10, "y": 20}');
    expect(parseFacetrackOutput(out)).toEqual({ x: "10", y: "20", summary: "static track, coverage 0%, 0 cut(s)" });
  });

  it("any parse problem is a soft failure", () => {
    expect(parseFacetrackOutput("")).toBeNull();
    expect(parseFacetrackOutput("no json here")).toBeNull();
    expect(parseFacetrackOutput("{not json")).toBeNull();
    expect(parseFacetrackOutput('{"x": 1}')).toBeNull(); // mode is required
    expect(parseFacetrackOutput('{"mode": "static", "x": "12"}')).toBeNull(); // wrong type
    expect(parseFacetrackOutput('{"mode": "static", "cuts": 1.5}')).toBeNull(); // i64
    expect(parseFacetrackOutput('{"mode": "static", "x_expr": 5}')).toBeNull();
  });

  it("an unconstrained axis defaults to ffmpeg's centred expression", () => {
    expect(parseFacetrackOutput('{"mode": "static", "x": 100}')).toEqual({ x: "100", y: DEFAULT_CROP_Y, summary: "static track, coverage 0%, 0 cut(s)" });
    expect(parseFacetrackOutput('{"mode": "dynamic", "y_expr": "42"}')).toEqual({ x: DEFAULT_CROP_X, y: "42", summary: "dynamic track, coverage 0%, 0 cut(s)" });
    expect(parseFacetrackOutput('{"mode": "static", "x": null, "y": null}')).toEqual({ x: DEFAULT_CROP_X, y: DEFAULT_CROP_Y, summary: "static track, coverage 0%, 0 cut(s)" });
  });

  it("rounds offsets like f64::round (half away from zero) and coverage like {:.0} (half to even)", () => {
    expect(planFromTrackResult({ mode: "static", x: 311.5, y: -2.5 })).toMatchObject({ x: "312", y: "-3" });
    expect(planFromTrackResult({ mode: "static", x: 311.4, y: -0.2 })).toMatchObject({ x: "311", y: "0" });
    expect(planFromTrackResult({ mode: "static", coverage: 0.125, cuts: 3 })!.summary).toBe("static track, coverage 12%, 3 cut(s)");
    expect(planFromTrackResult({ mode: "static", coverage: 0.375 })!.summary).toBe("static track, coverage 38%, 0 cut(s)");
    expect(planFromTrackResult({ mode: "static", coverage: 1 })!.summary).toBe("static track, coverage 100%, 0 cut(s)");
  });
});

describe("facetrackArgv (facetrack.rs:105-122)", () => {
  it("builds the sidecar argv with three-decimal bounds", () => {
    expect(facetrackArgv({ script: "/data/facetrack.py", video: "/src.mp4", model: "/data/yunet.onnx", startSec: 1, endSec: 2.5 })).toEqual([
      "/data/facetrack.py", "--video", "/src.mp4", "--model", "/data/yunet.onnx", "--start", "1.000", "--end", "2.500",
    ]);
  });

  it("refuses an empty or inverted range before spawning", () => {
    expect(facetrackArgv({ script: "s", video: "v", model: "m", startSec: 5, endSec: 5 })).toBeNull();
    expect(facetrackArgv({ script: "s", video: "v", model: "m", startSec: 6, endSec: 5 })).toBeNull();
  });
});
