import { describe, expect, it } from "vitest";
import type { TranscriptWord } from "@distribution/core";
import {
  DEFAULT_CAPTION_STYLE,
  srtFromChunks,
  LEGACY_CAPTION_STYLES,
  MAX_WORDS,
  buildCaptionSpec,
  chunkWords,
  formatSrtTime,
  generateSrt,
} from "../caption-chunks";

function word(text: string, start: number, end: number): TranscriptWord {
  return { text, start, end };
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// One-to-one with captions.rs `mod tests`.
describe("chunkWords (captions.rs tests)", () => {
  it("groups_words_and_rebases_times_to_the_clip", () => {
    const words = [word("so", 10.0, 10.4), word("I", 10.4, 10.6), word("was", 10.6, 11.0), word("told", 11.0, 11.4)];
    const out = chunkWords(words, 10.0, 12.0);
    expect(out.length, "four words fit in one caption").toBe(1);
    expect(out[0]!.text).toBe("SO I WAS TOLD");
    expect(Math.abs(out[0]!.start - 0.0), "times are clip-relative").toBeLessThan(1e-9);
  });

  /// A caption should end where a reader would pause, not at an arbitrary
  /// word count -- "OFFER. THE" reads as a mistake.
  it("breaks_after_a_sentence_ends", () => {
    const words = [
      word("we", 0.0, 0.3),
      word("rejected", 0.3, 0.8),
      word("it.", 0.8, 1.1),
      word("the", 1.1, 1.3),
      word("board", 1.3, 1.7),
      word("agreed", 1.7, 2.2),
    ];
    const out = chunkWords(words, 0.0, 3.0);
    expect(out[0]!.text).toBe("WE REJECTED IT.");
    expect(out[1]!.text).toBe("THE BOARD AGREED");
  });

  /// A long silence means the thought ended, so the caption should too.
  it("breaks_on_a_long_pause", () => {
    const words = [
      word("they", 0.0, 0.3),
      word("said", 0.3, 0.7),
      word("nothing", 0.7, 1.2),
      word("then", 2.4, 2.7),
      word("everything", 2.7, 3.4),
      word("changed", 3.4, 3.9),
    ];
    const out = chunkWords(words, 0.0, 5.0);
    expect(out[0]!.text).toBe("THEY SAID NOTHING");
    expect(out[1]!.text).toBe("THEN EVERYTHING CHANGED");
  });

  /// Never leave a single word stranded on its own caption.
  it("a_trailing_orphan_joins_the_previous_caption", () => {
    const words = [word("one", 0.0, 0.3), word("two", 0.3, 0.6), word("three", 0.6, 0.9), word("four", 0.9, 1.2)];
    const out = chunkWords(words, 0.0, 2.0);
    for (const c of out) {
      expect(wordCount(c.text), `caption ${JSON.stringify(c.text)} is a lone word`).toBeGreaterThanOrEqual(2);
    }
  });

  /// Captions stay within the on-screen limit however long the sentence is.
  it("never_exceeds_the_word_cap", () => {
    const words = Array.from({ length: 20 }, (_, i) => word("word", i * 0.3, i * 0.3 + 0.25));
    const out = chunkWords(words, 0.0, 10.0);
    for (const c of out) {
      expect(wordCount(c.text), `caption ${JSON.stringify(c.text)} exceeds ${MAX_WORDS} words`).toBeLessThanOrEqual(MAX_WORDS);
    }
  });

  it("keeps_punctuation_that_drawtext_would_strip", () => {
    const out = chunkWords([word("don't", 0.0, 0.5), word("panic!", 0.5, 1.0)], 0.0, 2.0);
    expect(out[0]!.text).toBe("DON'T PANIC!");
  });

  it("excludes_words_outside_the_clip", () => {
    const words = [word("before", 0.0, 1.0), word("inside", 5.0, 5.5), word("after", 20.0, 21.0)];
    const out = chunkWords(words, 4.0, 6.0);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("INSIDE");
  });
});

describe("chunkWords (port additions)", () => {
  it("a trailing orphan stays alone when the previous caption is full", () => {
    const words = Array.from({ length: 5 }, (_, i) => word(`w${i}`, i * 0.3, i * 0.3 + 0.25));
    const out = chunkWords(words, 0.0, 5.0);
    expect(out.map((c) => c.text)).toEqual(["W0 W1 W2 W3", "W4"]);
  });

  it("clamps end times to the clip and drops empty or inverted groups", () => {
    const out = chunkWords([word("edge", 9.5, 12.0)], 8.0, 10.0);
    expect(out).toEqual([{ text: "EDGE", start: 1.5, end: 2.0 }]);
    // Starts before the clip: start is clamped to 0.
    expect(chunkWords([word("early", 7.0, 9.0)], 8.0, 10.0)).toEqual([{ text: "EARLY", start: 0, end: 1.0 }]);
    // Whitespace-only text never becomes a caption.
    expect(chunkWords([word("   ", 0.0, 1.0)], 0.0, 2.0)).toEqual([]);
  });

  it("a pause just under the threshold does not break", () => {
    const words = [word("a", 0.0, 0.3), word("b", 0.3, 0.6), word("c", 0.6, 0.9), word("d", 0.9 + 0.33, 1.5)];
    expect(chunkWords(words, 0.0, 3.0).map((c) => c.text)).toEqual(["A B C D"]);
    const paused = [word("a", 0.0, 0.3), word("b", 0.3, 0.6), word("c", 0.6, 0.9), word("d", 1.25, 1.5), word("e", 1.5, 1.8)];
    expect(chunkWords(paused, 0.0, 3.0).map((c) => c.text)).toEqual(["A B C", "D E"]);
  });
});

describe("buildCaptionSpec", () => {
  const words = [word("so", 10.0, 10.4), word("I", 10.4, 10.6), word("was", 10.6, 11.0)];
  const base = { words, startSec: 10, endSec: 12, width: 1080, height: 1920, style: "modern-box", assets: "/data/captions", outDir: "/tmp/captions-1" };

  it("serialises with the sidecar's field names and order", () => {
    const spec = buildCaptionSpec(base);
    expect(spec).toEqual({
      width: 1080,
      height: 1920,
      duration: 2,
      style: "modern-box",
      assets: "/data/captions",
      out_dir: "/tmp/captions-1",
      chunks: [{ text: "SO I WAS", start: 0, end: 1 }],
    });
    expect(Object.keys(spec!)).toEqual(["width", "height", "duration", "style", "assets", "out_dir", "chunks"]);
  });

  it("returns null when captions cannot be produced", () => {
    expect(buildCaptionSpec({ ...base, endSec: 10 })).toBeNull();
    expect(buildCaptionSpec({ ...base, width: 0 })).toBeNull();
    expect(buildCaptionSpec({ ...base, height: -1 })).toBeNull();
    expect(buildCaptionSpec({ ...base, words: [] })).toBeNull();
  });

  it("exposes the seven legacy styles with modern-box as the default", () => {
    expect(LEGACY_CAPTION_STYLES).toEqual([
      "classic-outline",
      "modern-box",
      "minimal-shadow",
      "vibrant-cyan",
      "vibrant-yellow-box",
      "vibrant-green",
      "vibrant-red",
    ]);
    expect(DEFAULT_CAPTION_STYLE).toBe("modern-box");
  });
});

describe("generateSrt / formatSrtTime (lib.rs)", () => {
  it("formats HH:MM:SS,mmm with truncation", () => {
    expect(formatSrtTime(0, 7.5)).toBe("00:00:00,000 --> 00:00:07,500");
    expect(formatSrtTime(3661.25, 3725.5)).toBe("01:01:01,250 --> 01:02:05,500");
    // `as u32` truncates: 1.9999 s is 999 ms, not 1000.
    expect(formatSrtTime(1.9999, 2)).toBe("00:00:01,999 --> 00:00:02,000");
    // Negative and NaN saturate to zero like `f64 as u32`.
    expect(formatSrtTime(-3, Number.NaN)).toBe("00:00:00,000 --> 00:00:00,000");
  });

  it("emits fixed three-word cues with clip-relative, clamped times", () => {
    const words = [
      word("Hello", 1.0, 1.5),
      word("there,", 1.5, 2.0),
      word("world", 2.0, 2.5),
      word("again", 2.5, 3.0),
      word("outside", 20.0, 21.0),
    ];
    // 2.75 - 0.5 is exact in binary; a non-representable span truncates a
    // millisecond in Rust and here alike.
    expect(generateSrt(words, 0.5, 2.75)).toBe(
      "1\n00:00:00,500 --> 00:00:02,000\nHello there, world\n\n" + "2\n00:00:02,000 --> 00:00:02,250\nagain\n\n",
    );
    expect(generateSrt(words, 30, 40)).toBe("");
  });

  it("keeps the original casing and does not trim words", () => {
    expect(generateSrt([word(" a ", 0, 1), word("B", 1, 2)], 0, 5)).toBe("1\n00:00:00,000 --> 00:00:02,000\n a  B\n\n");
  });
});

describe("srtFromChunks (the sidecar must describe the picture)", () => {
  const words: TranscriptWord[] = [
    { text: "The", start: 10.0, end: 10.2 },
    { text: "FDA", start: 10.2, end: 10.5 },
    { text: "allows", start: 10.5, end: 10.9 },
    { text: "companies.", start: 10.9, end: 11.4 },
    { text: "They", start: 12.6, end: 12.8 },
    { text: "decide", start: 12.8, end: 13.2 },
    { text: "themselves", start: 13.2, end: 13.9 },
  ];

  it("emits exactly one cue per rendered chunk", () => {
    const chunks = chunkWords(words, 10, 14);
    const cues = srtFromChunks(chunks).trim().split(/\n\n/).filter(Boolean);
    expect(cues).toHaveLength(chunks.length);
  });

  it("carries each chunk's own text and timing, not a re-slice of the words", () => {
    const chunks = chunkWords(words, 10, 14);
    const srt = srtFromChunks(chunks);
    const first = chunks[0]!;
    expect(srt).toContain(formatSrtTime(first.start, first.end));
    expect(srt).toContain(first.text);
  });

  it("never spans the pause that the burned-in captions break on", () => {
    // 1.2s of silence sits between "companies." and "They"; a cue that covered
    // both would be a subtitle drifting away from what is on screen.
    for (const cue of srtFromChunks(chunkWords(words, 10, 14)).trim().split(/\n\n/)) {
      expect(cue).not.toMatch(/COMPANIES\.\s+THEY/i);
    }
  });

  it("skips blank chunks instead of writing empty cues", () => {
    expect(srtFromChunks([{ text: "   ", start: 0, end: 1 }])).toBe("");
  });
});
