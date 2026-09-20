import { PipelineError } from "@distribution/core";
import { DeepgramProvider } from "./deepgram";
import { WhisperApiProvider } from "./whisper-api";
import { WhisperLocalProvider } from "./whisper-local";
import type { SttProvider, SttProviderId } from "./types";

export * from "./types";
export { DeepgramProvider, WhisperApiProvider, WhisperLocalProvider };

const ALL: SttProvider[] = [new DeepgramProvider(), new WhisperApiProvider(), new WhisperLocalProvider()];

/** Explicit id, else `STT_PROVIDER`, else the first configured in order deepgram → whisper-api → whisper-local. */
export function getStt(id?: SttProviderId | string): SttProvider {
  const want = id ?? process.env.STT_PROVIDER;
  if (want) {
    const p = ALL.find((x) => x.id === want);
    if (!p) throw new PipelineError(`unknown STT provider ${want}`);
    if (!p.configured()) throw new PipelineError(`STT provider ${want} is not configured`);
    return p;
  }
  const p = ALL.find((x) => x.configured());
  if (!p) throw new PipelineError("no transcription provider configured");
  return p;
}
