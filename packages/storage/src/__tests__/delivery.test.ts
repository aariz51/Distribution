import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalStorage } from "../local";
import { storedResponse } from "../delivery";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("serves exact byte ranges, suffix ranges, HEAD, and unsatisfiable ranges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "distribution-delivery-"));
  roots.push(root);
  const storage = new LocalStorage(root);
  const key = "promo/test/out/video.mp4";
  await storage.putBuffer(key, Buffer.from("0123456789"));
  const request = (range?: string, method = "GET") => new Request("http://localhost/video", { method, headers: range ? { range } : {} });
  const partial = await storedResponse(storage, key, request("bytes=2-5"));
  expect(partial.status).toBe(206);
  expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
  expect(partial.headers.get("content-length")).toBe("4");
  expect(await partial.text()).toBe("2345");
  expect(await (await storedResponse(storage, key, request("bytes=-3"))).text()).toBe("789");
  expect(await (await storedResponse(storage, key, request("bytes=8-"))).text()).toBe("89");
  expect((await storedResponse(storage, key, request("bytes=10-"))).status).toBe(416);
  const head = await storedResponse(storage, key, request(undefined, "HEAD"));
  expect(head.headers.get("content-length")).toBe("10");
  expect(await head.text()).toBe("");
  expect(await (await storedResponse(storage, key, request())).text()).toBe("0123456789");
});
