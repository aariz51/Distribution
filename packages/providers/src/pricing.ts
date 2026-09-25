import { BudgetExceededError } from "@distribution/core";
import type { ChatRequest } from "./types";
/** USD per 1M tokens (input, output). Estimates for cost tracking only; update
 *  when providers change prices. Unknown models cost 0 and are flagged. */
const PRICES: Record<string, [number, number]> = {
  "anthropic/claude-sonnet-4.5": [3, 15],
  // OpenRouter list prices (checked 2026-09-25).
  "anthropic/claude-opus-5.5": [4, 20],
  "anthropic/claude-opus-5": [5, 25],
  "anthropic/claude-sonnet-5": [2, 10],
  "anthropic/claude-haiku-4.5": [1, 5],
  "claude-sonnet-4-5": [3, 15],
  "claude-haiku-4-5": [1, 5],
  "google/gemini-2.5-flash": [0.3, 2.5],
  "google/gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-2.5-flash": [0.3, 2.5],
  "deepseek-chat": [0.27, 1.1],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4.1-mini": [0.4, 1.6],
  "llama-3.3-70b-versatile": [0.59, 0.79],
};

export function estimateChatUsd(model: string, inputTokens: number, outputTokens: number): { usd: number; known: boolean } {
  const key = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => model === k || model.startsWith(k) || model.includes(k));
  if (!key) return { usd: 0, known: false };
  const [i, o] = PRICES[key]!;
  return { usd: (inputTokens * i + outputTokens * o) / 1_000_000, known: true };
}

/** STT: USD per audio minute. */
export const STT_PRICE_PER_MIN: Record<string, number> = {
  "deepgram:nova-2": 0.0043,
  "groq:whisper-large-v3": 0.00185,
  "openai:whisper-1": 0.006,
  "whisper-local:base": 0,
};

/** Conservative pre-call estimate including every transport retry. This is not an invoice guarantee. */
export function reserveChatUsd(model: string, req: ChatRequest, maxTokens: number, attempts: number, local = false): number {
  if (local) return 0;
  const inputTokens = Buffer.byteLength(req.system ?? "") + req.messages.reduce((total, message) => total + 32 + (typeof message.content === "string"
    ? Buffer.byteLength(message.content)
    : message.content.reduce((n, part) => n + (part.type === "text" ? Buffer.byteLength(part.text) : imageTokenCeiling(part.data)), 0)), 0);
  const estimate = estimateChatUsd(model, inputTokens, maxTokens);
  if (!estimate.known) throw new BudgetExceededError(`No pricing configured for ${model}; add its rate before making paid calls`);
  return estimate.usd * attempts;
}

/**
 * Upper bound on the tokens one image costs. Vision models resize large images
 * (Anthropic to about 1.15 megapixels, roughly width × height / 750 ≈ 1,600
 * tokens), so an image never costs its byte size. Reads PNG/JPEG dimensions
 * from the header; an unreadable header gets the ceiling for a full-size image.
 */
export function imageTokenCeiling(data: Buffer): number {
  const dims = imageSize(data);
  if (!dims) return 3300;
  const scale = Math.min(1, Math.sqrt(1_150_000 / (dims.w * dims.h)));
  return Math.ceil((dims.w * scale * dims.h * scale) / 750) + 100;
}

function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}
