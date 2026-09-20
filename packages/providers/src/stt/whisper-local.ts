import { readFile } from "node:fs/promises";
import path from "node:path";
import { PipelineError } from "@distribution/core";
import { bin, normalizeWhisperRawJson, run } from "@distribution/media";
import type { SttOptions, SttProvider } from "./types";

/**
 * Local openai-whisper via the configured Python (autoshorts transcription.rs:214-355).
 * `python -m whisper <wav> --model base --output_format json --word_timestamps True --output_dir <work>`
 * Speed on Apple Silicon CPU ≈ 0.8× realtime for `base`.
 */
export class WhisperLocalProvider implements SttProvider {
  readonly id = "whisper-local" as const;
  configured(): boolean {
    return Boolean(process.env.PYTHON_BIN);
  }
  async transcribe(wavPath: string, durationSec: number, opts: SttOptions) {
    const model = process.env.WHISPER_MODEL ?? "base";
    const outDir = opts.workDir;
    // whisper prints segments as it goes; count them for coarse progress.
    let seen = 0;
    const expected = Math.max(1, Math.round(durationSec / 6));
    await run(bin("python"), ["-m", "whisper", wavPath, "--model", model, "--output_format", "json", "--word_timestamps", "True", "--output_dir", outDir, "--verbose", "False", ...(opts.language ? ["--language", opts.language] : [])], {
      timeoutMs: Math.max(10 * 60_000, durationSec * 4_000),
      signal: opts.signal,
      step: "transcribe",
      onStdoutLine: () => {
        seen++;
        opts.onProgress?.(Math.min(95, 5 + Math.round((seen / expected) * 90)), `whisper ${model}: ${seen}/${expected} segments`);
      },
    });
    const jsonPath = path.join(outDir, `${path.basename(wavPath, path.extname(wavPath))}.json`);
    const raw = JSON.parse(await readFile(jsonPath, "utf8").catch(() => {
      throw new PipelineError(`whisper produced no JSON at ${jsonPath}`, { retrySafe: false, step: "transcribe" });
    })) as unknown;
    await opts.recordUsage?.({ provider: "whisper-local", model, seconds: durationSec, usdEstimate: 0 });
    return normalizeWhisperRawJson(raw);
  }
}
