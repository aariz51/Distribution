import path from "node:path";
import type { StorageAdapter } from "./adapter";
import { LocalStorage } from "./local";

export * from "./adapter";
export * from "./keys";
export * from "./local";

let instance: StorageAdapter | undefined;

/** Resolve the configured adapter once per process. `STORAGE_DRIVER=local` is
 *  the only driver today; `s3` is reserved for the R2 adapter (Gate 3). */
export function getStorage(): StorageAdapter {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver !== "local") throw new Error(`STORAGE_DRIVER=${driver} not implemented yet`);
  const root = process.env.STORAGE_ROOT ?? path.resolve(process.cwd(), "storage");
  instance = new LocalStorage(root, process.env.STORAGE_URL_BASE ?? "/api/files");
  return instance;
}

/** Test seam. */
export function setStorage(adapter: StorageAdapter | undefined): void {
  instance = adapter;
}
