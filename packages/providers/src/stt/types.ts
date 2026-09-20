import type { NormalizedTranscript } from "@distribution/core";

export type SttProviderId = "deepgram" | "whisper-api" | "whisper-local";

export interface SttOptions {
  signal?: AbortSignal;
  language?: string;
  onProgress?: (pct: number, message: string) => void;
  recordUsage?: (u: { provider: string; model: string; seconds: number; usdEstimate: number }) => Promise<void> | void;
  /** scratch directory the provider may write into */
  workDir: string;
}

export interface SttProvider {
  readonly id: SttProviderId;
  configured(): boolean;
  /** `wavPath` is 16 kHz mono PCM as produced by extractAudio16k. */
  transcribe(wavPath: string, durationSec: number, opts: SttOptions): Promise<NormalizedTranscript>;
}
