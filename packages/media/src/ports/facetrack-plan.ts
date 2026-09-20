/** Port of autoshorts `src-tauri/src/facetrack.rs` (the pure parts).
 *
 *  The OpenCV sidecar is spawned by the caller; this module builds its argv
 *  and turns its stdout into a `CropPlan`. Every failure path degrades to
 *  `null`, in which case the caller keeps the original centre crop. */
import { z } from "zod";
import { roundAsI64, rustFixed } from "./rust-format";

/** Resolved crop offsets, as ffmpeg expression strings (`CropPlan`). */
export interface CropPlan {
  x: string;
  y: string;
  /** Human-readable note surfaced in logs / UI so a bad track is diagnosable. */
  summary: string;
}

/** Mirrors the serde `TrackResult`: `mode` required, everything else
 *  optional-with-default, unknown keys ignored, wrong types rejected. */
const TrackResult = z.looseObject({
  mode: z.string(),
  x: z.number().nullish(),
  y: z.number().nullish(),
  x_expr: z.string().nullish(),
  y_expr: z.string().nullish(),
  reason: z.string().nullish(),
  coverage: z.number().nullish(),
  cuts: z.number().int().nullish(),
});
export type TrackResult = z.infer<typeof TrackResult>;

export interface FacetrackArgs {
  /** Path to the materialised `facetrack.py`. */
  script: string;
  video: string;
  /** Path to `face_detection_yunet_2023mar.onnx`. */
  model: string;
  startSec: number;
  endSec: number;
}

/** Argv for the Python interpreter (`facetrack.rs:113-122`). Returns `null` for
 *  a non-positive range, which `plan_crop` short-circuits before spawning. */
export function facetrackArgv(args: FacetrackArgs): string[] | null {
  if (args.endSec - args.startSec <= 0) return null;
  return [args.script, "--video", args.video, "--model", args.model, "--start", rustFixed(args.startSec, 3), "--end", rustFixed(args.endSec, 3)];
}

/** ffmpeg's own centred expressions, used for any axis the tracker left alone. */
export const DEFAULT_CROP_X = "(in_w-out_w)/2";
export const DEFAULT_CROP_Y = "(in_h-out_h)/2";

/** Pick the sidecar's JSON line out of stdout: the last line starting with `{`. */
export function lastJsonLine(stdout: string): string | null {
  const lines = stdout.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (l.trimStart().startsWith("{")) return l;
  }
  return null;
}

/** `facetrack.rs:134-177`: sidecar stdout to a crop plan, or `null` on any
 *  problem (no JSON line, malformed JSON, unexpected shape, `mode == "none"`). */
export function parseFacetrackOutput(stdout: string): CropPlan | null {
  const line = lastJsonLine(stdout);
  if (line === null) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(line.trim());
  } catch {
    return null;
  }
  const parsed = TrackResult.safeParse(raw);
  if (!parsed.success) return null;
  return planFromTrackResult(parsed.data);
}

/** The `TrackResult -> CropPlan` step on its own. */
export function planFromTrackResult(parsed: TrackResult): CropPlan | null {
  if (parsed.mode === "none") return null;

  const x = parsed.x_expr ?? (parsed.x !== null && parsed.x !== undefined ? String(roundAsI64(parsed.x)) : DEFAULT_CROP_X);
  const y = parsed.y_expr ?? (parsed.y !== null && parsed.y !== undefined ? String(roundAsI64(parsed.y)) : DEFAULT_CROP_Y);

  const summary = `${parsed.mode} track, coverage ${rustFixed((parsed.coverage ?? 0) * 100, 0)}%, ${parsed.cuts ?? 0} cut(s)`;
  return { x, y, summary };
}
