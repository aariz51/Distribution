import { withProviderSpend } from "@distribution/core/provider-budget";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NormalizedTranscript, PipelineError } from "@distribution/core";
import { bin, run } from "@distribution/media";
import { STT_PRICE_PER_MIN } from "../pricing";
import { backoffSecs, isRetryableStatus, sleep, TOTAL_TIMEOUT_MS } from "../policy";
import type { SttOptions, SttProvider } from "./types";

interface VerboseJson {
  language?: string;
  duration?: number;
  words?: { word: string; start: number; end: number }[];
  segments?: { start: number; end: number; text: string }[];
}

const MAX_UPLOAD = 24 * 1024 * 1024;
const CHUNK_SEC = 40 * 60;

/**
 * Whisper over HTTP: Groq `whisper-large-v3` (preferred, cheaper/faster) or OpenAI `whisper-1`,
 * the same fallback order as the watch skill's whisper.py. Audio is re-encoded to 64 kbps mono
 * mp3 and split into 40-minute chunks so each upload stays under the 25 MB limit.
 */
export class WhisperApiProvider implements SttProvider {
  readonly id = "whisper-api" as const;
  private target(): { url: string; key: string; model: string; price: number; name: string } | null {
    if (process.env.GROQ_API_KEY) return { url: "https://api.groq.com/openai/v1/audio/transcriptions", key: process.env.GROQ_API_KEY, model: "whisper-large-v3", price: STT_PRICE_PER_MIN["groq:whisper-large-v3"] ?? 0, name: "groq" };
    if (process.env.OPENAI_API_KEY) return { url: "https://api.openai.com/v1/audio/transcriptions", key: process.env.OPENAI_API_KEY, model: "whisper-1", price: STT_PRICE_PER_MIN["openai:whisper-1"] ?? 0, name: "openai" };
    return null;
  }
  configured(): boolean {
    return this.target() !== null;
  }

  async transcribe(wavPath: string, durationSec: number, opts: SttOptions) {
    const target = this.target();
    if (!target) throw new PipelineError("No transcription provider configured");
    return withProviderSpend(Math.max(1, Math.ceil(durationSec / 60)) * target.price * 4, () => this.transcribeReserved(wavPath, durationSec, opts));
  }
  private async transcribeReserved(wavPath: string, durationSec: number, opts: SttOptions) {
    const t = this.target();
    if (!t) throw new PipelineError("no GROQ_API_KEY or OPENAI_API_KEY for whisper-api");
    const mp3 = path.join(opts.workDir, "stt.mp3");
    opts.onProgress?.(5, "encoding audio for upload");
    await run(bin("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-i", wavPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", mp3], { timeoutMs: 20 * 60_000, signal: opts.signal, step: "transcribe" });
    const chunks: { file: string; offset: number }[] = [];
    if ((await stat(mp3)).size > MAX_UPLOAD || durationSec > CHUNK_SEC) {
      const pattern = path.join(opts.workDir, "stt-%03d.mp3");
      await run(bin("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3, "-f", "segment", "-segment_time", String(CHUNK_SEC), "-c", "copy", pattern], { timeoutMs: 10 * 60_000, signal: opts.signal, step: "transcribe" });
      const n = Math.ceil(durationSec / CHUNK_SEC);
      for (let i = 0; i < n; i++) chunks.push({ file: path.join(opts.workDir, `stt-${String(i).padStart(3, "0")}.mp3`), offset: i * CHUNK_SEC });
    } else {
      chunks.push({ file: mp3, offset: 0 });
    }

    const words: { text: string; start: number; end: number }[] = [];
    const segments: { start: number; end: number; text: string }[] = [];
    let language: string | null = null;
    let uncertainMinutes = 0;
    for (const [i, c] of chunks.entries()) {
      opts.onProgress?.(10 + Math.round((i / chunks.length) * 80), `transcribing chunk ${i + 1}/${chunks.length} via ${t.name}`);
      const { json, attempts } = await this.upload(t, c.file, opts);
      uncertainMinutes += (attempts - 1) * Math.max(1, Math.ceil(Math.min(CHUNK_SEC, durationSec - c.offset) / 60));
      language ??= json.language ?? null;
      for (const w of json.words ?? []) words.push({ text: w.word.trim(), start: w.start + c.offset, end: w.end + c.offset });
      for (const s of json.segments ?? []) segments.push({ start: s.start + c.offset, end: s.end + c.offset, text: s.text.trim() });
    }
    await opts.recordUsage?.({ provider: t.name, model: t.model, seconds: durationSec, usdEstimate: (durationSec / 60 + uncertainMinutes) * t.price });
    return NormalizedTranscript.parse({ language, duration: durationSec, speakers: [], words, segments });
  }

  private async upload(t: NonNullable<ReturnType<WhisperApiProvider["target"]>>, file: string, opts: SttOptions): Promise<{ json: VerboseJson; attempts: number }> {
    const data = await readFile(file);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const form = new FormData();
      form.set("file", new Blob([data], { type: "audio/mpeg" }), path.basename(file));
      form.set("model", t.model);
      form.set("response_format", "verbose_json");
      form.set("temperature", "0");
      form.append("timestamp_granularities[]", "word");
      form.append("timestamp_granularities[]", "segment");
      if (opts.language) form.set("language", opts.language);
      const res = await fetch(t.url, { method: "POST", headers: { authorization: `Bearer ${t.key}` }, body: form, signal: AbortSignal.any([AbortSignal.timeout(TOTAL_TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])]) });
      if (res.ok) return { json: (await res.json()) as VerboseJson, attempts: attempt + 1 };
      const body = await res.text();
      lastErr = new PipelineError(`${t.name} whisper HTTP ${res.status}: ${body.slice(0, 200)}`, { retrySafe: isRetryableStatus(res.status) });
      if (!isRetryableStatus(res.status)) throw lastErr;
      if (attempt < 3) await sleep(backoffSecs(attempt, res.headers.get("retry-after")) * 1000, opts.signal);
    }
    throw lastErr;
  }
}
