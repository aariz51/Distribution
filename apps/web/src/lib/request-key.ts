import { createHash } from "node:crypto";
import { z } from "zod";

/** Optional stable client operation ID, scoped to its owner rather than globally shared. */
export function requestKey(req: Request): string | undefined {
  const value = req.headers.get("idempotency-key");
  return value === null ? undefined : z.uuid().parse(value);
}

export function requestId(scope: string, key: string): string {
  const hex = createHash("sha256").update(`${scope}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
