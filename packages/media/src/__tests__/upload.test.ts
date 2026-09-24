import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { withStagedUpload } from "../upload";

async function request(bytes: number, extra?: (form: FormData) => void) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes).fill(7)]), "input.mp4");
  form.set("rights", "owned"); extra?.(form);
  const formRequest = new Request("http://localhost/upload", { method: "POST", body: form });
  return new Request("http://localhost/upload", { method: "POST", headers: formRequest.headers, body: await formRequest.arrayBuffer() });
}
async function scratch(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "upload-test-"));
  try { await fn(dir); expect(await readdir(dir)).toEqual([]); } finally { await rm(dir, { recursive: true, force: true }); }
}
it("streams an exact-limit file with fields and removes staging after success", async () => scratch(async dir => {
  await withStagedUpload(await request(1024), { maxBytes: 1024, scratchRoot: dir }, async upload => {
    expect(upload.size).toBe(1024); expect(upload.fields.rights).toBe("owned");
    expect(await readFile(upload.path)).toEqual(Buffer.alloc(1024, 7));
  });
}));
it("rejects oversize input during streaming and removes partial files", async () => scratch(async dir => {
  await expect(withStagedUpload(await request(1025), { maxBytes: 1024, scratchRoot: dir }, async () => { throw new Error("must not consume"); })).rejects.toThrow(/large/i);
}));
it("rejects excess file parts", async () => scratch(async dir => {
  await expect(withStagedUpload(await request(12, f => f.append("file", new Blob(["second"]), "second.mp4")), { maxBytes: 1024, scratchRoot: dir }, async () => {})).rejects.toThrow(/parts/i);
}));
it("rejects duplicate fields", async () => scratch(async dir => {
  await expect(withStagedUpload(await request(12, f => f.append("rights", "licensed")), { maxBytes: 1024, scratchRoot: dir }, async () => {})).rejects.toThrow(/duplicate/i);
}));
it("cleans up when consumer fails", async () => scratch(async dir => {
  await expect(withStagedUpload(await request(12), { maxBytes: 1024, scratchRoot: dir }, async () => { throw new Error("database failed"); })).rejects.toThrow("database failed");
}));
it("rejects a disconnected upload and removes partial files", async () => scratch(async dir => {
  const original = await request(1024);
  const raw = new Uint8Array(await original.arrayBuffer());
  const interrupted = new Request("http://localhost/upload", { method: "POST", headers: original.headers, body: raw.slice(0, raw.length - 100) });
  await expect(withStagedUpload(interrupted, { maxBytes: 2048, scratchRoot: dir }, async () => {})).rejects.toThrow();
}));
it("rejects advertised oversize input before staging", async () => scratch(async dir => {
  const req = await request(12); req.headers.set("content-length", "1000000");
  await expect(withStagedUpload(req, { maxBytes: 1024, scratchRoot: dir }, async () => {})).rejects.toThrow(/large/i);
}));
it("cleans up a client-aborted request", async () => scratch(async dir => {
  const base = await request(1024);
  const req = new Request(base, { signal: AbortSignal.abort() });
  await expect(withStagedUpload(req, { maxBytes: 2048, scratchRoot: dir }, async () => {})).rejects.toThrow(/interrupted/i);
}));
