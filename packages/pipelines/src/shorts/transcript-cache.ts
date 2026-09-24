import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Content, rather than mutable storage paths, identifies the actual STT input.
 * Bump the version when extraction or provider request semantics change. */
export async function transcriptCacheKey(file: string, provider: string, language: string | undefined, signal?: AbortSignal, env: NodeJS.ProcessEnv = process.env) {
  const model = provider === "deepgram" ? env.DEEPGRAM_MODEL ?? "nova-2"
    : provider === "whisper-local" ? env.WHISPER_MODEL ?? "base"
    : env.GROQ_API_KEY ? "groq:whisper-large-v3" : "openai:whisper-1";
  const hash = createHash("sha256").update(JSON.stringify({ version: 1, provider, model, language: language ?? null }));
  signal?.throwIfAborted();
  const stream = createReadStream(/* turbopackIgnore: true */ file, { signal });
  for await (const chunk of stream) hash.update(chunk);
  signal?.throwIfAborted();
  return hash.digest("hex");
}
