import { describe, expect, it } from "vitest";
import { PipelineError, type TranscriptWord } from "@distribution/core";
import { buildSegments, normalizeDeepgram, normalizeWhisperRawJson } from "../transcript-normalize";

const w = (text: string, start: number, end: number, speaker?: string): TranscriptWord => ({
  text,
  start,
  end,
  ...(speaker !== undefined ? { speaker } : {}),
});

describe("buildSegments (transcription.rs:98-138)", () => {
  it("joins consecutive words of one speaker into one segment", () => {
    expect(buildSegments([w("we", 0, 0.3, "S1"), w("agreed", 0.3, 0.8, "S1")])).toEqual([
      { start: 0, end: 0.8, speaker: "S1", text: "we agreed" },
    ]);
  });

  it("breaks on a pause strictly longer than 0.9 s", () => {
    const same = buildSegments([w("a", 0, 0.5, "S1"), w("b", 1.4, 1.8, "S1")]);
    expect(same).toHaveLength(1);
    const split = buildSegments([w("a", 0, 0.5, "S1"), w("b", 1.41, 1.8, "S1")]);
    expect(split.map((s) => s.text)).toEqual(["a", "b"]);
  });

  it("breaks when the speaker changes, including to or from no speaker", () => {
    expect(buildSegments([w("a", 0, 0.5, "S1"), w("b", 0.5, 1.0, "S2")]).map((s) => s.speaker)).toEqual(["S1", "S2"]);
    const anon = buildSegments([w("a", 0, 0.5), w("b", 0.5, 1.0, "S1")]);
    expect(anon).toHaveLength(2);
    expect(anon[0]).not.toHaveProperty("speaker");
    expect(anon[1]!.speaker).toBe("S1");
    expect(buildSegments([w("a", 0, 0.5), w("b", 0.5, 1.0)])).toEqual([{ start: 0, end: 1.0, text: "a b" }]);
  });

  it("breaks after . ! ? but not after a comma", () => {
    const words = [w("Yes.", 0, 0.3, "S1"), w("No!", 0.3, 0.6, "S1"), w("Why?", 0.6, 0.9, "S1"), w("well,", 0.9, 1.2, "S1"), w("ok", 1.2, 1.5, "S1")];
    expect(buildSegments(words).map((s) => s.text)).toEqual(["Yes.", "No!", "Why?", "well, ok"]);
  });

  it("returns nothing for no words", () => {
    expect(buildSegments([])).toEqual([]);
  });
});

describe("normalizeDeepgram (transcription.rs:32-96)", () => {
  const fixture = {
    metadata: { language: "en", duration: 12.5 },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "Hello there. Hi back",
              words: [
                { word: "hello", punctuated_word: "Hello", start: 0.0, end: 0.4, speaker: 1 },
                { word: "there", punctuated_word: "there.", start: 0.4, end: 0.8, speaker: 1 },
                { word: "hi", punctuated_word: "Hi", start: 1.0, end: 1.3, speaker: 0 },
                { word: "", start: 1.3, end: 1.4, speaker: 0 },
                { word: "back", start: 1.4, end: 1.8, speaker: 0 },
              ],
            },
          ],
        },
      ],
    },
  };

  it("maps words, labels speakers S<n+1>, and sorts the speaker set", () => {
    const t = normalizeDeepgram(fixture);
    expect(t.language).toBe("en");
    expect(t.duration).toBe(12.5);
    expect(t.speakers).toEqual(["S1", "S2"]);
    expect(t.words).toEqual([
      { text: "Hello", start: 0.0, end: 0.4, speaker: "S2" },
      { text: "there.", start: 0.4, end: 0.8, speaker: "S2" },
      { text: "Hi", start: 1.0, end: 1.3, speaker: "S1" },
      { text: "back", start: 1.4, end: 1.8, speaker: "S1" },
    ]);
    expect(t.segments).toEqual([
      { start: 0.0, end: 0.8, speaker: "S2", text: "Hello there." },
      { start: 1.0, end: 1.8, speaker: "S1", text: "Hi back" },
    ]);
  });

  it("prefers punctuated_word when the key is present, even if unusable", () => {
    const t = normalizeDeepgram({
      results: { channels: [{ alternatives: [{ words: [{ word: "kept", punctuated_word: null, start: 0, end: 1 }, { word: "fallback", start: 1, end: 2 }] }] }] },
    });
    expect(t.words.map((x) => x.text)).toEqual(["fallback"]);
    expect(t.words[0]).not.toHaveProperty("speaker");
    expect(t.speakers).toEqual([]);
  });

  it("defaults language to en and duration to 0, and ignores non-integer speakers", () => {
    const t = normalizeDeepgram({
      results: { channels: [{ alternatives: [{ words: [{ word: "x", start: 0, end: 1, speaker: 1.5 }] }] }] },
    });
    expect(t.language).toBe("en");
    expect(t.duration).toBe(0);
    expect(t.words[0]).not.toHaveProperty("speaker");
  });

  it("sorts speaker labels like BTreeSet<String>", () => {
    const words = [9, 0, 1].map((s, i) => ({ word: `w${i}`, start: i, end: i + 0.5, speaker: s }));
    const t = normalizeDeepgram({ results: { channels: [{ alternatives: [{ words }] }] } });
    expect(t.speakers).toEqual(["S1", "S10", "S2"]);
  });

  it("throws PipelineError when the alternative or word list is missing", () => {
    expect(() => normalizeDeepgram({ results: { channels: [] } })).toThrow(PipelineError);
    expect(() => normalizeDeepgram({ results: { channels: [] } })).toThrow("Deepgram response did not include an alternative transcript");
    expect(() => normalizeDeepgram({ results: { channels: [{ alternatives: [{ transcript: "x" }] }] } })).toThrow(
      "Deepgram response did not include word timestamps",
    );
  });
});

describe("normalizeWhisperRawJson (transcription.rs:160-212)", () => {
  const fixture = {
    language: "de",
    segments: [
      {
        start: 0,
        end: 1.2,
        text: " Hallo Welt ",
        words: [
          { word: " Hallo", start: 0, end: 0.5 },
          { word: " Welt", start: 0.5, end: 1.2 },
        ],
      },
      { start: 1.5, end: 3.0, text: "Zweiter" },
    ],
  };

  it("attributes everything to S1 and takes duration from the last segment", () => {
    const t = normalizeWhisperRawJson(fixture);
    expect(t).toEqual({
      language: "de",
      duration: 3.0,
      speakers: ["S1"],
      words: [
        { text: "Hallo", start: 0, end: 0.5, speaker: "S1" },
        { text: "Welt", start: 0.5, end: 1.2, speaker: "S1" },
      ],
      segments: [
        { start: 0, end: 1.2, speaker: "S1", text: "Hallo Welt" },
        { start: 1.5, end: 3.0, speaker: "S1", text: "Zweiter" },
      ],
    });
  });

  it("defaults language to en, missing numbers to 0, and keeps empty words", () => {
    const t = normalizeWhisperRawJson({ segments: [{ text: "x", words: [{ word: "  " }] }] });
    expect(t.language).toBe("en");
    expect(t.duration).toBe(0);
    expect(t.segments).toEqual([{ start: 0, end: 0, speaker: "S1", text: "x" }]);
    expect(t.words).toEqual([{ text: "", start: 0, end: 0, speaker: "S1" }]);
    expect(normalizeWhisperRawJson({ segments: [] })).toEqual({ language: "en", duration: 0, speakers: ["S1"], words: [], segments: [] });
  });

  it("throws PipelineError without a segments array", () => {
    expect(() => normalizeWhisperRawJson({ language: "en" })).toThrow(PipelineError);
    expect(() => normalizeWhisperRawJson({ segments: "nope" })).toThrow("Missing 'segments' in Whisper JSON");
  });
});
