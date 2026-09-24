import { withProviderSpend } from "@distribution/core/provider-budget";
import type { CallContext, ChatProvider, ChatRequest, ChatResponse, ContentPart } from "../types";
import { postJsonWithRetry } from "../policy";
import { estimateChatUsd, reserveChatUsd } from "../pricing";

interface AnthropicResponse { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }

/** Two credential shapes, as discovered in autoshorts llm.rs:385-395: console keys
 *  use `x-api-key`; Claude Code subscription tokens (`sk-ant-oat…`) use Bearer +
 *  the oauth beta header and expire. */
export function anthropicAuthHeaders(): Record<string, string> | null {
  const key = process.env.ANTHROPIC_API_KEY;
  const oat = process.env.ANTHROPIC_OAUTH_TOKEN;
  const cred = key || oat;
  if (!cred) return null;
  if (cred.startsWith("sk-ant-oat")) {
    return { authorization: `Bearer ${cred}`, "anthropic-beta": "oauth-2025-04-20", "anthropic-version": "2023-06-01" };
  }
  return { "x-api-key": cred, "anthropic-version": "2023-06-01" };
}

function toAnthropicContent(content: string | ContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((p) =>
    p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data.toString("base64") } },
  );
}

export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic" as const;
  configured(): boolean {
    return anthropicAuthHeaders() !== null;
  }
  async chat(req: ChatRequest, model: string, ctx: CallContext): Promise<ChatResponse> {
    return withProviderSpend(reserveChatUsd(model, req, Math.min(req.maxTokens, ctx.maxOutputTokens ?? req.maxTokens), 5, false), () => this.chatReserved(req, model, ctx));
  }

  private async chatReserved(req: ChatRequest, model: string, ctx: CallContext): Promise<ChatResponse> {
    const started = Date.now();
    const headers = anthropicAuthHeaders();
    if (!headers) throw new Error("anthropic not configured");
    const maxTokens = Math.min(req.maxTokens, ctx.maxOutputTokens ?? req.maxTokens);
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature: req.temperature ?? 0.2,
      messages: req.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m.content) })),
    };
    if (req.system) body.system = req.json ? `${req.system}\n\nRespond with a single JSON object and nothing else.` : req.system;
    else if (req.json) body.system = "Respond with a single JSON object and nothing else.";
    const { data, attempts } = await postJsonWithRetry<AnthropicResponse>({
      url: "https://api.anthropic.com/v1/messages",
      headers,
      body,
      signal: ctx.signal,
      provider: "anthropic",
      log: ctx.log,
    });
    const text = (data.content ?? []).map((c) => c.text ?? "").join("");
    const usage = { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
    const usd = data.usage ? estimateChatUsd(model, usage.inputTokens, usage.outputTokens).usd : reserveChatUsd(model, req, maxTokens, 1, false);
    await ctx.recordUsage?.({ provider: "anthropic", model, kind: "chat", purpose: ctx.purpose, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usdEstimate: usd + reserveChatUsd(model, req, maxTokens, attempts - 1, false) });
    return { text, usage, provider: "anthropic", model, latencyMs: Date.now() - started, attempts };
  }
}
