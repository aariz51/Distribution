import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectIds, interpretStatus, PostizClient } from "../postiz";

it("uploads only the immutable bytes covered by the validator, including a file-change race", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "postiz-integrity-"));
  const file = path.join(dir, "media.mp4");
  let requests = 0;
  const client = new PostizClient({ apiKey: "test", fetchImpl: async () => { requests++; return Response.json({ id: "uploaded", path: "/media" }); } });
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  try {
    await writeFile(file, "transport test bytes");
    await expect(client.uploadFile(file, { validateMedia: async candidate => {
      expect(candidate).toBe(file);
      await writeFile(file, "changed bytes");
      return digest("changed bytes");
    } })).rejects.toMatchObject({ step: "final_screening" });
    expect(requests).toBe(0);
    await client.uploadFile(file, { validateMedia: async () => digest("changed bytes") });
    expect(requests).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("accepts the documented create response without losing post IDs", () => {
  expect(collectIds([{ postId: "post-123", integration: "channel" }])).toEqual(["post-123"]);
  expect(collectIds({ postId: "post-123" })).toEqual(["post-123"]);
});
it("does not infer publication from a past scheduled date", () => {
  expect(interpretStatus("p", { publishDate: "2020-01-01", state: "PROCESSING" }).state).toBe("pending");
  expect(interpretStatus("p", { publishDate: "2020-01-01" }).state).toBe("unknown");
  expect(interpretStatus("p", { state: "PUBLISHED", releaseURL: "https://example.com/post" }).state).toBe("published");
});

describe("real HTTP transport failure contract", () => {
  it("does not resend a create when the server accepts the body then drops the response", async () => {
    let submissions = 0;
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume the submitted body */ }
      submissions++;
      res.destroy();
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address() as { port: number };
      const client = new PostizClient({ apiKey: "test-only", apiUrl: `http://127.0.0.1:${address.port}` });
      await expect(client.createPost({ type: "draft", date: new Date().toISOString(), posts: [] })).rejects.toMatchObject({ retrySafe: false });
      expect(submissions).toBe(1);
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });
  it("uses documented list filtering to retrieve the exact scheduled post", async () => {
    let requested = "";
    const server = createServer((req, res) => { requested = req.url!; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ posts: [{ id: "other", state: "PUBLISHED" }, { id: "target", state: "QUEUE" }] })); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address() as { port: number };
      const client = new PostizClient({ apiKey: "test-only", apiUrl: `http://127.0.0.1:${address.port}` });
      expect((await client.getPost("target", undefined, new Date("2026-09-22"))).state).toBe("pending");
      const url = new URL(requested, "http://localhost");
      expect(url.pathname).toBe("/posts");
      expect(url.searchParams.get("startDate")).toBe("2026-09-21T00:00:00.000Z");
      expect(url.searchParams.get("endDate")).toBe("2026-09-23T00:00:00.000Z");
    } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
  });
});

it("preserves definitive provider rejection instead of labeling it uncertain", async () => {
  const client = new PostizClient({ apiKey: "test", fetchImpl: async () => new Response("invalid channel", { status: 422 }) });
  await expect(client.createPost({ type: "draft", date: new Date().toISOString(), posts: [] })).rejects.toMatchObject({ status: 422, retrySafe: false });
});
