import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Per-job scratch directory under the OS temp dir; always removed by the caller's finally. */
export async function withScratch<T>(label: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const base = process.env.SCRATCH_ROOT ?? path.join(os.tmpdir(), "distribution");
  await import("node:fs/promises").then((fs) => fs.mkdir(base, { recursive: true }));
  const dir = await mkdtemp(path.join(base, `${label}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
