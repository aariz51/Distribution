import { withProviderSpend } from "@distribution/core/provider-budget";
import type { CallContext, ChatMessage, ChatProvider, ChatRequest, ChatResponse, ContentPart, ProviderId } from "../types";
import { postJsonWithRetry } from "../policy";
import { estimateChatUsd, reserveChatUsd } from "../pricing";

interface OaiChoice { message?: { content?: string | { type: string; text?: string }[] } }
interface OaiResponse { choices?: OaiChoice[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }

function toOaiContent(content: string | ContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data.toString("base64")}` } },
  );
}

export interface OpenAICompatibleConfig {
  id: ProviderId;
  baseUrl: string;
  apiKeyEnv?: string;
  extraHeaders?: Record<string, string>;
  supportsJsonMode?: boolean;
}

/** One implementation covers OpenRouter, DeepSeek, OpenAI, Groq, Gemini (OpenAI endpoint) and Ollama. */
export class OpenAICompatibleProvider implements ChatProvider {
  readonly id: ProviderId;
  constructor(private readonly cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
  }

  private apiKey(): string | undefined {
    return this.cfg.apiKeyEnv ? process.env[this.cfg.apiKeyEnv] || undefined : undefined;
  }

  configured(): boolean {
    return this.cfg.apiKeyEnv ? Boolean(this.apiKey()) : true;
  }

  async chat(req: ChatRequest, model: string, ctx: CallContext): Promise<ChatResponse> {
    return withProviderSpend(reserveChatUsd(model, req, Math.min(req.maxTokens, ctx.maxOutputTokens ?? req.maxTokens), 5, this.id === "ollama"), () => this.chatReserved(req, model, ctx));
  }

  private async chatReserved(req: ChatRequest, model: string, ctx: CallContext): Promise<ChatResponse> {
    const started = Date.now();
    const messages: { role: string; content: unknown }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages as ChatMessage[]) messages.push({ role: m.role, content: toOaiContent(m.content) });
    const maxTokens = Math.min(req.maxTokens, ctx.maxOutputTokens ?? req.maxTokens);
    const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens, temperature: req.temperature ?? 0.2 };
    if (req.json && this.cfg.supportsJsonMode !== false) body.response_format = { type: "json_object" };
    if (this.id === "openrouter") body.usage = { include: true };
    const headers: Record<string, string> = { ...(this.cfg.extraHeaders ?? {}) };
    const key = this.apiKey();
    if (key) headers.authorization = `Bearer ${key}`;

    const { data, attempts } = await postJsonWithRetry<OaiResponse>({
      url: `${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`,
      headers,
      body,
      signal: ctx.signal,
      provider: this.id,
      log: ctx.log,
      // Anthropic models behind OpenRouter reject response_format (SETUP.md); retry without it.
      onBadRequest: (text) => (body.response_format && /response_format|json_object/i.test(text) ? { ...body, response_format: undefined } : undefined),
    });
    const raw = data.choices?.[0]?.message?.content;
    const text = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? "").join("") : "";
    const usage = { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
    const usd = data.usage ? estimateChatUsd(model, usage.inputTokens, usage.outputTokens).usd : reserveChatUsd(model, req, maxTokens, 1, this.id === "ollama");
    await ctx.recordUsage?.({ provider: this.id, model, kind: "chat", purpose: ctx.purpose, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usdEstimate: usd + reserveChatUsd(model, req, maxTokens, attempts - 1, this.id === "ollama") });
    return { text, usage, provider: this.id, model, latencyMs: Date.now() - started, attempts };
  }
}

export const OPENAI_COMPATIBLE: Record<Exclude<ProviderId, "anthropic">, OpenAICompatibleConfig> = {
  openrouter: {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    extraHeaders: { "HTTP-Referer": "https://github.com/aariz51/Distribution", "X-Title": "Distribution" },
  },
  deepseek: { id: "deepseek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" },
  openai: { id: "openai", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  groq: { id: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" },
  gemini: { id: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiKeyEnv: "GEMINI_API_KEY" },
  ollama: { id: "ollama", baseUrl: process.env.OLLAMA_URL ?? "http://localhost:11434/v1", supportsJsonMode: true },
};
