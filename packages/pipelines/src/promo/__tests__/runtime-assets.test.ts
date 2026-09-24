import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { stageRuntimeAssets } from "../runtime-assets";

it("stages the tracked fonts and every sound used by the audio mixer", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "promo assets "));
  try {
    await stageRuntimeAssets(dir);
    for (const file of ["fonts/Inter.ttf", "fonts/Baloo2.ttf", ...["click", "pop", "pop2", "whoosh", "chime", "type", "drag", "sparkle"].map((name) => `sfx/${name}.mp3`)]) {
      expect((await readFile(path.join(dir, file))).length).toBeGreaterThan(100);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
