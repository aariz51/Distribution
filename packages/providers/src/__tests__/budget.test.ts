import { createServer, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { BudgetExceededError } from "@distribution/core";
import { withProviderBudget } from "@distribution/core/provider-budget";
import { OpenAICompatibleProvider } from "../llm/openai-compatible";
import { reserveChatUsd, estimateChatUsd } from "../pricing";
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});
const request = { messages: [{ role: "user" as const, content: "Choose a real clip" }], maxTokens: 100 };
it("counts uncertain earlier attempts even after a successful response", async () => {
  let calls = 0, cost = 0, reservation = 0;
  const server = createServer((_req, res) => {
    if (++calls === 1) { res.writeHead(502, { "retry-after": "0" }); res.end("upstream response lost"); }
    else { res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } })); }
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const provider = new OpenAICompatibleProvider({ id: "openai", baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
  await withProviderBudget({ run: async (usd, work) => { reservation = usd; return work(); } }, () => provider.chat(request, "gpt-4o-mini", { purpose: "test", recordUsage: u => { cost += u.usdEstimate; } }));
  expect(calls).toBe(2);
  expect(cost).toBeCloseTo(estimateChatUsd("gpt-4o-mini", 10, 2).usd + reserveChatUsd("gpt-4o-mini", request, 100, 1), 12);
  expect(reservation).toBeGreaterThan(cost);
});
it("rejects before any HTTP request when budget is exhausted", async () => {
  const provider = new OpenAICompatibleProvider({ id: "openai", baseUrl: "http://127.0.0.1:1" });
  await expect(withProviderBudget({ run: async () => { throw new BudgetExceededError("exhausted"); } }, () => provider.chat(request, "gpt-4o-mini", { purpose: "test" }))).rejects.toThrow("exhausted");
});
it("does not let an unknown paid model bypass pricing", async () => {
  const provider = new OpenAICompatibleProvider({ id: "openai", baseUrl: "http://127.0.0.1:1" });
  await expect(provider.chat(request, "unpriced-model", { purpose: "test" })).rejects.toThrow("No pricing configured");
});
