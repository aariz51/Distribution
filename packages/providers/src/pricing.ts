import { BudgetExceededError } from "@distribution/core";
import type { ChatRequest } from "./types";
/** USD per 1M tokens (input, output). Estimates for cost tracking only; update
 *  when providers change prices. Unknown models cost 0 and are flagged. */
const PRICES: Record<string, [number, number]> = {
  "anthropic/claude-sonnet-4.5": [3, 15],
  "anthropic/claude-opus-5": [15, 75],
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
    : message.content.reduce((n, part) => n + (part.type === "text" ? Buffer.byteLength(part.text) : 65536), 0)), 0);
  const estimate = estimateChatUsd(model, inputTokens, maxTokens);
  if (!estimate.known) throw new BudgetExceededError(`No pricing configured for ${model}; add its rate before making paid calls`);
  return estimate.usd * attempts;
}
