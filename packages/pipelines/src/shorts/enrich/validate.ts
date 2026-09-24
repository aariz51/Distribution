import { PipelineError } from "@distribution/core";
import { assertDecodableVideo, probeMedia } from "@distribution/media";

/** Validate the complete encoded export before publishing it to persistent storage. */
export async function validateEnrichedMedia(output: string, input: string, hasOutro: boolean, signal?: AbortSignal) {
  const out = await probeMedia(output, { signal });
  const original = await probeMedia(input, { signal });
  const extra = out.durationSec - original.durationSec;
  if (!out.hasVideo || out.durationSec <= 0 || original.durationSec <= 0 || !out.width || !out.height ||
    (original.hasAudio && !out.hasAudio) || out.width !== original.width || out.height !== original.height ||
    (hasOutro ? extra <= 0 || extra > 10 : Math.abs(extra) > 0.15)) {
    throw new PipelineError("Enriched media does not preserve the source duration, dimensions or streams", { step: "validate" });
  }
  // Container metadata alone cannot prove encoded frames are intact.
  await assertDecodableVideo(output, out.durationSec, signal);
  return out;
}
