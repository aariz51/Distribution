import { Readable } from "node:stream";
import type { StorageAdapter } from "./adapter";

/** HTTP delivery shared by video playback and downloads. Authorization belongs to the caller. */
export async function storedResponse(storage: StorageAdapter, key: string, request: Request): Promise<Response> {
  const object = await storage.head(key);
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers({
    "content-type": object.contentType ?? "application/octet-stream",
    "content-length": String(object.size),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=0, must-revalidate",
    "x-content-type-options": "nosniff",
  });
  let range: { start: number; end: number } | undefined;
  const requested = request.method === "GET" ? request.headers.get("range") : null;
  // Unsupported/multiple ranges can be ignored per HTTP; send the complete representation.
  const match = requested?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2]) && !request.headers.has("if-range")) {
    const start = match[1] ? Number(match[1]) : Math.max(0, object.size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), object.size - 1) : object.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= object.size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${object.size}`, "accept-ranges": "bytes" } });
    }
    range = { start, end };
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(end - start + 1));
  }
  if (request.method === "HEAD") return new Response(null, { headers });
  const stream = await storage.getStream(key, range);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
}
