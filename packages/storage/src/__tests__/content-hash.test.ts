import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LocalStorage, setStorage, storedContentHash } from "../index";

it("does not certify replaced, missing or cancelled source reads with an earlier fingerprint", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "source-hash-"));
  const storage = new LocalStorage(dir, "/files");
  setStorage(storage);
  const key = "products/source.mp4", file = await storage.localPathFor(key);
  try {
    await writeFile(file, "original test bytes");
    const original = await storedContentHash(key);
    await writeFile(file, "modified test bytes");
    expect(await storedContentHash(key)).not.toBe(original);
    await expect(storedContentHash(key, AbortSignal.abort())).rejects.toThrow();
    await rm(file);
    await expect(storedContentHash(key)).rejects.toThrow();
  } finally { setStorage(undefined); await rm(dir, { recursive: true, force: true }); }
});
