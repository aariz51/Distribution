import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LocalStorage } from "../local";
it("keeps the existing file on failed replacement and never exposes a partial buffer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "atomic-media-"));
  const store = new LocalStorage(root);
  const key = "tmp/output.mp4";
  const before = Buffer.alloc(16 * 1024, 17), after = Buffer.alloc(8 * 1024 * 1024, 42);
  try {
    await store.putBuffer(key, before);
    await expect(store.putFile(key, path.join(root, "missing-source.mp4"))).rejects.toThrow();
    expect(await store.getBuffer(key)).toEqual(before);
    let done = false;
    const write = (async () => {
      try { for (let i = 0; i < 8; i++) await store.putBuffer(key, i % 2 ? before : after); }
      finally { done = true; }
    })();
    let reads = 0;
    try {
      do {
        const data = await store.getBuffer(key);
        expect(data.equals(before) || data.equals(after)).toBe(true);
        reads++;
      } while (!done);
    } finally { await write; }
    expect(reads).toBeGreaterThan(0);
    expect(await readdir(path.join(root, "tmp"))).toEqual(["output.mp4"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
