/**
 * Pure parsing / post-processing of LLM replies, ported from the AutoShorts
 * desktop app (`src-tauri/src/llm.rs`, `title.rs`, `creative.rs`).
 *
 * Behaviour is preserved to the source, including its quirks, so the ported
 * Rust unit tests pass unchanged. The single intended deviation is noted on
 * `parseCandidateJson`.
 */

import type { CandidateDraft, NormalizedTranscript, TranscriptSegment } from "@distribution/core";

// ---------------------------------------------------------------------------
// compact_segments  (llm.rs:542-554)
// ---------------------------------------------------------------------------

/**
 * Render segments as `[start-end] Speaker: text` lines, one per segment, two
 * decimals on the timestamps. `Speaker` is the placeholder when a segment has
 * no speaker label.
 */
export function compactSegments(segments: readonly TranscriptSegment[]): string {
  return segments
    .map((segment) => {
      const speaker = segment.speaker ?? "Speaker";
      return `[${fmt2(segment.start)}-${fmt2(segment.end)}] ${speaker}: ${segment.text}`;
    })
    .join("\n");
}

/**
 * Rust's `{:.2}`: exact decimal expansion rounded half-to-even. JS `toFixed`
 * rounds exact ties away from zero (`(0.125).toFixed(2) === "0.13"`; Rust
 * prints `0.12`), so ties are detected and corrected. A double can only be an
 * exact tie at two decimals when it is an odd multiple of 1/8 (the only
 * dyadic rationals whose third decimal is a 5), and `x * 8` is exact, so that
 * is the test. Everything else is not a tie and `toFixed` agrees with Rust.
 */
export function fmt2(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? "inf" : x < 0 ? "-inf" : "NaN";
  const eighths = x * 8;
  if (Number.isInteger(eighths) && Math.abs(eighths) % 2 === 1) {
    const lower = Math.floor(Math.abs(eighths) * 12.5); // hundredths just below the tie
    const even = lower % 2 === 0 ? lower : lower + 1;
    return `${x < 0 ? "-" : ""}${(even / 100).toFixed(2)}`;
  }
  return x.toFixed(2);
}

// ---------------------------------------------------------------------------
// extract_json_span  (llm.rs:556-594)
// ---------------------------------------------------------------------------

/**
 * Find the first balanced JSON object or array inside a model reply.
 *
 * Not every model can be pinned to JSON mode; brace matching (skipping over
 * string literals and escaped quotes) recovers the payload from surrounding
 * prose. Returns `null` when there is no opener or it is never closed.
 */
export function extractJsonSpan(text: string): string | null {
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[") {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const b = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (b === "\\") {
        escaped = true;
      } else if (b === '"') {
        inString = false;
      }
      continue;
    }
    if (b === '"') {
      inString = true;
    } else if (b === open) {
      depth += 1;
    } else if (b === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// segment_boundaries / fit_to_min_duration  (llm.rs:596-644)
// ---------------------------------------------------------------------------

/** Boundaries a clip may be cut on: every segment edge, sorted, deduplicated within 10 ms. */
export function segmentBoundaries(transcript: Pick<NormalizedTranscript, "segments">): number[] {
  const edges = transcript.segments.flatMap((s) => [s.start, s.end]).sort(totalCmp);
  const out: number[] = [];
  for (const e of edges) {
    const last = out[out.length - 1];
    if (last !== undefined && Math.abs(e - last) < 0.01) continue;
    out.push(e);
  }
  return out;
}

/**
 * Grow a too-short candidate to `minDuration` along segment boundaries,
 * mutating it in place.
 *
 * Models reliably return the *moment* (a 12 s reveal) rather than a
 * publishable clip. Extending to the surrounding segment edges keeps the cut
 * on a sentence boundary while making the clip long enough to stand alone.
 * Forwards first so the hook stays at the start; backwards only when the clip
 * already runs to the end of the source.
 */
export function fitToMinDuration(
  candidate: CandidateDraft,
  boundaries: readonly number[],
  minDuration: number,
  total: number,
): void {
  if (candidate.endSec - candidate.startSec >= minDuration) return;

  const forward = boundaries.find((e) => e > candidate.endSec && e - candidate.startSec >= minDuration);
  if (forward !== undefined) candidate.endSec = Math.min(forward, total);

  if (candidate.endSec - candidate.startSec < minDuration) {
    for (let i = boundaries.length - 1; i >= 0; i--) {
      const e = boundaries[i]!;
      if (e < candidate.startSec && candidate.endSec - e >= minDuration) {
        candidate.startSec = Math.max(e, 0);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// parse_candidate_json  (llm.rs:646-829)
// ---------------------------------------------------------------------------

export interface ParseCandidateOptions {
  /**
   * Name used in the "output does not contain a candidates array" error.
   * The Rust source hard-coded "Ollama" for every provider; this port names
   * the provider that actually produced the text.
   */
  provider?: string;
  /** Cap on returned candidates after overlap suppression (Rust: `MAX_CANDIDATES` env, default 25). */
  maxCandidates?: number;
}

const CANDIDATE_KEYS = ["candidates", "Candidates", "moments", "clips", "segments", "results"] as const;

/**
 * Turn a model reply into publishable candidate drafts.
 *
 * Steps, in order: strip code fences -> `JSON.parse` -> fall back to the first
 * balanced JSON span -> accept a bare array, an object with one of
 * `candidates|Candidates|moments|clips|segments|results`, the first
 * array-valued key, or a single `{start,end}` object -> coerce start/end/score
 * from number or string -> normalise score to 0..1 (÷10, ÷100, clamp) ->
 * extend short clips to the minimum duration along segment edges -> keep
 * clips at least that long with a non-empty hook (falling back to ≥ 5 s) ->
 * sort by score -> drop clips that mostly repeat a higher-scoring one ->
 * truncate to `maxCandidates`.
 *
 * Minimum duration is 30 s, or half the source length (≥ 5 s) for sources
 * under 60 s.
 */
export function parseCandidateJson(
  text: string,
  transcript: NormalizedTranscript,
  opts: ParseCandidateOptions = {},
): CandidateDraft[] {
  const provider = opts.provider ?? "LLM";
  const cap = opts.maxCandidates ?? 25;

  const minDuration = transcript.duration < 60 ? Math.max(transcript.duration * 0.5, 5) : 30;
  const boundaries = segmentBoundaries(transcript);
  const total = transcript.duration;
  const trimmed = stripFences(text);

  let val: unknown;
  try {
    val = JSON.parse(trimmed);
  } catch (directErr) {
    // Fall back to carving the JSON out of surrounding prose.
    const span = extractJsonSpan(trimmed);
    if (span === null) throw new Error(`parsing candidate JSON: ${errorMessage(directErr)}`);
    try {
      val = JSON.parse(span);
    } catch (spanErr) {
      throw new Error(`parsing candidate JSON: ${errorMessage(spanErr)}`);
    }
  }

  let candidatesArr: unknown[] | null = null;
  if (Array.isArray(val)) {
    candidatesArr = val;
  } else if (isObject(val)) {
    let found: unknown[] | null = null;
    for (const key of CANDIDATE_KEYS) {
      const v = val[key];
      if (Array.isArray(v)) {
        found = v;
        break;
      }
    }
    if (found === null) {
      for (const value of Object.values(val)) {
        if (Array.isArray(value)) {
          found = value;
          break;
        }
      }
    }
    if (found !== null) {
      candidatesArr = found;
    } else if (val["start"] !== undefined && val["end"] !== undefined) {
      candidatesArr = [val];
    }
  }

  if (candidatesArr === null) {
    throw new Error(`${provider} output does not contain a candidates array. Raw output: ${trimmed}`);
  }

  const drafts: CandidateDraft[] = [];
  for (const item of candidatesArr) {
    const obj = isObject(item) ? item : {};
    const start = coerceNumber(obj["start"], 0);
    const end = coerceNumber(obj["end"], 0);
    let score = coerceNumber(obj["score"], 0.8);

    if (score > 1 && score <= 10) {
      score /= 10;
    } else if (score > 10 && score <= 100) {
      score /= 100;
    } else if (score > 100) {
      score = 1;
    } else if (score < 0) {
      score = 0;
    }

    const hook = typeof obj["hook"] === "string" ? obj["hook"] : "";
    const rationale = typeof obj["rationale"] === "string" ? obj["rationale"] : "";

    drafts.push({ startSec: start, endSec: end, score, hook, rationale, featureIds: [] });
  }

  for (const draft of drafts) fitToMinDuration(draft, boundaries, minDuration, total);

  let candidates = drafts.filter((c) => c.endSec - c.startSec >= minDuration && c.hook.trim() !== "");
  if (candidates.length === 0) {
    candidates = drafts.filter((c) => c.endSec - c.startSec >= 5 && c.hook.trim() !== "");
  }

  candidates.sort((a, b) => totalCmp(b.score, a.score));
  return suppressOverlaps(candidates, 0.5).slice(0, cap);
}

// ---------------------------------------------------------------------------
// suppress_overlaps  (llm.rs:831-865)
// ---------------------------------------------------------------------------

/**
 * Drop candidates that mostly repeat a higher-scoring one.
 *
 * Input must already be sorted by score, best first. Overlap is measured
 * against the *shorter* candidate, not the union: a 30 s clip wholly inside a
 * 90 s one is a duplicate even though it covers only a third of it. Zero or
 * negative-length candidates are dropped outright.
 */
export function suppressOverlaps(sortedByScore: readonly CandidateDraft[], maxOverlap: number): CandidateDraft[] {
  const kept: CandidateDraft[] = [];

  for (const candidate of sortedByScore) {
    const duration = candidate.endSec - candidate.startSec;
    if (duration <= 0) continue;

    const duplicatesExisting = kept.some((k) => {
      const overlap = Math.min(candidate.endSec, k.endSec) - Math.max(candidate.startSec, k.startSec);
      if (overlap <= 0) return false;
      const shorter = Math.min(duration, k.endSec - k.startSec);
      return shorter > 0 && overlap / shorter > maxOverlap;
    });

    if (!duplicatesExisting) kept.push(candidate);
  }

  return kept;
}

// ---------------------------------------------------------------------------
// fallback_title  (title.rs:48-58)
// ---------------------------------------------------------------------------

/**
 * Shorten a hook into a headline without calling a model: strip leading
 * non-alphanumerics, keep the first six words, drop trailing `, . ; :`.
 * An empty hook yields `projectName`, or "Watch This".
 */
export function fallbackTitle(hook: string, projectName?: string | null): string {
  const cleaned = hook.trim().replace(/^[^\p{Alphabetic}\p{N}]+/u, "");
  const words = cleaned.split(/\s+/).filter((w) => w !== "").slice(0, 6);
  if (words.length === 0) return projectName ?? "Watch This";
  return words.join(" ").replace(/[,.;:]+$/, "");
}

// ---------------------------------------------------------------------------
// parse_copy  (creative.rs:364-400)
// ---------------------------------------------------------------------------

export interface CreativeCopy {
  headline: string;
  kicker: string | null;
}

/**
 * Read the model's `{"headline","kicker"}` JSON, tolerating code fences and
 * surrounding prose (the object is carved from the first `{` to the last `}`).
 * A missing or blank headline is an error; a missing or blank kicker is `null`.
 */
export function parseCopy(text: string): CreativeCopy {
  const trimmed = stripFences(text);

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    const s = trimmed.indexOf("{");
    const e = trimmed.lastIndexOf("}");
    const candidate = s !== -1 && e !== -1 && e > s ? trimmed.slice(s, e + 1) : trimmed;
    try {
      value = JSON.parse(candidate);
    } catch (err) {
      throw new Error(`parsing creative copy JSON: ${errorMessage(err)}`);
    }
  }

  const obj = isObject(value) ? value : {};
  const headlineRaw = obj["headline"];
  const headline = typeof headlineRaw === "string" ? headlineRaw.trim() : "";
  if (headline === "") throw new Error("model returned no headline");

  const kickerRaw = obj["kicker"];
  const kickerTrimmed = typeof kickerRaw === "string" ? kickerRaw.trim() : "";
  const kicker = kickerTrimmed === "" ? null : kickerTrimmed;

  return { headline, kicker };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Rust's fence stripping: `trim()`, then repeatedly strip leading "```json",
 * then leading "```", then trailing "```", then `trim()` again. Order matters
 * and is preserved (a "```json\n" prefix leaves the "\n" for the final trim).
 */
function stripFences(text: string): string {
  let s = text.trim();
  while (s.startsWith("```json")) s = s.slice("```json".length);
  while (s.startsWith("```")) s = s.slice(3);
  while (s.endsWith("```")) s = s.slice(0, -3);
  return s.trim();
}

/**
 * Mirror of the Rust coercion: a JSON number is used as-is, a string is parsed
 * with `f64::from_str` semantics (falling back to `dflt` on failure), anything
 * else (missing, null, bool, object, array) is `dflt`.
 */
function coerceNumber(v: unknown, dflt: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = parseF64(v);
    return parsed === null ? dflt : parsed;
  }
  return dflt;
}

/** Rust `str::parse::<f64>`: no surrounding whitespace, optional sign, decimal or exponent forms, `inf`/`infinity`/`nan`. */
const F64_RE = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf|infinity|nan)$/i;
function parseF64(s: string): number | null {
  if (!F64_RE.test(s)) return null;
  const lower = s.toLowerCase();
  const neg = lower.startsWith("-");
  const body = lower.replace(/^[+-]/, "");
  if (body === "inf" || body === "infinity") return neg ? -Infinity : Infinity;
  if (body === "nan") return NaN;
  return Number(s);
}

/** `f64::total_cmp`: a total order where NaN sorts above +inf and -0 below +0. */
function totalCmp(a: number, b: number): number {
  const an = Number.isNaN(a);
  const bn = Number.isNaN(b);
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  if (a === 0 && b === 0) {
    const aNeg = 1 / a < 0;
    const bNeg = 1 / b < 0;
    return aNeg === bNeg ? 0 : aNeg ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
