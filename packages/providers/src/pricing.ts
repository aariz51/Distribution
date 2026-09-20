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
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(k) || model.includes(k));
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
