import { PipelineError, logger } from "@distribution/core";
import type { CallContext, ChatProvider, ChatRequest, ChatResponse, ProviderId, Purpose } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OPENAI_COMPATIBLE, OpenAICompatibleProvider } from "./openai-compatible";

export interface Route { provider: ProviderId; model: string }

const DEFAULT_ROUTES: Record<Purpose, string> = {
  rank: "openrouter:anthropic/claude-sonnet-4.5,deepseek:deepseek-chat,openrouter:google/gemini-2.5-flash",
  title: "openrouter:google/gemini-2.5-flash-lite,anthropic:claude-haiku-4-5-20251001",
  copy: "openrouter:google/gemini-2.5-flash,deepseek:deepseek-chat",
  creative_copy: "openrouter:google/gemini-2.5-flash-lite",
  storyboard: "openrouter:anthropic/claude-sonnet-4.5,anthropic:claude-sonnet-4-5-20250929",
  vision: "openrouter:google/gemini-2.5-flash,openai:gpt-4o-mini",
  broll_plan: "openrouter:anthropic/claude-sonnet-4.5,openrouter:google/gemini-2.5-flash",
  extract: "openrouter:google/gemini-2.5-flash-lite",
};

const PROVIDER_IDS: ProviderId[] = ["openrouter", "anthropic", "deepseek", "openai", "groq", "gemini", "ollama"];

export function parseRoutes(spec: string): Route[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(":");
      if (i < 1) throw new PipelineError(`bad route "${s}" (expected provider:model)`);
      const provider = s.slice(0, i) as ProviderId;
      if (!PROVIDER_IDS.includes(provider)) throw new PipelineError(`unknown provider "${provider}"`);
      return { provider, model: s.slice(i + 1) };
    });
}

/** `LLM_RANK=openrouter:model,deepseek:model` overrides the default chain per purpose. */
export function routesFor(purpose: Purpose | string): Route[] {
  const env = process.env[`LLM_${String(purpose).toUpperCase()}`];
  const spec = env ?? DEFAULT_ROUTES[purpose as Purpose] ?? DEFAULT_ROUTES.copy;
  return parseRoutes(spec);
}

export class LlmRouter {
  private providers: Map<ProviderId, ChatProvider>;
  constructor(overrides: Partial<Record<ProviderId, ChatProvider>> = {}) {
    this.providers = new Map();
    for (const cfg of Object.values(OPENAI_COMPATIBLE)) this.providers.set(cfg.id, new OpenAICompatibleProvider(cfg));
    this.providers.set("anthropic", new AnthropicProvider());
    for (const [k, v] of Object.entries(overrides)) if (v) this.providers.set(k as ProviderId, v);
  }

  configuredProviders(): ProviderId[] {
    return [...this.providers.values()].filter((p) => p.configured()).map((p) => p.id);
  }

  /** Try each configured route in order; move on when one is exhausted or unconfigured. */
  async chat(req: ChatRequest, ctx: CallContext, routes: Route[] = routesFor(ctx.purpose)): Promise<ChatResponse> {
    const errors: string[] = [];
    for (const r of routes) {
      const p = this.providers.get(r.provider);
      if (!p || !p.configured()) {
        errors.push(`${r.provider}: not configured`);
        continue;
      }
      try {
        const res = await p.chat(req, r.model, ctx);
        if (!res.text.trim()) throw new PipelineError(`${r.provider} returned empty text`, { retrySafe: true });
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${r.provider}/${r.model}: ${msg}`);
        (ctx.log ?? logger).warn({ provider: r.provider, model: r.model, purpose: ctx.purpose, err: msg }, "provider failed; falling back");
        if (ctx.signal?.aborted) throw err;
      }
    }
    throw new PipelineError(`all providers failed for ${ctx.purpose}: ${errors.join(" | ")}`, { retrySafe: true, step: String(ctx.purpose) });
  }
}

let router: LlmRouter | undefined;
export function getLlm(): LlmRouter {
  router ??= new LlmRouter();
  return router;
}
export function setLlm(r: LlmRouter | undefined): void {
  router = r;
}
