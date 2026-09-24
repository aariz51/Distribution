import { PipelineError } from "@distribution/core";
import { bin, run } from "./exec";
import { classify, isRetryable, parseVideoId, parseVideoMeta, probeArgv, userMessage, ytdlpAttempts } from "./ports/youtube";

/** Read real YouTube metadata without downloading media; bound the whole fallback sequence. */
export async function probeYoutube(url: string, signal: AbortSignal) {
  const id = parseVideoId(url);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(180_000)]);
  let lastError: unknown;
  for (const argv of ytdlpAttempts(probeArgv(id))) {
    bounded.throwIfAborted();
    try {
      const result = await run(bin("yt-dlp"), argv, { signal: bounded, timeoutMs: 45_000, step: "probe" });
      const meta = parseVideoMeta(result.stdout);
      if (!meta.title.trim() || !Number.isFinite(meta.duration) || meta.duration <= 0) throw new PipelineError("Video has no usable duration. Live or unavailable videos cannot be processed.", { step: "probe" });
      return { ...meta, externalId: String(id) };
    } catch (error) {
      bounded.throwIfAborted();
      lastError = error;
      const details = (error as { details?: { stderrTail?: string[] } }).details;
      if (!details?.stderrTail) {
        if (error instanceof PipelineError && error.retrySafe) continue;
        throw error;
      }
      const failure = classify((details?.stderrTail ?? []).join("\n"));
      if (!isRetryable(failure)) throw new PipelineError(userMessage(failure), { step: "probe", cause: error });
    }
  }
  throw new PipelineError("Could not retrieve video metadata. Try again later.", { retrySafe: true, step: "probe", cause: lastError });
}
