/**
 * Pure helpers from the AutoShorts OpenRouter client
 * (`autoshorts/src-tauri/src/openrouter.rs`): credential redaction, retry
 * policy, back-off, model tiering, and response-text extraction.
 *
 * The HTTP client itself is deliberately not here; a provider package owns
 * the network. Everything in this file is side-effect free.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Task tiering  (openrouter.rs:57-99)
// ---------------------------------------------------------------------------

/** What the model is being asked to do, which decides what it costs. */
export type Task = "reasoning" | "copy" | "utility" | "image";

export const TASKS: readonly Task[] = ["reasoning", "copy", "utility", "image"];

/** Env override name per tier, so a user can retune cost/quality without a rebuild. */
export const TASK_ENV_VARS: Readonly<Record<Task, string>> = {
  reasoning: "OPENROUTER_MODEL_REASONING",
  copy: "OPENROUTER_MODEL_COPY",
  utility: "OPENROUTER_MODEL_UTILITY",
  image: "OPENROUTER_MODEL_IMAGE",
};

/**
 * Defaults picked against live OpenRouter pricing rather than reputation.
 *
 * - reasoning: 1M context, strong instruction-following, ~8x cheaper than the
 *   frontier models and good enough at ranking that the difference does not
 *   show up in the finished clip.
 * - copy / utility: cheapest tier, but it must NOT be a reasoning model.
 *   `deepseek-v4-flash` spends the whole token budget thinking, returns
 *   `content: null` with `finish_reason: "length"`, and bills for it.
 * - image: background plates only; typography is drawn locally.
 */
export const TASK_DEFAULT_MODELS: Readonly<Record<Task, string>> = {
  reasoning: "google/gemini-2.5-flash",
  copy: "google/gemini-2.5-flash-lite",
  utility: "google/gemini-2.5-flash-lite",
  image: "google/gemini-2.5-flash-image",
};

/**
 * Model id for a task: the env override when set and non-blank, else the
 * default. `env` is passed in (rather than read from `process.env`) so the
 * function stays pure; callers hand it `process.env` if they want overrides.
 */
export function taskModel(task: Task, env: Readonly<Record<string, string | undefined>> = {}): string {
  const override = env[TASK_ENV_VARS[task]]?.trim();
  return override ? override : TASK_DEFAULT_MODELS[task];
}

// ---------------------------------------------------------------------------
// redact  (openrouter.rs:114-142)
// ---------------------------------------------------------------------------

/**
 * Strip anything shaped like a credential out of text bound for a log or the
 * UI. Every OpenRouter key starts `sk-or-`; Anthropic/OpenAI keys start
 * `sk-`. Matching the shorter prefix catches all three; the run of
 * `[A-Za-z0-9_-]` following it is replaced with `sk-***REDACTED***`.
 */
export function redact(text: string): string {
  let out = "";
  let rest = text;
  for (;;) {
    const idx = rest.indexOf("sk-");
    if (idx === -1) break;
    out += rest.slice(0, idx);
    out += "sk-***REDACTED***";
    const tail = rest.slice(idx);
    const m = /[^A-Za-z0-9_-]/.exec(tail);
    rest = m === null ? "" : tail.slice(m.index);
  }
  return out + rest;
}

// ---------------------------------------------------------------------------
// Retry policy  (openrouter.rs:241-262)
// ---------------------------------------------------------------------------

/** Attempts per request before giving up. */
export const MAX_ATTEMPTS = 5;

/**
 * Whether a failed attempt is worth repeating.
 *
 * A 400 will be just as malformed next time; a 429 or a gateway 5xx usually
 * clears. 408/409 are included because OpenRouter uses them for
 * upstream-provider hiccups.
 */
export function isRetryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Seconds to wait before attempt `attempt` (0-indexed).
 *
 * A `Retry-After` value (seconds; a header string is parsed with `u64`
 * semantics, unparsable -> ignored) wins over our guess but is capped at 120
 * so a hostile or buggy header cannot park the pipeline. Otherwise
 * 2, 4, 8, 16, 32, capped at 60.
 */
export function backoffSecs(attempt: number, retryAfter?: number | string | null): number {
  const hinted = typeof retryAfter === "string" ? parseRetryAfter(retryAfter) : (retryAfter ?? null);
  if (hinted !== null) return Math.min(hinted, 120);
  return Math.min(2 ** (attempt + 1), 60);
}

/** `Retry-After` header -> whole seconds, or `null` when it is not a plain non-negative integer. */
export function parseRetryAfter(header: string | null | undefined): number | null {
  if (header == null) return null;
  const t = header.trim();
  if (!/^\+?\d+$/.test(t)) return null;
  return Number(t.replace(/^\+/, ""));
}

// ---------------------------------------------------------------------------
// Chat-completions response shape  (openrouter.rs:160-224)
// ---------------------------------------------------------------------------

export const CompletionDetails = z.object({
  reasoning_tokens: z.number().default(0),
});
export type CompletionDetails = z.infer<typeof CompletionDetails>;

/** Token usage; OpenRouter reports actual dollar cost when asked. */
export const Usage = z.object({
  prompt_tokens: z.number().default(0),
  completion_tokens: z.number().default(0),
  cost: z.number().default(0),
  completion_tokens_details: CompletionDetails.default({ reasoning_tokens: 0 }),
});
export type Usage = z.infer<typeof Usage>;

const ImageUrl = z.object({ url: z.string().default("") });
const ImagePart = z.object({ image_url: ImageUrl.nullable().optional() });

const Message = z.object({
  content: z.string().nullable().optional(),
  /** Populated instead of `content` by reasoning models that run out of budget mid-thought. */
  reasoning: z.string().nullable().optional(),
  /** Image models return their output here rather than in `content`. */
  images: z.array(ImagePart).default([]),
});

const Choice = z.object({
  message: Message,
  finish_reason: z.string().nullable().optional(),
});

export const ChatResponse = z.object({
  choices: z.array(Choice).default([]),
  usage: Usage.nullable().optional(),
  /** OpenRouter can return HTTP 200 with an error object inside when the upstream failed. */
  error: z.object({ message: z.string() }).nullable().optional(),
});
export type ChatResponse = z.infer<typeof ChatResponse>;

/** Validate a decoded JSON body as a chat-completions response. */
export function parseChatResponse(json: unknown): ChatResponse {
  return ChatResponse.parse(json);
}

// ---------------------------------------------------------------------------
// extract_text  (openrouter.rs:337-379)
// ---------------------------------------------------------------------------

/**
 * Pull the assistant's text out of a response, or explain precisely why there
 * isn't any.
 *
 * The common cause of an empty reply is a reasoning model handed a small
 * `max_tokens`: it spends the budget in the hidden reasoning channel and
 * returns `content: null`. That is a configuration mistake with an obvious
 * fix, so it is named as one instead of being reported as an empty reply.
 */
export function extractText(parsed: ChatResponse, model: string): string {
  const choice = parsed.choices[0];
  if (choice === undefined) throw new Error(`${model} returned no choices`);

  const text = choice.message.content?.trim();
  if (text) return text;

  const reasoningTokens = parsed.usage?.completion_tokens_details.reasoning_tokens ?? 0;

  if (reasoningTokens > 0 || choice.message.reasoning != null) {
    throw new Error(
      `${model} is a reasoning model and spent its entire output budget thinking (${reasoningTokens} reasoning tokens) without producing an answer. Raise max_tokens, or point this task at a non-reasoning model.`,
    );
  }

  if (choice.finish_reason === "length") {
    throw new Error(`${model} hit the output token limit before returning anything. Raise max_tokens for this task.`);
  }

  throw new Error(`${model} returned an empty response (finish_reason: ${choice.finish_reason ?? "unknown"})`);
}

/** First image URL (data URI or remote) in a response, or `null`. Mirrors `generate_image`'s extraction. */
export function extractImageUrl(parsed: ChatResponse): string | null {
  const url = parsed.choices[0]?.message.images[0]?.image_url?.url;
  return url ? url : null;
}

// ---------------------------------------------------------------------------
// decode_image_payload / base64_decode  (openrouter.rs:452-506)
// ---------------------------------------------------------------------------

/**
 * Image models return either a `data:` URI or an ordinary URL.
 *
 * Only `data:` payloads are decoded. A remote URL is model-chosen text, so
 * the scheme is checked before anything could fetch it: a `file://` handed to
 * a fetcher is local file disclosure. Even HTTPS URLs are rejected here
 * because this function does no I/O; the caller fetches if it wants to.
 */
export function decodeImagePayload(url: string): Uint8Array {
  if (url.startsWith("data:")) {
    const rest = url.slice("data:".length);
    const sep = rest.indexOf(";base64,");
    if (sep === -1) throw new Error("image data URI was not base64");
    return base64Decode(rest.slice(sep + ";base64,".length));
  }
  if (!url.startsWith("https://")) {
    throw new Error("refusing to fetch model-supplied image from a non-HTTPS URL");
  }
  throw new Error("model returned a remote image URL; only inline data URIs are supported");
}

const B64_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Minimal base64 decoder: standard alphabet, `=` padding and ASCII whitespace
 * ignored, any other byte is an error.
 */
export function base64Decode(input: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "=" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") continue;
    const v = B64_TABLE.indexOf(ch);
    if (v === -1) throw new Error("invalid base64 in image payload");
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
