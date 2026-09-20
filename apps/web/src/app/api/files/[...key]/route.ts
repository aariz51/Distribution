import { Readable } from "node:stream";
import { requireSession } from "@/lib/auth";
import { handler } from "@/lib/api";
import { getStorage, assertValidKey } from "@distribution/storage";

/** Serve a stored object. The key is validated against the allowed prefixes and
 *  segment grammar, so a crafted URL cannot reach outside the storage root. */
export const GET = handler(async (_req, ctx: { params: Promise<{ key: string[] }> }) => {
  await requireSession();
  const { key: parts } = await ctx.params;
  const key = assertValidKey(parts.join("/"));
  const storage = getStorage();
  const head = await storage.head(key);
  if (!head) return new Response("not found", { status: 404 });
  const stream = await storage.getStream(key);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "content-type": head.contentType ?? "application/octet-stream",
      "content-length": String(head.size),
      "cache-control": "private, max-age=3600",
    },
  });
});
