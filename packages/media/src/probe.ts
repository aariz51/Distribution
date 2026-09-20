import { z } from "zod";
import { bin, run } from "./exec";

/** Port of autoshorts `media.rs:86-149` probe_media, same field semantics. */
export const MediaProbe = z.object({
  durationSec: z.number(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  fps: z.number().nullable(),
  videoCodec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  container: z.string().nullable(),
});
export type MediaProbe = z.infer<typeof MediaProbe>;

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
}
interface FfprobeOut {
  format?: { duration?: string; size?: string; format_name?: string };
  streams?: FfprobeStream[];
}

function parseRate(r: string | undefined): number | null {
  if (!r) return null;
  const [n, d] = r.split("/").map(Number);
  if (!n || !d) return null;
  return Math.round((n / d) * 1000) / 1000;
}

export async function probeMedia(path: string, opts: { signal?: AbortSignal } = {}): Promise<MediaProbe> {
  const res = await run(bin("ffprobe"), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], {
    timeoutMs: 60_000,
    signal: opts.signal,
    step: "probe",
  });
  const out = JSON.parse(res.stdout) as FfprobeOut;
  const v = out.streams?.find((s) => s.codec_type === "video");
  const a = out.streams?.find((s) => s.codec_type === "audio");
  return MediaProbe.parse({
    durationSec: Number(out.format?.duration ?? 0),
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps: parseRate(v?.avg_frame_rate ?? v?.r_frame_rate),
    videoCodec: v?.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    sizeBytes: out.format?.size ? Number(out.format.size) : null,
    container: out.format?.format_name ?? null,
  });
}

/** `ffmpeg -y -i src -vn -ac 1 -ar 16000 out.wav` — autoshorts `media.rs:151-173`. */
export async function extractAudio16k(src: string, out: string, opts: { signal?: AbortSignal; onProgress?: (sec: number) => void } = {}) {
  await run(bin("ffmpeg"), ["-y", "-hide_banner", "-nostats", "-loglevel", "error", "-progress", "pipe:2", "-i", src, "-vn", "-ac", "1", "-ar", "16000", out], {
    timeoutMs: 30 * 60_000,
    signal: opts.signal,
    step: "extract_audio",
    onStderrLine: (line) => {
      const m = /^out_time_ms=(\d+)/.exec(line);
      if (m && opts.onProgress) opts.onProgress(Number(m[1]) / 1_000_000);
    },
  });
}
