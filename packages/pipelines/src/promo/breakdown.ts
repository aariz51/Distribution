import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { PipelineError } from "@distribution/core";
import { bin, canonicalUrl, downloadArgv, parseDownloadOutput, parseVideoId, probeMedia, run } from "@distribution/media";

// ════════════════════════════════════════════════════════════════════════════
//  Reverse-engineering a reference video, as SKILL.md step 2 prescribes:
//  metadata, scene-cut detection (the number of cuts is itself a finding),
//  uniform sampling into timestamped contact sheets, and a frame-by-frame look
//  at the densest transition. The evidence is the same whether Opus 5.5 reads it
//  over OpenRouter or Claude Code reads it in a session.
// ════════════════════════════════════════════════════════════════════════════

export interface ContactSheet {
  path: string;
  /** seconds covered, first and last sampled frame */
  fromSec: number;
  toSec: number;
  cols: number;
  rows: number;
  /** timestamp of every tile, left to right, top to bottom */
  tiles: number[];
  kind: "uniform" | "dense";
}

export interface ReferenceEvidence {
  url: string;
  videoId: string;
  file: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
  cutTimes: number[];
  sheets: ContactSheet[];
  /** how the file was fetched: default client, or the mweb fallback after a 403 */
  fetchedWith: "default" | "mweb-fallback";
}

/** Download a reference (≤ 3 minutes considered), falling back to the mweb client on 403. */
export async function fetchReference(url: string, dir: string, signal?: AbortSignal): Promise<{ file: string; videoId: string; url: string; fetchedWith: ReferenceEvidence["fetchedWith"] }> {
  const id = parseVideoId(url);
  const canonical = canonicalUrl(id);
  try {
    const r = await run(bin("yt-dlp"), ["--no-playlist", "--download-sections", "*0-180", ...downloadArgv(id, dir, "200M")], { signal, timeoutMs: 6 * 60_000, step: "reference_download" });
    const file = parseDownloadOutput(r.stdout);
    if (file && path.resolve(file).startsWith(path.resolve(dir) + path.sep)) return { file, videoId: id, url: canonical, fetchedWith: "default" };
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  // SKILL.md: "If the download fails with HTTP 403 … fetch a progressive stream with another player client."
  const out = path.join(dir, `ref-${id}.mp4`);
  await run(bin("yt-dlp"), ["--no-playlist", "--extractor-args", "youtube:player_client=mweb", "-f", "18/b[height<=720]", "--no-warnings", "-o", out, "--", canonical], { signal, timeoutMs: 6 * 60_000, step: "reference_download" });
  if (!(await stat(out).then((s) => s.size > 0, () => false))) throw new PipelineError("could not download the inspiration video (both the default and fallback clients failed)", { step: "reference_download", retrySafe: true });
  return { file: out, videoId: id, url: canonical, fetchedWith: "mweb-fallback" };
}

/** Hard-cut timestamps from ffmpeg's scene score. */
export async function detectCuts(file: string, signal?: AbortSignal, threshold = 0.32): Promise<number[]> {
  const r = await run(bin("ffmpeg"), ["-hide_banner", "-i", file, "-vf", `select='gt(scene,${threshold})',showinfo`, "-an", "-f", "null", "-"], { signal, timeoutMs: 5 * 60_000, step: "reference_cuts" });
  const times = [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  return times.filter((t, i) => i === 0 || t - times[i - 1]! > 0.2);
}

async function sheets(file: string, dir: string, prefix: string, fromSec: number, toSec: number, count: number, cols: number, rows: number, kind: ContactSheet["kind"], signal?: AbortSignal): Promise<ContactSheet[]> {
  const span = toSec - fromSec;
  const rate = count / span;
  await run(bin("ffmpeg"), ["-v", "error", "-y", "-ss", fromSec.toFixed(3), "-t", span.toFixed(3), "-i", file, "-vf", `fps=${rate.toFixed(5)},scale=360:-2,tile=${cols}x${rows}`, "-q:v", "3", path.join(dir, `${prefix}_%02d.jpg`)], { signal, timeoutMs: 5 * 60_000, step: "reference_sheets" });
  const files = (await readdir(dir)).filter((f) => f.startsWith(`${prefix}_`) && f.endsWith(".jpg")).sort();
  const per = cols * rows;
  return files.map((f, i) => {
    const tiles = Array.from({ length: per }, (_, j) => i * per + j).filter((k) => k < count).map((k) => +(fromSec + (k + 0.5) / rate).toFixed(2));
    return { path: path.join(dir, f), fromSec: tiles[0] ?? fromSec, toSec: tiles.at(-1) ?? toSec, cols, rows, tiles, kind };
  });
}

/** Metadata, cuts and contact sheets for a downloaded reference. */
export async function referenceEvidence(fetched: { file: string; videoId: string; url: string; fetchedWith: ReferenceEvidence["fetchedWith"] }, dir: string, signal?: AbortSignal): Promise<ReferenceEvidence> {
  const probe = await probeMedia(fetched.file, { signal });
  if (!probe.hasVideo || probe.durationSec <= 0) throw new PipelineError("the inspiration video has no picture", { step: "reference", retrySafe: false });
  const duration = Math.min(probe.durationSec, 180);
  const cutTimes = (await detectCuts(fetched.file, signal)).filter((t) => t <= duration);
  // Uniform sampling: about one frame every 0.75s, 24–48 frames, 12 to a sheet.
  const count = Math.max(24, Math.min(48, Math.round(duration / 0.75)));
  const uniform = await sheets(fetched.file, dir, "uniform", 0, duration, count, 4, 3, "uniform", signal);
  // Frame-by-frame (8fps) over the 1.5s window with the most cuts: the signature transition.
  let dense: ContactSheet[] = [];
  if (cutTimes.length) {
    let best = cutTimes[0]!;
    let bestN = 0;
    for (const t of cutTimes) {
      const n = cutTimes.filter((u) => u >= t - 0.2 && u <= t + 1.3).length;
      if (n > bestN) [best, bestN] = [t, n];
    }
    const from = Math.max(0, best - 0.2);
    dense = await sheets(fetched.file, dir, "dense", from, Math.min(duration, from + 1.5), 12, 4, 3, "dense", signal);
  }
  return { url: fetched.url, videoId: fetched.videoId, file: fetched.file, durationSec: +duration.toFixed(2), fps: probe.fps ?? 0, width: probe.width ?? 0, height: probe.height ?? 0, hasAudio: probe.hasAudio, cutTimes, sheets: [...uniform, ...dense], fetchedWith: fetched.fetchedWith };
}

/** The words that go with the sheets, so a reader knows what each tile is. */
export function evidenceText(e: ReferenceEvidence): string {
  return [
    `REFERENCE ${e.url} — ${e.durationSec}s, ${e.width}×${e.height} @ ${e.fps}fps, ${e.hasAudio ? "has audio" : "silent"}.`,
    `Scene-cut detection found ${e.cutTimes.length} hard cuts${e.cutTimes.length ? ` at ${e.cutTimes.map((t) => t.toFixed(2)).join(", ")}s` : " (a continuous-camera film)"}.`,
    ...e.sheets.map((s, i) => `Sheet ${i + 1} (${s.kind === "dense" ? "frame-by-frame at 8fps over the densest transition" : "uniform sampling"}), ${s.cols}×${s.rows} tiles left→right, top→bottom, at ${s.tiles.map((t) => t.toFixed(2)).join(", ")}s.`),
  ].join("\n");
}

export async function sheetImages(e: ReferenceEvidence): Promise<Buffer[]> {
  return Promise.all(e.sheets.map((s) => readFile(s.path)));
}
