import path from "node:path";
import { existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import type { StorageAdapter } from "./adapter";
import { LocalStorage } from "./local";

export * from "./adapter";
export * from "./keys";
export * from "./local";
export * from "./delivery";

/** Hash current stored bytes, never a database report about a previous file. */
export async function storedContentHash(key: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(await getStorage().localPathFor(key), { signal })) hash.update(chunk);
  return hash.digest("hex");
}

let instance: StorageAdapter | undefined;

/** Resolve the configured adapter once per process. `STORAGE_DRIVER=local` is
 *  the only driver today; `s3` is reserved for the R2 adapter (Gate 3). */
export function resolveStorageRoot(configured = process.env.STORAGE_ROOT ?? "storage", cwd = process.cwd()): string {
  if (path.isAbsolute(configured)) return path.normalize(configured);
  let root = path.resolve(cwd);
  while (!existsSync(path.join(root, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(root);
    if (parent === root) throw new Error("Set STORAGE_ROOT to an absolute shared persistent directory outside a workspace checkout");
    root = parent;
  }
  return path.resolve(root, configured);
}

export function getStorage(): StorageAdapter {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver !== "local") throw new Error(`STORAGE_DRIVER=${driver} not implemented yet`);
  const root = resolveStorageRoot();
  instance = new LocalStorage(root, process.env.STORAGE_URL_BASE ?? "/api/files");
  return instance;
}

/** Test seam. */
export function setStorage(adapter: StorageAdapter | undefined): void {
  instance = adapter;
}
