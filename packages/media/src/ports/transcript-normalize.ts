/** Port of autoshorts `src-tauri/src/transcription.rs` (the pure parts):
 *  Deepgram and Whisper raw JSON into the shared `NormalizedTranscript`. */
import { NormalizedTranscript, PipelineError, type TranscriptSegment, type TranscriptWord } from "@distribution/core";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function asF64(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
/** serde `as_i64`: only integral JSON numbers. */
function asI64(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) ? v : undefined;
}
function pointer(root: unknown, segments: (string | number)[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (!isObj(cur)) return undefined;
      cur = cur[seg];
    }
    if (cur === undefined) return undefined;
  }
  return cur;
}

function fail(message: string): PipelineError {
  return new PipelineError(message, { retrySafe: false, step: "transcribe" });
}

/** `build_segments` (`transcription.rs:98-138`): a new segment on a pause
 *  longer than 0.9 s, a speaker change, or after sentence-ending punctuation. */
export function buildSegments(words: readonly TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const word of words) {
    let shouldBreak = false;
    if (current !== null) {
      const pause = word.start - current.end;
      const speakerChanged = current.speaker !== word.speaker;
      const last = current.text.slice(-1);
      const sentenceEnd = last === "." || last === "!" || last === "?";
      shouldBreak = pause > 0.9 || speakerChanged || sentenceEnd;
    }

    if (shouldBreak && current !== null) {
      segments.push(current);
      current = null;
    }

    if (current !== null) {
      current.end = word.end;
      current.text = `${current.text} ${word.text}`;
    } else {
      current = {
        start: word.start,
        end: word.end,
        ...(word.speaker !== undefined ? { speaker: word.speaker } : {}),
        text: word.text,
      };
    }
  }

  if (current !== null) segments.push(current);
  return segments;
}

/** `normalize_deepgram` (`transcription.rs:32-96`). Throws `PipelineError`
 *  when the response has no alternative or no word timestamps. */
export function normalizeDeepgram(value: unknown): NormalizedTranscript {
  const alternative = pointer(value, ["results", "channels", 0, "alternatives", 0]);
  if (alternative === undefined || alternative === null) {
    throw fail("Deepgram response did not include an alternative transcript");
  }

  const language = asStr(pointer(value, ["metadata", "language"])) ?? "en";
  const duration = asF64(pointer(value, ["metadata", "duration"])) ?? 0;

  const rawWords = isObj(alternative) ? alternative.words : undefined;
  if (!Array.isArray(rawWords)) throw fail("Deepgram response did not include word timestamps");

  const speakers = new Set<string>();
  const words: TranscriptWord[] = [];

  for (const word of rawWords) {
    const w = isObj(word) ? word : {};
    // `get("punctuated_word").or_else(|| get("word"))`: the key being present
    // wins even when its value is not a string.
    const textSource = "punctuated_word" in w ? w.punctuated_word : w.word;
    const text = (asStr(textSource) ?? "").trim();
    if (text.length === 0) continue;

    const speakerIdx = asI64(w.speaker);
    const speaker = speakerIdx !== undefined ? `S${speakerIdx + 1}` : undefined;
    if (speaker !== undefined) speakers.add(speaker);

    words.push({
      text,
      start: asF64(w.start) ?? 0,
      end: asF64(w.end) ?? 0,
      ...(speaker !== undefined ? { speaker } : {}),
    });
  }

  const segments = buildSegments(words);

  return NormalizedTranscript.parse({
    language,
    duration,
    // BTreeSet<String>: sorted by code unit, which `sort()` matches for ASCII labels.
    speakers: [...speakers].sort(),
    words,
    segments,
  });
}

/** `normalize_whisper_raw_json` (`transcription.rs:160-212`): every word and
 *  segment is attributed to `S1`; duration is the last segment's end. */
export function normalizeWhisperRawJson(raw: unknown): NormalizedTranscript {
  const root = isObj(raw) ? raw : {};
  const language = asStr(root.language) ?? "en";

  const segmentsArr = root.segments;
  if (!Array.isArray(segmentsArr)) throw fail("Missing 'segments' in Whisper JSON");

  const lastSeg = segmentsArr[segmentsArr.length - 1];
  const duration = (isObj(lastSeg) ? asF64(lastSeg.end) : undefined) ?? 0;

  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];

  for (const segRaw of segmentsArr) {
    const seg = isObj(segRaw) ? segRaw : {};
    const start = asF64(seg.start) ?? 0;
    const end = asF64(seg.end) ?? 0;
    const text = (asStr(seg.text) ?? "").trim();

    segments.push({ start, end, speaker: "S1", text });

    const wordsArr = seg.words;
    if (Array.isArray(wordsArr)) {
      for (const wRaw of wordsArr) {
        const w = isObj(wRaw) ? wRaw : {};
        words.push({
          text: (asStr(w.word) ?? "").trim(),
          start: asF64(w.start) ?? 0,
          end: asF64(w.end) ?? 0,
          speaker: "S1",
        });
      }
    }
  }

  return NormalizedTranscript.parse({
    language,
    duration,
    speakers: ["S1"],
    words,
    segments,
  });
}
