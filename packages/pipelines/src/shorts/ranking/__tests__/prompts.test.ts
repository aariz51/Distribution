/**
 * The Rust/Python sources had no unit tests for the prompt text itself; these
 * pin the rendered strings against the source and cover the two helpers this
 * port adds (`fillPrompt`, `withProductContext`).
 */

import { describe, expect, it } from "vitest";
import {
  BROLL_PLAN_PROMPT,
  CREATIVE_COPY_SYSTEM,
  CREATIVE_COPY_USER,
  DETECTION_PROMPT,
  DETECTION_PROMPT_SMALL_MODEL,
  DETECTION_USER_SMALL_MODEL,
  EDITORIAL_DETECTION_PROMPT,
  EDITORIAL_DETECTION_SYSTEM,
  TITLE_PROMPT,
  brollNumberedSlots,
  creativeBrandContext,
  fillPrompt,
  withProductContext,
} from "../prompts";

const CONTEXT = "PRODUCT: LabelWise — Ingredient & Additive Checker\nCATEGORY: health";

describe("prompt text", () => {
  it("DETECTION_PROMPT matches llm.rs:40-51 (schema line and transcript tail)", () => {
    expect(DETECTION_PROMPT.startsWith("You are an elite, world-class social media strategist")).toBe(true);
    expect(DETECTION_PROMPT).toContain(
      'Return up to 25 candidates as JSON matching exactly this schema: {"candidates":[{"start":0.0,"end":0.0,"score":0.0,"hook":"...","rationale":"..."}]}\n\nTranscript:\n{segments}',
    );
    // Rust `\`-continuations joined the body into one line; only the tail has newlines.
    expect(DETECTION_PROMPT.slice(0, DETECTION_PROMPT.indexOf("\n\nTranscript:"))).not.toContain("\n");
  });

  it("DETECTION_PROMPT_SMALL_MODEL carries the hard 30-90 s rule and no slots", () => {
    expect(DETECTION_PROMPT_SMALL_MODEL).toContain("CRITICAL: Each clip candidate MUST have a duration between 30 and 90 seconds");
    expect(DETECTION_PROMPT_SMALL_MODEL).toContain("Do not output 0.0 for start and end times.");
    expect(DETECTION_PROMPT_SMALL_MODEL).not.toMatch(/\{[a-z_]+\}/);
    expect(DETECTION_USER_SMALL_MODEL).toBe("Transcript:\n{segments}");
  });

  it("EDITORIAL_DETECTION_PROMPT reproduces the Rust line joins, including 'throat- clearing'", () => {
    expect(EDITORIAL_DETECTION_SYSTEM).toContain("You are a short-form video editor. You select clips from long interviews");
    expect(EDITORIAL_DETECTION_PROMPT).toContain("A clip that opens with throat- clearing or context-setting is rejected.\n5. Duration between 20 and 90 seconds.\n\nPREFER, in this order:\n  - A specific");
    expect(EDITORIAL_DETECTION_PROMPT).toContain(
      'Return ONLY JSON matching this schema:\n{"candidates":[{"start":0.0,"end":0.0,"score":0.0,"hook":"the opening line, verbatim from the transcript","rationale":"why a cold viewer finishes this"}]}\n\nTranscript (each line is `start-end  text`):\n{segments}',
    );
    expect(EDITORIAL_DETECTION_PROMPT.endsWith("{segments}")).toBe(true);
  });

  it("TITLE_PROMPT renders title.rs:76-90 escapes", () => {
    expect(TITLE_PROMPT).toBe(
      "Write the on-screen title for a short vertical video.\n\nRules:\n- 3 to 6 words. Never more than 6.\n- Name the SPECIFIC thing this clip reveals, not the general topic. Two clips from the same video must get clearly different titles.\n- Do NOT start with \"The Truth About\". Do not use \"Secrets\", \"Exposed\" or \"You Won't Believe\".\n- Concrete nouns a viewer understands instantly. No quotes, no emoji, no trailing punctuation, no hashtags.\n\nGood: \"Bagels Beat Muffins For Sugar\", \"Kraft Bought Cadbury In 2010\"\nBad: \"The Truth About Food\", \"Shocking Facts Revealed\"\n\nReply with the title only.\n\nThis clip's hook: {hook}\n\nWhat is said in this clip:\n{transcript_excerpt}",
    );
  });

  it("CREATIVE_COPY prompts and brand context match creative.rs:314-350", () => {
    expect(CREATIVE_COPY_SYSTEM).toContain("the words 'unlock', 'secret', 'shocking' or 'this one trick'.");
    expect(CREATIVE_COPY_USER.startsWith("{brand_context}\n\nBelow is the transcript of a short video clip. Write the headline for the social post that carries it.\n\nRULES:\n")).toBe(true);
    expect(CREATIVE_COPY_USER).toContain('Return ONLY JSON: {"headline": "...", "kicker": "..."}\n\nThe clip\'s opening line: {hook}\n\nTranscript:\n{clip_text}');
    expect(creativeBrandContext("LabelWise", "Ingredient & Additive Checker")).toBe("The app is LabelWise, Ingredient & Additive Checker.");
    expect(creativeBrandContext("LabelWise")).toBe("The app is LabelWise.");
    expect(creativeBrandContext("LabelWise", null)).toBe("The app is LabelWise.");
  });

  it("BROLL_PLAN_PROMPT matches broll_pipeline.py:63-94 with {slot_count} for len(lines)", () => {
    expect(BROLL_PLAN_PROMPT.startsWith("You are a short-form video editor choosing B-roll for a vertical clip.\n\nThe clip is about: {topic}\n\nBelow are {slot_count} consecutive ~1 second slots")).toBe(true);
    expect(BROLL_PLAN_PROMPT).toContain(
      'Schema, one entry per slot, exactly {slot_count} entries:\n{"slots":[\n  {"i":0,"kind":"source"},\n  {"i":1,"kind":"broll","query":"two short concrete search words","description":"what is shown"}\n]}\n\nSlots:\n{numbered}',
    );
    expect(brollNumberedSlots(["hello there", "", "bye"])).toBe("0: hello there\n1: (silence)\n2: bye");
  });
});

describe("fillPrompt", () => {
  it("fills named slots, leaves JSON braces and unknown slots alone, and does not expand $ patterns", () => {
    const out = fillPrompt(DETECTION_PROMPT, { segments: "[0.00-1.00] A: costs $1 and $& more" });
    expect(out.endsWith("Transcript:\n[0.00-1.00] A: costs $1 and $& more")).toBe(true);
    expect(out).toContain('{"candidates":[{"start":0.0');
    expect(fillPrompt("{a} {b}", { a: 1 })).toBe("1 {b}");
    const broll = fillPrompt(BROLL_PLAN_PROMPT, { topic: "t", slot_count: 2, numbered: brollNumberedSlots(["x", "y"]) });
    expect(broll).toContain("Below are 2 consecutive");
    expect(broll).toContain("exactly 2 entries");
    expect(broll.endsWith("Slots:\n0: x\n1: y")).toBe(true);
  });
});

describe("withProductContext", () => {
  const section = `PRODUCT CONTEXT:\n${CONTEXT}\n\n`;

  it("inserts after the JSON schema and before the transcript in DETECTION_PROMPT", () => {
    const out = withProductContext(DETECTION_PROMPT, CONTEXT);
    expect(out).toContain(`"rationale":"..."}]}\n\n${section}Transcript:\n{segments}`);
    expect(out.indexOf("PRODUCT CONTEXT")).toBeGreaterThan(out.indexOf("this schema"));
  });

  it("works on an already-filled prompt and ignores anchors inside the transcript", () => {
    const filled = fillPrompt(DETECTION_PROMPT, { segments: "[0.00-1.00] A: hi\nTranscript: not an anchor" });
    const out = withProductContext(filled, CONTEXT);
    expect(out.split("PRODUCT CONTEXT").length - 1).toBe(1);
    expect(out).toContain(`${section}Transcript:\n[0.00-1.00] A: hi\nTranscript: not an anchor`);
  });

  it("inserts before 'Transcript (each line is' in EDITORIAL_DETECTION_PROMPT", () => {
    const out = withProductContext(EDITORIAL_DETECTION_PROMPT, CONTEXT);
    expect(out).toContain(`this"}]}\n\n${section}Transcript (each line is`);
  });

  it("inserts before the hook line in TITLE_PROMPT", () => {
    const out = withProductContext(TITLE_PROMPT, CONTEXT);
    expect(out).toContain(`Reply with the title only.\n\n${section}This clip's hook: {hook}`);
  });

  it("inserts before the opening line (not the later Transcript:) in CREATIVE_COPY_USER", () => {
    const out = withProductContext(CREATIVE_COPY_USER, CONTEXT);
    expect(out).toContain(`"kicker": "..."}\n\n${section}The clip's opening line: {hook}\n\nTranscript:\n{clip_text}`);
    expect(out.split("PRODUCT CONTEXT").length - 1).toBe(1);
  });

  it("inserts before Slots: in BROLL_PLAN_PROMPT", () => {
    const out = withProductContext(BROLL_PLAN_PROMPT, CONTEXT);
    expect(out).toContain(`]}\n\n${section}Slots:\n{numbered}`);
  });

  it("appends to an instructions-only prompt and is a no-op for an empty block", () => {
    expect(withProductContext(DETECTION_PROMPT_SMALL_MODEL, CONTEXT)).toBe(
      `${DETECTION_PROMPT_SMALL_MODEL}\n\nPRODUCT CONTEXT:\n${CONTEXT}`,
    );
    expect(withProductContext(DETECTION_PROMPT, "   ")).toBe(DETECTION_PROMPT);
    // A prompt that *starts* with an anchor still gets the block in front.
    expect(withProductContext(DETECTION_USER_SMALL_MODEL, CONTEXT)).toBe(`${section}Transcript:\n{segments}`);
  });
});
