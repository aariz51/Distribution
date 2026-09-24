import { writeFile } from "node:fs/promises";
import { PipelineError, redact } from "@distribution/core";
import { withProviderSpend } from "@distribution/core/provider-budget";
import { probeMedia } from "@distribution/media";

/** Built-in synthetic voice; never accepts or uploads a speaker reference. */
export async function femaleOutroSpeech(text: string, output: string, opts: {
  signal?: AbortSignal;
  recordUsage: (usage: { provider: string; model: string; kind: "tts"; seconds: number; usdEstimate: number }) => Promise<void>;
}): Promise<string> {
  if (!text.trim() || text.length > 200) throw new PipelineError("Outro speech must contain 1–200 characters", { step: "tts" });
  const provider = process.env.TTS_PROVIDER ?? (process.env.OPENROUTER_API_KEY ? "openrouter" : "openai");
  if (provider !== "openrouter" && provider !== "openai") throw new PipelineError("TTS_PROVIDER must be openrouter or openai", { step: "tts" });
  const key = provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;
  if (!key) throw new PipelineError(`Female AI voice requires a configured ${provider} API key`, { step: "tts" });
  const instructions = "Use a warm, natural feminine voice. Speak clearly with a friendly, confident tone and a brisk conversational pace. Read only the provided words.";
  const model = provider === "openrouter" ? "deepgram/aura-2" : "gpt-4o-mini-tts";
  return withProviderSpend(0.03, async () => {
    const response = await fetch(provider === "openrouter" ? "https://openrouter.ai/api/v1/audio/speech" : "https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, voice: provider === "openrouter" ? "aura-2-thalia-en" : "coral", input: text, response_format: "mp3", ...(provider === "openrouter" ? {} : { instructions }) }),
      signal: AbortSignal.any([AbortSignal.timeout(120000), ...(opts.signal ? [opts.signal] : [])]),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
      const code = typeof error?.error?.code === "string" ? error.error.code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) : "provider_error";
      throw new PipelineError(`Female voice generation failed (HTTP ${response.status}, ${code}): ${redact(error?.error?.message ?? "No provider details").slice(0, 250)}`, { step: "tts", details: { status: response.status, code } });
    }
    if (!response.body) throw new PipelineError("Voice provider returned no audio", { step: "tts" });
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new PipelineError("Voice response exceeded the audio size limit", { step: "tts" }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    await writeFile(output, Buffer.concat(chunks));
    const media = await probeMedia(output, { signal: opts.signal });
    if (!media.hasAudio || media.durationSec <= 0 || media.durationSec > 30) throw new PipelineError("Voice provider returned invalid outro audio", { step: "tts" });
    // Speech responses do not provide a token usage object; track a duration-based estimate.
    const usdEstimate = provider === "openrouter" ? Array.from(text).length * 0.00003 : media.durationSec / 60 * 0.015 + Buffer.byteLength(text + instructions) * 0.6 / 1_000_000;
    await opts.recordUsage({ provider, model, kind: "tts", seconds: media.durationSec, usdEstimate });
    return output;
  });
}
