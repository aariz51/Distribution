import { afterEach, expect, it, vi } from "vitest";
import { BudgetExceededError } from "@distribution/core";
import { withProviderBudget } from "@distribution/core/provider-budget";
import { femaleOutroSpeech } from "../tts";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("does not send speech requests after a budget rejection", async () => {
  vi.stubEnv("TTS_PROVIDER", "openrouter"); vi.stubEnv("OPENROUTER_API_KEY", "unit-test-key");
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  await expect(withProviderBudget({ run: async () => { throw new BudgetExceededError("exhausted"); } }, () => femaleOutroSpeech("Download Safe Choice", "/unused.mp3", { recordUsage: async () => {} }))).rejects.toThrow("exhausted");
  expect(request).not.toHaveBeenCalled();
});
it("requests a built-in female voice without sending a speaker reference and surfaces provider failure", async () => {
  vi.stubEnv("TTS_PROVIDER", "openrouter"); vi.stubEnv("OPENROUTER_API_KEY", "unit-test-key");
  const request = vi.fn(async () => new Response(JSON.stringify({ error: { code: "unavailable", message: "Try later" } }), { status: 503 }));
  vi.stubGlobal("fetch", request);
  await expect(femaleOutroSpeech("Download Safe Choice", "/unused.mp3", { recordUsage: async () => {} })).rejects.toThrow("503");
  const body = JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.model).toBe("deepgram/aura-2"); expect(body.voice).toBe("aura-2-thalia-en");
  expect(body.input_references).toBeUndefined(); expect(request).toHaveBeenCalledTimes(1);
});
