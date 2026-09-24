import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { transcriptCacheKey } from "../../transcript-cache";

it("invalidates changed media at the same path, language, provider and model, but ignores credential rotation", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "transcript-cache-"));
  const file = path.join(dir, "source.mp4");
  try {
    await writeFile(file, "original media bytes");
    const original = await transcriptCacheKey(file, "deepgram", "en", undefined, {});
    expect(await transcriptCacheKey(file, "deepgram", "en", undefined, { DEEPGRAM_API_KEY: "rotated" })).toBe(original);
    expect(await transcriptCacheKey(file, "deepgram", "fr", undefined, {})).not.toBe(original);
    expect(await transcriptCacheKey(file, "deepgram", "en", undefined, { DEEPGRAM_MODEL: "nova-3" })).not.toBe(original);
    expect(await transcriptCacheKey(file, "whisper-local", "en", undefined, {})).not.toBe(original);
    await writeFile(file, "modified media bytes");
    expect(await transcriptCacheKey(file, "deepgram", "en", undefined, {})).not.toBe(original);
    await expect(transcriptCacheKey(file, "deepgram", "en", AbortSignal.abort(), {})).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("distinguishes the actual Whisper API backend", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "transcript-backend-"));
  const file = path.join(dir, "audio");
  try {
    await writeFile(file, "audio bytes");
    expect(await transcriptCacheKey(file, "whisper-api", "en", undefined, {}))
      .not.toBe(await transcriptCacheKey(file, "whisper-api", "en", undefined, { GROQ_API_KEY: "configured" }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
