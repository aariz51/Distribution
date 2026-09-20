import { describe, expect, it } from "vitest";
import { DELIVERY_H, DELIVERY_W, baseVideoFilter, buildRenderCommand, cropOffsets, type RenderSpec } from "../render-command";

function argsOf(overlay: string | null, extra: Partial<RenderSpec> = {}): string[] {
  return buildRenderCommand({
    sourcePath: "/tmp/source.mp4",
    startSec: 60.0,
    endSec: 150.0,
    outputPath: "/tmp/out.mp4",
    drawtextFilters: null,
    captionOverlay: overlay,
    hasVideo: true,
    cropOffsets: "",
    ...extra,
  });
}

const count = (args: string[], flag: string) => args.filter((a) => a === flag).length;

// One-to-one with media.rs `mod tests`.
describe("buildRenderCommand (media.rs tests)", () => {
  /// Regression: `-t` once sat before the caption input, so ffmpeg treated it
  /// as an input limit and encoded the entire 49-minute source.
  it("duration_limit_comes_after_every_input", () => {
    for (const overlay of [null, "/tmp/captions.txt"]) {
      const args = argsOf(overlay);
      const t = args.indexOf("-t");
      expect(t, "-t missing").toBeGreaterThanOrEqual(0);
      const lastInput = args.lastIndexOf("-i");
      expect(lastInput, "-i missing").toBeGreaterThanOrEqual(0);
      expect(t, `-t at ${t} must follow the last -i at ${lastInput}: ${JSON.stringify(args)}`).toBeGreaterThan(lastInput);
    }
  });

  it("clip_duration_is_the_requested_span", () => {
    const args = argsOf(null);
    const t = args.indexOf("-t");
    expect(args[t + 1]).toBe("90.000");
  });

  it("caption_overlay_adds_a_second_input_and_maps_it", () => {
    const args = argsOf("/tmp/captions.txt");
    expect(count(args, "-i")).toBe(2);
    expect(args).toContain("-filter_complex");
    expect(args.some((a) => a.includes("overlay=0:0"))).toBe(true);
    // Audio must still come from the source, not the caption track.
    expect(args).toContain("0:a?");
  });

  it("without_captions_there_is_one_input_and_no_filter_complex", () => {
    const args = argsOf(null);
    expect(count(args, "-i")).toBe(1);
    expect(args).not.toContain("-filter_complex");
    expect(args).toContain("-vf");
  });
});

describe("buildRenderCommand (port additions)", () => {
  const FILTER =
    "crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)',scale=1080:1920:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1";

  it("the plain video argv is exactly the Rust ordering", () => {
    expect(DELIVERY_W).toBe(1080);
    expect(DELIVERY_H).toBe(1920);
    expect(baseVideoFilter()).toBe(FILTER);
    expect(argsOf(null)).toEqual([
      "-y", "-ss", "60.000", "-i", "/tmp/source.mp4",
      "-t", "90.000",
      "-vf", FILTER,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "/tmp/out.mp4",
    ]);
  });

  it("the overlay graph wraps the same filter and reads the concat list", () => {
    const args = argsOf("/tmp/captions.txt");
    expect(args.slice(0, 13)).toEqual([
      "-y", "-ss", "60.000", "-i", "/tmp/source.mp4",
      "-f", "concat", "-safe", "0", "-i", "/tmp/captions.txt",
      "-t", "90.000",
    ]);
    const fc = args.indexOf("-filter_complex");
    expect(args[fc + 1]).toBe(`[0:v]${FILTER}[base];[base][1:v]overlay=0:0:format=auto:shortest=0[v]`);
    expect(args.slice(fc + 2, fc + 6)).toEqual(["-map", "[v]", "-map", "0:a?"]);
    expect(args).not.toContain("-vf");
  });

  it("face-track offsets are injected into the crop expression", () => {
    expect(cropOffsets(null)).toBe("");
    const suffix = cropOffsets({ x: "312", y: "(in_h-out_h)/2", summary: "" });
    expect(suffix).toBe(":x='312':y='(in_h-out_h)/2'");
    const args = argsOf(null, { cropOffsets: suffix });
    expect(args[args.indexOf("-vf") + 1]).toBe(
      "crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)':x='312':y='(in_h-out_h)/2',scale=1080:1920:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1",
    );
  });

  it("drawtext is a fallback: appended only without an overlay and only when the build has it", () => {
    const dt = "drawtext=text='HI':x=10:y=10";
    expect(argsOf(null, { drawtextFilters: dt })[argsOf(null).indexOf("-vf") + 1]).toBe(`${FILTER},${dt}`);
    expect(argsOf(null, { drawtextFilters: dt, supportsDrawtext: false })).toContain(FILTER);
    expect(argsOf(null, { drawtextFilters: "" })).toContain(FILTER);
    const withOverlay = argsOf("/tmp/captions.txt", { drawtextFilters: dt });
    expect(withOverlay.some((a) => a.includes("drawtext"))).toBe(false);
  });

  it("audio-only sources drop video options and ignore a caption overlay", () => {
    const args = argsOf("/tmp/captions.txt", { hasVideo: false, drawtextFilters: "drawtext=x" });
    expect(args).toEqual([
      "-y", "-ss", "60.000", "-i", "/tmp/source.mp4",
      "-t", "90.000",
      "-vn",
      "-c:a", "aac", "-b:a", "192k",
      "/tmp/out.mp4",
    ]);
  });

  it("duration never drops below 0.1 and is formatted to three decimals", () => {
    const args = argsOf(null, { startSec: 5, endSec: 5 });
    expect(args[args.indexOf("-t") + 1]).toBe("0.100");
    const fine = argsOf(null, { startSec: 1.23456, endSec: 4.5 });
    expect(fine[fine.indexOf("-ss") + 1]).toBe("1.235");
    expect(fine[fine.indexOf("-t") + 1]).toBe("3.265");
  });
});
