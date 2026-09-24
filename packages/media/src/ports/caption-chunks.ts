/** Port of autoshorts `src-tauri/src/captions.rs` (`chunk_words`, the sidecar
 *  `Spec`) and `lib.rs` `generate_srt` / `format_srt_time`.
 *
 *  Captions are rasterised by a Pillow sidecar (`captions.py`) that reads a
 *  JSON spec on stdin and prints an ffmpeg concat list. This module produces
 *  that spec; spawning and temp-dir handling stay with the caller. */
import type { TranscriptWord } from "@distribution/core";
import { asU32 } from "./rust-format";

/** One on-screen phrase, times relative to the clip start. */
export interface Chunk {
  text: string;
  start: number;
  end: number;
}

/** stdin payload for `captions.py`, field names as serialised (`captions.rs:32-42`). */
export interface CaptionSpec {
  width: number;
  height: number;
  duration: number;
  style: string;
  /** Where the preset catalogue lives, so the renderer can load it. */
  assets: string;
  out_dir: string;
  chunks: Chunk[];
}

/** The built-in styles `captions.py` falls back to when a studio preset is not
 *  found; mirrors the drawtext styles. */
export const LEGACY_CAPTION_STYLES = [
  "classic-outline",
  "modern-box",
  "minimal-shadow",
  "vibrant-cyan",
  "vibrant-yellow-box",
  "vibrant-green",
  "vibrant-red",
] as const;
export type LegacyCaptionStyle = (typeof LEGACY_CAPTION_STYLES)[number];
/** `lib.rs:1042` and the sidecar both fall back to this. */
export const DEFAULT_CAPTION_STYLE: LegacyCaptionStyle = "modern-box";

export const TARGET_WORDS = 3;
export const MAX_WORDS = 4;
/** A silence at least this long ends the caption. */
export const BREAK_PAUSE = 0.34;

function endsSentence(text: string): boolean {
  const last = text.trimEnd().slice(-1);
  return last === "." || last === "!" || last === "?" || last === "," || last === ":" || last === ";";
}

/** Group words into short on-screen phrases (`captions.rs:116-182`). */
export function chunkWords(words: readonly TranscriptWord[], startSec: number, endSec: number): Chunk[] {
  const inRange = words.filter((w) => w.end > startSec && w.start < endSec);

  // Group first, so a break can be decided from the words around it.
  const groups: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];

  for (let i = 0; i < inRange.length; i++) {
    const word = inRange[i]!;
    current.push(word);

    const next = inRange[i + 1];
    const nextGap = next !== undefined ? next.start - word.end : Number.POSITIVE_INFINITY;

    const longEnough = current.length >= TARGET_WORDS;
    const full = current.length >= MAX_WORDS;
    const breaksHere = full || (longEnough && (endsSentence(word.text) || nextGap >= BREAK_PAUSE));

    if (breaksHere) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  // A caption of one word looks like a mistake next to its neighbours, so a
  // trailing orphan joins the group before it when there is room.
  if (groups.length >= 2) {
    const lastLen = groups[groups.length - 1]!.length;
    const prevLen = groups[groups.length - 2]!.length;
    if (lastLen === 1 && prevLen < MAX_WORDS) {
      const orphan = groups.pop()!;
      groups[groups.length - 1]!.push(...orphan);
    }
  }

  const out: Chunk[] = [];
  for (const group of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined) continue;
    // Times are relative to the clip: fast input seeking resets PTS.
    const start = Math.max(first.start - startSec, 0);
    const end = Math.min(last.end - startSec, endSec - startSec);
    if (end <= start) continue;
    const text = group
      .map((w) => w.text.trim())
      .filter((t) => t.length > 0)
      .join(" ")
      .toUpperCase();
    if (text.length === 0) continue;
    out.push({ text, start, end });
  }
  return out;
}

export interface CaptionSpecInput {
  words: readonly TranscriptWord[];
  startSec: number;
  endSec: number;
  width: number;
  height: number;
  style: string;
  /** Directory holding `captions.py`, `caption_styles.py`, `caption_styles.json`. */
  assets: string;
  /** Scratch directory the sidecar writes frames and `captions.txt` into. */
  outDir: string;
}

/** The pure prefix of `render_track` (`captions.rs:197-223`): `null` when
 *  captions cannot be produced (non-positive duration or size, no chunks), so
 *  the clip renders without them rather than failing. */
export function buildCaptionSpec(input: CaptionSpecInput): CaptionSpec | null {
  const duration = input.endSec - input.startSec;
  if (duration <= 0 || input.width <= 0 || input.height <= 0) return null;
  const chunks = chunkWords(input.words, input.startSec, input.endSec);
  if (chunks.length === 0) return null;
  return {
    width: input.width,
    height: input.height,
    duration,
    style: input.style,
    assets: input.assets,
    out_dir: input.outDir,
    chunks,
  };
}

/** `lib.rs` `format_srt_time`: `HH:MM:SS,mmm --> HH:MM:SS,mmm`. */
export function formatSrtTime(start: number, end: number): string {
  const formatTime = (secs: number): string => {
    const hours = asU32(secs / 3600);
    const mins = asU32((secs % 3600) / 60);
    const secsOnly = asU32(secs % 60);
    const ms = asU32((secs - Math.trunc(secs)) * 1000);
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secsOnly).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  };
  return `${formatTime(start)} --> ${formatTime(end)}`;
}

/** `lib.rs` `generate_srt`: fixed groups of three words, clip-relative times. */
export function generateSrt(words: readonly TranscriptWord[], startSec: number, endSec: number): string {
  let srt = "";
  let index = 1;

  const candidates = words.filter((w) => w.end > startSec && w.start < endSec);

  for (let i = 0; i < candidates.length; i += 3) {
    const chunk = candidates.slice(i, i + 3);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (first === undefined || last === undefined) continue;

    const startRel = Math.max(first.start - startSec, 0);
    const endRel = Math.max(Math.min(last.end - startSec, endSec - startSec), 0);

    const text = chunk.map((w) => w.text).join(" ");

    srt += `${index}\n`;
    srt += `${formatSrtTime(startRel, endRel)}\n`;
    srt += `${text}\n\n`;
    index += 1;
  }

  return srt;
}

/**
 * SRT built from the very chunks that were burned into the picture.
 *
 * `generateSrt` is the faithful port of the desktop app's sidecar writer, which
 * slices every three words regardless of pauses or punctuation. The overlay that
 * actually reaches the video is cut by `chunkWords`, which breaks on a pause or
 * a sentence end. Those two disagree, so the .srt a user downloads drifts out of
 * sync with the captions they can see. Deriving the file from the same chunks
 * makes the sidecar describe the picture.
 */
export function srtFromChunks(chunks: readonly Chunk[]): string {
  let srt = "";
  let index = 1;
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    srt += `${index}\n`;
    srt += `${formatSrtTime(chunk.start, chunk.end)}\n`;
    srt += `${text}\n\n`;
    index += 1;
  }
  return srt;
}
