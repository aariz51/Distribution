/** Port of autoshorts `src-tauri/src/media.rs` `build_render_command`
 *  (`media.rs:249-320`) plus the crop-offset suffix from `render_flat_clip`.
 *
 *  Returns the ffmpeg argv (without the binary) so the caller can spawn it via
 *  `run(bin("ffmpeg"), argv)`. Option *position* carries meaning in ffmpeg:
 *  anything before an `-i` binds to that input, so `-t` must follow every
 *  input or the whole source gets encoded. */
import type { CropPlan } from "./facetrack-plan";
import { rustFixed } from "./rust-format";

/** Vertical delivery size; captions and overlays are drawn at this resolution. */
export const DELIVERY_W = 1080;
export const DELIVERY_H = 1920;

export interface RenderSpec {
  sourcePath: string;
  startSec: number;
  endSec: number;
  outputPath: string;
  /** drawtext fallback chain; only used when no overlay is supplied. */
  drawtextFilters?: string | null;
  /** ffmpeg concat list of pre-rendered caption frames (`CaptionTrack.concat_list`). */
  captionOverlay?: string | null;
  hasVideo: boolean;
  /** Pre-computed `:x=...:y=...` crop suffix (see `cropOffsets`), or "". */
  cropOffsets?: string;
  /** Whether this ffmpeg build has the `drawtext` filter. The Rust probed
   *  ffmpeg here (`supports_captions()`); that is I/O, so the answer is an
   *  input. Defaults to `true`. When `false` the drawtext chain is dropped so
   *  the clip renders without captions instead of aborting. */
  supportsDrawtext?: boolean;
}

/** `render_flat_clip:196-206`: the crop suffix for a face-track plan, or ""
 *  to leave ffmpeg's centred defaults in place. */
export function cropOffsets(plan: CropPlan | null | undefined): string {
  return plan ? `:x='${plan.x}':y='${plan.y}'` : "";
}

/** The video filter chain before any captions: 9:16 crop, upscale to delivery
 *  size, sharpen, square pixels. */
export function baseVideoFilter(cropSuffix = ""): string {
  return (
    `crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'${cropSuffix},` +
    `scale=${DELIVERY_W}:${DELIVERY_H}:flags=lanczos,` +
    `unsharp=5:5:0.6:5:5:0.0,setsar=1`
  );
}

/** Assemble the ffmpeg argv without running it. */
export function buildRenderCommand(spec: RenderSpec): string[] {
  const start = rustFixed(spec.startSec, 3);
  const duration = rustFixed(Math.max(spec.endSec - spec.startSec, 0.1), 3);

  const args: string[] = [];

  // --- Inputs. Nothing output-related may appear in this section. ---
  args.push("-y", "-ss", start, "-i", spec.sourcePath);

  const overlayInput = spec.hasVideo && spec.captionOverlay ? spec.captionOverlay : null;
  if (overlayInput !== null) {
    args.push("-f", "concat", "-safe", "0", "-i", overlayInput);
  }

  // --- Output options only, from here down. ---
  args.push("-t", duration);

  if (spec.hasVideo) {
    let filter = baseVideoFilter(spec.cropOffsets ?? "");

    if (overlayInput === null) {
      const drawtext = spec.drawtextFilters;
      if (drawtext && drawtext.length > 0 && (spec.supportsDrawtext ?? true)) {
        filter = `${filter},${drawtext}`;
      }
    }

    if (overlayInput !== null) {
      // Two inputs require filter_complex. `shortest=0` keeps the clip's own
      // length authoritative rather than the caption track's.
      const graph = `[0:v]${filter}[base];[base][1:v]overlay=0:0:format=auto:shortest=0[v]`;
      args.push("-filter_complex", graph);
      args.push("-map", "[v]", "-map", "0:a?");
    } else {
      args.push("-vf", filter);
    }
    args.push("-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p");
  } else {
    args.push("-vn");
  }

  args.push("-c:a", "aac", "-b:a", "192k");
  args.push(spec.outputPath);
  return args;
}
