import type { z } from "zod";

export type ProviderId = "openrouter" | "anthropic" | "deepseek" | "openai" | "groq" | "gemini" | "ollama";

export type ContentPart = { type: "text"; text: string } | { type: "image"; mimeType: string; data: Buffer };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ContentPart[];
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Ask for a JSON object. Providers that reject `response_format` retry without it. */
  json?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResponse {
  text: string;
  usage: Usage;
  provider: ProviderId;
  model: string;
  /** milliseconds spent in the successful attempt */
  latencyMs: number;
  attempts: number;
}

export type Purpose = "rank" | "title" | "copy" | "storyboard" | "vision" | "broll_plan" | "creative_copy" | "extract" | "promo_direction" | "promo_vision";

export interface UsageSink {
  (u: { provider: ProviderId; model: string; kind: "chat" | "stt"; purpose?: string; inputTokens?: number; outputTokens?: number; seconds?: number; usdEstimate: number }): Promise<void> | void;
}

export interface CallContext {
  purpose: Purpose | string;
  /** hard cap on output tokens for this call, enforced before the request */
  maxOutputTokens?: number;
  /** transport attempts allowed (default MAX_ATTEMPTS); also sizes the budget hold */
  maxAttempts?: number;
  signal?: AbortSignal;
  recordUsage?: UsageSink;
  log?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
}

export interface ChatProvider {
  readonly id: ProviderId;
  configured(): boolean;
  chat(req: ChatRequest, model: string, ctx: CallContext): Promise<ChatResponse>;
}

export type JsonSchema<T> = z.ZodType<T>;
