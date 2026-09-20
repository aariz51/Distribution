import { randomUUID } from "node:crypto";

/** All primary keys are UUIDv4 strings generated application-side so rows can be
 *  referenced before they are inserted (job payloads carry ids). */
export type Id = string;

export function newId(): Id {
  return randomUUID();
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "product";
}
