/**
 * LLM prompts ported verbatim from the AutoShorts desktop app.
 *
 * Rust `format!` strings and the Python f-string used `\`-continuations and
 * `{{ }}` escapes; those have been rendered to the exact text the model saw.
 * Interpolation slots are kept as `{name}` tokens (the same names the source
 * used, except `{len(lines)}` -> `{slot_count}`) and filled by `fillPrompt`.
 *
 * Templates are constants so a future edit is a one-line diff against the
 * source file cited above each one.
 */

/**
 * Candidate-detection prompt for the direct-vendor providers.
 * Source: `autoshorts/src-tauri/src/llm.rs:40-51` (DeepSeek). The Gemini
 * (:121-132), OpenAI (:198-209), Groq (:255-266) and Claude (:364-375) copies
 * are byte-identical, so it is exported once.
 *
 * Slots: `{segments}` (output of `compactSegments`).
 */
export const DETECTION_PROMPT =
  "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. " +
  "Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. " +
  "Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. " +
  "Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. " +
  "Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). " +
  "Return up to 25 candidates as JSON matching exactly this schema: " +
  '{"candidates":[{"start":0.0,"end":0.0,"score":0.0,"hook":"...","rationale":"..."}]}' +
  "\n\nTranscript:\n{segments}";

/**
 * System prompt for small local models (Ollama), which additionally hard-codes
 * the 30-90 s duration rule and forbids an empty list.
 * Source: `autoshorts/src-tauri/src/llm.rs:474-482`.
 * No slots; the transcript goes in the user turn (`DETECTION_USER_SMALL_MODEL`).
 */
export const DETECTION_PROMPT_SMALL_MODEL =
  "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. " +
  "Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. " +
  "Do NOT pick random or mediocre segments. Be ruthless in your selection. " +
  "Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. " +
  "CRITICAL: Each clip candidate MUST have a duration between 30 and 90 seconds (i.e. 'end' minus 'start' must be between 30.0 and 90.0). " +
  "Do NOT return short clips of less than 30 seconds. Combine multiple adjacent sentences to build a meaningful segment of 30-90 seconds. " +
  "Favor highly shareable content: concrete stories, strong opinions, emotional turns, surprising or counter-intuitive claims, clear payoffs, and high-energy/dramatic peaks. " +
  "You MUST identify and return at least 3-10 candidates. Do not return an empty candidates list. " +
  "Ensure the 'start' and 'end' values correspond to actual timestamps in the transcript. Do not output 0.0 for start and end times.";

/** User turn paired with `DETECTION_PROMPT_SMALL_MODEL`. Source: `llm.rs:484`. Slots: `{segments}`. */
export const DETECTION_USER_SMALL_MODEL = "Transcript:\n{segments}";

/**
 * System prompt for the OpenRouter editorial detector.
 * Source: `autoshorts/src-tauri/src/openrouter.rs:548-551`.
 */
export const EDITORIAL_DETECTION_SYSTEM =
  "You are a short-form video editor. You select clips from long interviews and lectures for Reels, TikTok and Shorts. " +
  "You are judged on whether a viewer who has seen none of the source video understands and finishes your clip, not on how exciting your description of it sounds.";

/**
 * User prompt for the OpenRouter editorial detector.
 * Source: `autoshorts/src-tauri/src/openrouter.rs:553-587`.
 * Slots: `{segments}`.
 *
 * Note "throat- clearing" reproduces the source exactly: the Rust literal broke
 * the line after "throat- \" so the rendered prompt carries that space.
 */
export const EDITORIAL_DETECTION_PROMPT =
  "Select the strongest self-contained short-form clips from this transcript.\n" +
  "\n" +
  "HARD RULES -- a clip breaking any of these is worthless:\n" +
  "1. START on a sentence boundary. Never mid-sentence, never mid-word.\n" +
  "2. END on a resolved thought. The last sentence must complete.\n" +
  "3. SELF-CONTAINED. If understanding it requires something said outside the clip's own window, reject it. No dangling 'as I mentioned', no unexplained pronouns referring outside the clip.\n" +
  "4. The FIRST SENTENCE must work as a hook on its own -- a claim, a question, or a correction of something the viewer believes. A clip that opens with throat- clearing or context-setting is rejected.\n" +
  "5. Duration between 20 and 90 seconds.\n" +
  "\n" +
  "PREFER, in this order:\n" +
  "  - A specific, checkable claim that contradicts common belief.\n" +
  "  - A concrete number, dose, threshold or named thing over a general statement.\n" +
  "  - Practical instruction the viewer can act on.\n" +
  "  - Emotional or narrative payoff that lands inside the window.\n" +
  "\n" +
  "REJECT: greetings, sign-offs, sponsor reads, cross-talk, list items that only make sense as part of the list, and anything whose payoff falls outside the clip.\n" +
  "\n" +
  "Score 0.0-1.0 on how likely a cold viewer is to watch to the end. Be harsh: most of a transcript is not clip material. Returning four excellent clips beats returning twenty mediocre ones.\n" +
  "\n" +
  "Return ONLY JSON matching this schema:\n" +
  '{"candidates":[{"start":0.0,"end":0.0,"score":0.0,"hook":"the opening line, verbatim from the transcript","rationale":"why a cold viewer finishes this"}]}\n' +
  "\n" +
  "Transcript (each line is `start-end  text`):\n" +
  "{segments}";

/**
 * On-screen title prompt.
 * Source: `autoshorts/src-tauri/src/title.rs:76-90`.
 * Slots: `{hook}`, `{transcript_excerpt}`.
 */
export const TITLE_PROMPT =
  "Write the on-screen title for a short vertical video.\n\n" +
  "Rules:\n" +
  "- 3 to 6 words. Never more than 6.\n" +
  "- Name the SPECIFIC thing this clip reveals, not the general topic. Two clips from the same video must get clearly different titles.\n" +
  '- Do NOT start with "The Truth About". Do not use "Secrets", "Exposed" or "You Won\'t Believe".\n' +
  "- Concrete nouns a viewer understands instantly. No quotes, no emoji, no trailing punctuation, no hashtags.\n\n" +
  'Good: "Bagels Beat Muffins For Sugar", "Kraft Bought Cadbury In 2010"\n' +
  'Bad: "The Truth About Food", "Shocking Facts Revealed"\n\n' +
  "Reply with the title only.\n\n" +
  "This clip's hook: {hook}\n\nWhat is said in this clip:\n{transcript_excerpt}";

/**
 * System prompt for social-post headline copy.
 * Source: `autoshorts/src-tauri/src/creative.rs:314-316`.
 */
export const CREATIVE_COPY_SYSTEM =
  "You write headlines for social posts promoting an app. You write plainly and specifically. " +
  "You never use hashtags, emoji, clickbait phrasing, or the words 'unlock', 'secret', 'shocking' or 'this one trick'.";

/**
 * User prompt for social-post headline copy.
 * Source: `autoshorts/src-tauri/src/creative.rs:328-350`.
 * Slots: `{brand_context}` (see `creativeBrandContext`), `{hook}`, `{clip_text}`.
 */
export const CREATIVE_COPY_USER =
  "{brand_context}\n" +
  "\n" +
  "Below is the transcript of a short video clip. Write the headline for the social post that carries it.\n" +
  "\n" +
  "RULES:\n" +
  "- The headline states the clip's single most surprising factual claim.\n" +
  "- Six to nine words. It will be set large, so it must fit.\n" +
  "- No hashtags, no emoji, no colon-subtitle construction.\n" +
  "- It must be true to the transcript. Do not invent a claim the clip does not make.\n" +
  "- Write it in sentence case, not Title Case.\n" +
  "\n" +
  'Also write a 2-4 word kicker: a short label that sits above the headline, like "What the label hides" or "The truth about additives".\n' +
  "\n" +
  'Return ONLY JSON: {"headline": "...", "kicker": "..."}\n' +
  "\n" +
  "The clip's opening line: {hook}\n" +
  "\n" +
  "Transcript:\n" +
  "{clip_text}";

/**
 * The `{brand_context}` line for `CREATIVE_COPY_USER`.
 * Source: `autoshorts/src-tauri/src/creative.rs:318-326`.
 */
export function creativeBrandContext(name: string, tagline?: string | null): string {
  return `The app is ${name}${tagline ? `, ${tagline}` : ""}.`;
}

/**
 * B-roll shot-plan prompt.
 * Source: `autoshorts/src-tauri/assets/broll_pipeline.py:63-94` (`plan_prompt`).
 * Slots: `{topic}`, `{slot_count}` (the Python `{len(lines)}`, used twice),
 * `{numbered}` (see `brollNumberedSlots`).
 */
export const BROLL_PLAN_PROMPT =
  "You are a short-form video editor choosing B-roll for a vertical clip.\n" +
  "\n" +
  "The clip is about: {topic}\n" +
  "\n" +
  "Below are {slot_count} consecutive ~1 second slots with the words spoken in each.\n" +
  "Decide what the viewer SEES in every slot. Return JSON only.\n" +
  "\n" +
  "Editorial rules you must follow:\n" +
  '- Slot 0 is always "source" (the speaker, for hook continuity).\n' +
  '- Return to "source" for 1 slot every 4 to 6 slots, for human continuity.\n' +
  '- Every other slot is "broll": real stock footage showing a literal, concrete\n' +
  "  visual of what is being said.\n" +
  "- The query must describe something filmable. Prefer physical nouns a camera can\n" +
  "  see -- a product, a place, an action -- over abstract ideas.\n" +
  "- Write queries for objects, food, packaging, documents, machinery, buildings and\n" +
  '  landscapes. Do NOT ask for people: no "man", "woman", "person", "shopper",\n' +
  '  "doctor", "family", "crowd". Footage containing people is discarded before it\n' +
  "  reaches the edit, so a query about people simply wastes the slot. Say\n" +
  '  "grocery shelves" rather than "shopper in aisle", "hands chopping vegetables"\n' +
  '  rather than "chef cooking".\n' +
  "- Never repeat the same broll query in adjacent slots.\n" +
  "\n" +
  "Schema, one entry per slot, exactly {slot_count} entries:\n" +
  '{"slots":[\n' +
  '  {"i":0,"kind":"source"},\n' +
  '  {"i":1,"kind":"broll","query":"two short concrete search words","description":"what is shown"}\n' +
  "]}\n" +
  "\n" +
  "Slots:\n" +
  "{numbered}";

/**
 * The `{numbered}` block for `BROLL_PLAN_PROMPT`: one `i: words` line per slot,
 * `(silence)` for an empty slot. Source: `broll_pipeline.py:64`.
 */
export function brollNumberedSlots(lines: readonly string[]): string {
  return lines.map((t, i) => `${i}: ${t || "(silence)"}`).join("\n");
}

/**
 * Fill `{name}` slots in a template. Only identifier-shaped tokens are
 * replaced, so the JSON schema examples (`{"candidates":...}`) are untouched.
 * Values are inserted literally (no `$` pattern expansion). A slot with no
 * value provided is left as-is so a missing argument is visible, not silent.
 */
export function fillPrompt(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-z_]+)\}/g, (token, name: string) => {
    const v = vars[name];
    return v === undefined ? token : String(v);
  });
}

/**
 * Line-start anchors that begin the per-clip input section of each prompt
 * above. Every one of them sits *after* the prompt's JSON-schema / output
 * instructions, which is what makes inserting before them safe.
 */
const INPUT_SECTION_ANCHORS: readonly string[] = [
  "Transcript:", // DETECTION_PROMPT, DETECTION_USER_SMALL_MODEL, CREATIVE_COPY_USER (second choice)
  "Transcript (each line is", // EDITORIAL_DETECTION_PROMPT
  "This clip's hook:", // TITLE_PROMPT
  "The clip's opening line:", // CREATIVE_COPY_USER
  "Slots:", // BROLL_PLAN_PROMPT
];

/**
 * Insert a `PRODUCT CONTEXT` section into a prompt (template or already
 * filled) so the model knows what product the clip is promoting.
 *
 * Placement: the block goes immediately before the earliest line that starts
 * the prompt's per-clip input section (`Transcript:`, `Transcript (each line
 * is...`, `This clip's hook:`, `The clip's opening line:` or `Slots:`),
 * separated by a blank line on each side. In every prompt in this module that
 * point is after the "Return ... JSON ... schema" instruction and before the
 * transcript / hook / slot data, so the output-format instruction stays intact
 * and the product context reads as part of the briefing rather than as part
 * of the transcript. The earliest anchor is used (not the last) so transcript
 * text that happens to contain an anchor word can never move the insertion.
 *
 * If no anchor is present (e.g. `DETECTION_PROMPT_SMALL_MODEL`, which is a
 * pure system prompt with the transcript in a separate user turn) the section
 * is appended after a blank line, which for an instructions-only prompt is the
 * natural place.
 *
 * `contextBlock` is what `productContextBlock()` from `@distribution/core`
 * returns. An empty / whitespace-only block leaves the prompt unchanged.
 */
export function withProductContext(prompt: string, contextBlock: string): string {
  const block = contextBlock.trim();
  if (block === "") return prompt;
  const section = `PRODUCT CONTEXT:\n${block}`;

  let insertAt = -1;
  for (const anchor of INPUT_SECTION_ANCHORS) {
    const idx = prompt.startsWith(anchor) ? 0 : indexOfLineStart(prompt, anchor);
    if (idx !== -1 && (insertAt === -1 || idx < insertAt)) insertAt = idx;
  }

  if (insertAt === -1) return `${prompt}\n\n${section}`;
  return `${prompt.slice(0, insertAt)}${section}\n\n${prompt.slice(insertAt)}`;
}

/** Index of `anchor` when it begins a line (preceded by `\n`), else -1. */
function indexOfLineStart(text: string, anchor: string): number {
  const idx = text.indexOf(`\n${anchor}`);
  return idx === -1 ? -1 : idx + 1;
}
