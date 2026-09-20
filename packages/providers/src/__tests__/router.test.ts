import { describe, expect, it } from "vitest";
import { LlmRouter, parseRoutes } from "../llm/router";
import { backoffSecs, isRetryableStatus } from "../policy";
import type { ChatProvider, ChatResponse } from "../types";

function fake(id: ChatProvider["id"], behaviour: "ok" | "fail" | "unconfigured"): ChatProvider {
  return {
    id,
    configured: () => behaviour !== "unconfigured",
    async chat(_req, model): Promise<ChatResponse> {
      if (behaviour === "fail") throw new Error(`${id} down`);
      return { text: `from ${id}`, usage: { inputTokens: 1, outputTokens: 1 }, provider: id, model, latencyMs: 1, attempts: 1 };
    },
  };
}

describe("routes", () => {
  it("parses provider:model chains", () => {
    expect(parseRoutes("openrouter:anthropic/claude-sonnet-4.5, deepseek:deepseek-chat")).toEqual([
      { provider: "openrouter", model: "anthropic/claude-sonnet-4.5" },
      { provider: "deepseek", model: "deepseek-chat" },
    ]);
    expect(() => parseRoutes("nope:model")).toThrow();
  });
  it("falls back across providers in order", async () => {
    const r = new LlmRouter({ openrouter: fake("openrouter", "fail"), deepseek: fake("deepseek", "unconfigured"), groq: fake("groq", "ok") });
    const res = await r.chat({ messages: [{ role: "user", content: "hi" }], maxTokens: 10 }, { purpose: "rank" }, parseRoutes("openrouter:a,deepseek:b,groq:c"));
    expect(res.provider).toBe("groq");
  });
  it("throws a retry-safe error when every route fails", async () => {
    const r = new LlmRouter({ openrouter: fake("openrouter", "fail") });
    await expect(r.chat({ messages: [{ role: "user", content: "hi" }], maxTokens: 10 }, { purpose: "rank" }, parseRoutes("openrouter:a"))).rejects.toMatchObject({ retrySafe: true });
  });
});

describe("policy", () => {
  it("retryable statuses", () => {
    expect([408, 409, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 422].some(isRetryableStatus)).toBe(false);
  });
  it("backoff honours retry-after and caps", () => {
    expect(backoffSecs(0, "7")).toBe(7);
    expect(backoffSecs(0, "999")).toBe(120);
    expect(backoffSecs(0, null)).toBe(2);
    expect(backoffSecs(9, null)).toBe(60);
  });
});
