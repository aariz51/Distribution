import { withProviderSpend } from "@distribution/core/provider-budget";
import { readFile } from "node:fs/promises";
import { PipelineError } from "@distribution/core";
import { normalizeDeepgram } from "@distribution/media";
import { STT_PRICE_PER_MIN } from "../pricing";
import { isRetryableStatus, backoffSecs, sleep, TOTAL_TIMEOUT_MS } from "../policy";
import type { SttOptions, SttProvider } from "./types";

/** Same request as autoshorts transcription.rs:8-30 (nova-2, smart_format, diarize, punctuate, filler_words). */
export class DeepgramProvider implements SttProvider {
  readonly id = "deepgram" as const;
  configured(): boolean {
    return Boolean(process.env.DEEPGRAM_API_KEY);
  }
  async transcribe(wavPath: string, durationSec: number, opts: SttOptions) {
    const model = process.env.DEEPGRAM_MODEL ?? "nova-2";
    const price = STT_PRICE_PER_MIN[`deepgram:${model}`];
    return withProviderSpend(Math.max(1, Math.ceil(durationSec / 60)) * (price ?? NaN) * 4, () => this.transcribeReserved(wavPath, durationSec, opts));
  }
  private async transcribeReserved(wavPath: string, durationSec: number, opts: SttOptions) {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new PipelineError("DEEPGRAM_API_KEY not set");
    const audio = await readFile(wavPath);
    const model = process.env.DEEPGRAM_MODEL ?? "nova-2";
    const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&diarize=true&punctuate=true&filler_words=true${opts.language ? `&language=${opts.language}` : ""}`;
    opts.onProgress?.(10, "uploading audio to Deepgram");
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(url, { method: "POST", headers: { authorization: `Token ${key}`, "content-type": "audio/wav" }, body: audio, signal: AbortSignal.any([AbortSignal.timeout(TOTAL_TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])]) });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        opts.onProgress?.(90, "normalising transcript");
        const minutes = durationSec / 60;
        await opts.recordUsage?.({ provider: "deepgram", model, seconds: durationSec, usdEstimate: (minutes + attempt * Math.max(1, Math.ceil(minutes))) * (STT_PRICE_PER_MIN[`deepgram:${model}`] ?? 0) });
        return normalizeDeepgram(json);
      }
      const body = await res.text();
      lastErr = new PipelineError(`deepgram HTTP ${res.status}: ${body.slice(0, 200)}`, { retrySafe: isRetryableStatus(res.status) });
      if (!isRetryableStatus(res.status)) throw lastErr;
      if (attempt < 3) await sleep(backoffSecs(attempt, res.headers.get("retry-after")) * 1000, opts.signal);
    }
    throw lastErr;
  }
}
