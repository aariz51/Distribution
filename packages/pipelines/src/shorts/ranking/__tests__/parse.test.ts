/**
 * Ported one-to-one from the `#[cfg(test)]` blocks of
 * `autoshorts/src-tauri/src/llm.rs:867-996`, `title.rs:159-185` and
 * `creative.rs` (parse_copy tests). Test titles are the Rust test names so
 * the mapping is greppable in both directions. Fixtures are the same data.
 */

import { describe, expect, it } from "vitest";
import type { CandidateDraft, NormalizedTranscript } from "@distribution/core";
import {
  compactSegments,
  extractJsonSpan,
  fallbackTitle,
  fmt2,
  parseCandidateJson,
  parseCopy,
  suppressOverlaps,
} from "../parse";

/** A transcript of `count` one-second segments, for parser tests. (llm.rs:887-903) */
function transcriptOf(count: number): NormalizedTranscript {
  return {
    language: "en",
    duration: count,
    speakers: ["Speaker"],
    words: [],
    segments: Array.from({ length: count }, (_, i) => ({ start: i, end: i + 1, text: "word" })),
  };
}

/** (llm.rs:948-950) */
function draft(start: number, end: number, score: number): CandidateDraft {
  return { startSec: start, endSec: end, score, hook: "h", rationale: "r", featureIds: [] };
}

describe("extract_json_span (llm.rs)", () => {
  it("extracts_json_wrapped_in_prose", () => {
    const reply = 'Sure! Here are the best moments:\n{"candidates":[]}\nHope that helps.';
    expect(extractJsonSpan(reply)).toBe('{"candidates":[]}');
  });

  it("ignores_braces_inside_strings", () => {
    const reply = 'text {"hook":"use } now","n":1} trailing';
    expect(extractJsonSpan(reply)).toBe('{"hook":"use } now","n":1}');
  });

  it("handles_escaped_quotes", () => {
    const reply = '{"hook":"she said \\"stop\\" firmly"}';
    expect(extractJsonSpan(reply)).toBe(reply);
  });

  it("returns_none_when_unbalanced", () => {
    expect(extractJsonSpan('{"candidates": [')).toBeNull();
  });
});

describe("parse_candidate_json (llm.rs)", () => {
  it("parses_prose_wrapped_candidates", () => {
    const reply = 'Here you go:\n{"candidates":[{"start":10.0,"end":50.0,"score":0.9,"hook":"h","rationale":"r"}]}';
    const parsed = parseCandidateJson(reply, transcriptOf(200));
    expect(parsed.length).toBe(1);
  });

  /** The regression that cost 23 of 24 clips: short moments were dropped
   *  outright instead of being extended to a publishable length. */
  it("short_moments_are_extended_not_discarded", () => {
    const reply = `{"candidates":[
            {"start":10.0,"end":22.0,"score":0.9,"hook":"a","rationale":"r"},
            {"start":80.0,"end":95.0,"score":0.8,"hook":"b","rationale":"r"},
            {"start":150.0,"end":160.0,"score":0.7,"hook":"c","rationale":"r"}]}`;
    const parsed = parseCandidateJson(reply, transcriptOf(200));
    expect(parsed.length, "every moment should survive").toBe(3);
    for (const c of parsed) {
      expect(c.endSec - c.startSec, `${JSON.stringify(c)} is still too short`).toBeGreaterThanOrEqual(30);
      expect(c.endSec, "extended past the end of the source").toBeLessThanOrEqual(200);
    }
  });

  /** Extending must not invent a boundary: the clip still starts and ends on
   *  a segment edge, so the cut never lands mid-sentence. */
  it("extension_lands_on_segment_boundaries", () => {
    const reply = '{"candidates":[{"start":10.0,"end":18.0,"score":0.9,"hook":"a","rationale":"r"}]}';
    const parsed = parseCandidateJson(reply, transcriptOf(200));
    const c = parsed[0]!;
    expect(c.startSec, "hook should stay at the start").toBe(10);
    expect(c.endSec % 1, "end should sit on a segment edge").toBe(0);
    expect(c.endSec - c.startSec).toBeGreaterThanOrEqual(30);
  });

  /** A moment at the very end of the source cannot extend forwards, so it
   *  must borrow from before the hook rather than be thrown away. */
  it("moment_at_the_end_extends_backwards", () => {
    const reply = '{"candidates":[{"start":192.0,"end":200.0,"score":0.9,"hook":"a","rationale":"r"}]}';
    const parsed = parseCandidateJson(reply, transcriptOf(200));
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.endSec - parsed[0]!.startSec).toBeGreaterThanOrEqual(30);
    expect(parsed[0]!.endSec).toBeLessThanOrEqual(200);
  });

  // --- Port-specific coverage of behaviour the Rust tests exercised only implicitly ---

  it("names the provider in the missing-array error (fixes the hard-coded 'Ollama')", () => {
    expect(() => parseCandidateJson('{"foo": 1}', transcriptOf(200), { provider: "Gemini" })).toThrow(
      /^Gemini output does not contain a candidates array\. Raw output: \{"foo": 1\}$/,
    );
    expect(() => parseCandidateJson('{"foo": 1}', transcriptOf(200))).toThrow(/^LLM output does not contain/);
  });

  it("reports a parse error when no JSON span exists", () => {
    expect(() => parseCandidateJson("no json here", transcriptOf(200))).toThrow(/^parsing candidate JSON: /);
  });

  it("accepts every container shape the Rust parser accepted", () => {
    const one = '{"start":10.0,"end":50.0,"score":0.9,"hook":"h","rationale":"r"}';
    const t = transcriptOf(200);
    expect(parseCandidateJson(`[${one}]`, t).length).toBe(1);
    for (const key of ["candidates", "Candidates", "moments", "clips", "segments", "results", "whatever"]) {
      expect(parseCandidateJson(`{"${key}":[${one}]}`, t).length, key).toBe(1);
    }
    expect(parseCandidateJson(one, t).length).toBe(1);
  });

  it("coerces strings and normalises scores like the Rust source", () => {
    const t = transcriptOf(200);
    const mk = (score: string) =>
      parseCandidateJson(`{"candidates":[{"start":"10","end":"50","score":${score},"hook":"h"}]}`, t)[0]!;
    expect(mk("7").score).toBeCloseTo(0.7);
    expect(mk("85").score).toBeCloseTo(0.85);
    expect(mk("500").score).toBe(1);
    expect(mk("-3").score).toBe(0);
    expect(mk('"0.4"').score).toBeCloseTo(0.4);
    expect(mk('"not a number"').score).toBeCloseTo(0.8);
    expect(mk("true").score).toBeCloseTo(0.8);
    const c = mk("0.9");
    expect(c.startSec).toBe(10);
    expect(c.endSec).toBe(50);
    expect(c.rationale).toBe("");
    expect(c.featureIds).toEqual([]);
  });

  it("strips code fences before parsing", () => {
    const body = '{"candidates":[{"start":10.0,"end":50.0,"score":0.9,"hook":"h","rationale":"r"}]}';
    expect(parseCandidateJson("```json\n" + body + "\n```", transcriptOf(200)).length).toBe(1);
    expect(parseCandidateJson("```\n" + body + "\n```", transcriptOf(200)).length).toBe(1);
  });

  it("drops empty hooks and falls back to the 5 s floor when nothing reaches the minimum", () => {
    const t = transcriptOf(200);
    expect(
      parseCandidateJson('{"candidates":[{"start":10.0,"end":50.0,"score":0.9,"hook":"  "}]}', t).length,
    ).toBe(0);
    // Short source: min duration is max(duration/2, 5) = 20 s. Nothing can be
    // extended to 20 s inside a 40 s source starting at 30, so the 5 s
    // fallback keeps it.
    const short: NormalizedTranscript = {
      ...transcriptOf(40),
      segments: [
        { start: 0, end: 30, text: "a" },
        { start: 30, end: 40, text: "b" },
      ],
    };
    const out = parseCandidateJson('{"candidates":[{"start":0.0,"end":30.0,"score":0.9,"hook":"h"}]}', short);
    expect(out.length).toBe(1);
    expect(out[0]!.endSec - out[0]!.startSec).toBeGreaterThanOrEqual(20);
  });

  it("sorts by score, suppresses overlaps and honours maxCandidates", () => {
    const items = Array.from(
      { length: 30 },
      (_, i) => `{"start":${i * 40},"end":${i * 40 + 35},"score":${(i % 10) / 10},"hook":"h${i}"}`,
    );
    const t = transcriptOf(1300);
    const all = parseCandidateJson(`{"candidates":[${items.join(",")}]}`, t);
    expect(all.length).toBe(25);
    for (let i = 1; i < all.length; i++) expect(all[i - 1]!.score).toBeGreaterThanOrEqual(all[i]!.score);
    expect(parseCandidateJson(`{"candidates":[${items.join(",")}]}`, t, { maxCandidates: 3 }).length).toBe(3);
  });
});

describe("suppress_overlaps (llm.rs)", () => {
  it("drops_candidate_contained_in_higher_scoring_one", () => {
    const out = suppressOverlaps([draft(65, 140, 0.94), draft(100, 140, 0.93)], 0.5);
    expect(out.length).toBe(1);
    expect(out[0]!.startSec).toBe(65);
  });

  it("keeps_adjacent_non_overlapping_moments", () => {
    const out = suppressOverlaps([draft(0, 60, 0.9), draft(60, 120, 0.8)], 0.5);
    expect(out.length).toBe(2);
  });

  it("keeps_slightly_overlapping_distinct_moments", () => {
    // 10s shared out of a 60s clip is a different moment, not a duplicate.
    const out = suppressOverlaps([draft(0, 60, 0.9), draft(50, 110, 0.8)], 0.5);
    expect(out.length).toBe(2);
  });

  it("highest_score_wins_within_an_overlapping_group", () => {
    const out = suppressOverlaps([draft(140, 180, 0.97), draft(140, 220, 0.85), draft(150, 175, 0.7)], 0.5);
    expect(out.length).toBe(1);
    expect(Math.abs(out[0]!.score - 0.97)).toBeLessThan(1e-9);
  });
});

describe("compact_segments (llm.rs)", () => {
  it("renders [start-end] Speaker: text lines with two decimals", () => {
    const text = compactSegments([
      { start: 0, end: 1.5, text: "hello", speaker: "Host" },
      { start: 1.5, end: 3.25, text: "world" },
    ]);
    expect(text).toBe("[0.00-1.50] Host: hello\n[1.50-3.25] Speaker: world");
  });

  it("fmt2 rounds exact ties half-to-even like Rust's {:.2}", () => {
    expect(fmt2(0.125)).toBe("0.12");
    expect(fmt2(0.375)).toBe("0.38");
    expect(fmt2(-0.125)).toBe("-0.12");
    expect(fmt2(2.5)).toBe("2.50");
    expect(fmt2(1.005)).toBe("1.00"); // not an exact tie in binary; same as Rust
    expect(fmt2(12.345)).toBe(Number(12.345).toFixed(2));
  });
});

describe("fallback_title (title.rs)", () => {
  it("fallback_keeps_the_opening_words", () => {
    const t = fallbackTitle(
      "Ultra-processed foods trigger an addictive response so powerful that people cannot stop",
      null,
    );
    expect(t.split(/\s+/).length, t).toBeLessThanOrEqual(6);
    expect(t.startsWith("Ultra-processed"), t).toBe(true);
  });

  it("fallback_handles_an_empty_hook", () => {
    expect(fallbackTitle("   ", "SafeChoice")).toBe("SafeChoice");
    expect(fallbackTitle("", null)).toBe("Watch This");
  });

  it("fallback_strips_leading_punctuation_and_trailing_commas", () => {
    const t = fallbackTitle('"So, here is the thing,', null);
    expect(t.startsWith('"'), t).toBe(false);
    expect(t.endsWith(","), t).toBe(false);
  });
});

describe("parse_copy (creative.rs)", () => {
  it("parses_plain_json_copy", () => {
    const copy = parseCopy('{"headline": "Organic does not mean pesticide free", "kicker": "What the label hides"}');
    expect(copy.headline).toBe("Organic does not mean pesticide free");
    expect(copy.kicker).toBe("What the label hides");
  });

  /** Models wrap JSON in fences even when told not to, so the parser has to
   *  cope rather than the prompt having to win every time. */
  it("parses_fenced_and_prefixed_copy", () => {
    for (const raw of [
      '```json\n{"headline": "A claim", "kicker": "Label"}\n```',
      'Here you go:\n{"headline": "A claim", "kicker": "Label"}\nHope that helps!',
      '```\n{"headline": "A claim", "kicker": "Label"}\n```',
    ]) {
      const copy = parseCopy(raw);
      expect(copy.headline, `failed on ${JSON.stringify(raw)}`).toBe("A claim");
    }
  });

  it("kicker_is_optional_but_headline_is_not", () => {
    const copy = parseCopy('{"headline": "Just this"}');
    expect(copy.kicker).toBeNull();

    expect(() => parseCopy('{"kicker": "no headline here"}')).toThrow();
    // An empty headline is as useless as a missing one.
    expect(() => parseCopy('{"headline": "   "}')).toThrow();
    expect(() => parseCopy("not json at all")).toThrow();
  });

  it("whitespace_only_kicker_is_dropped_not_rendered", () => {
    const copy = parseCopy('{"headline": "A claim", "kicker": "   "}');
    expect(copy.kicker, "a blank kicker would render as an empty accent line").toBeNull();
  });
});
