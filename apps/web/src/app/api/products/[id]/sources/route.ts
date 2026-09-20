import { z } from "zod";
import { newId, RightsClass, ValidationError } from "@distribution/core";
import { parseVideoId, canonicalUrl } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { db, sourceVideos } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { listSources } from "@/lib/library";
import { startRun } from "@/lib/runs";

type Ctx = { params: Promise<{ id: string }> };

const UrlBody = z.object({
  url: z.url(),
  rights: RightsClass.default("unknown"),
  attestation: z.object({ text: z.string().min(10) }).optional(),
  /** start the shorts pipeline immediately (default true) */
  run: z.boolean().default(true),
});

const ALLOWED_EXT = new Set(["mp4", "mov", "m4a", "mp3", "wav", "webm"]);
const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;

export const GET = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  await getProduct(s.accountId, id);
  return json({ sources: await listSources(id) });
});

/** JSON {url, rights, attestation?} for YouTube, or multipart {file, rights} for an upload. */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  await getProduct(s.accountId, productId);
  const sourceId = newId();
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const rights = RightsClass.parse(form.get("rights") ?? "owned");
    if (!(file instanceof File)) throw new ValidationError("file missing");
    if (file.size > MAX_UPLOAD) throw new ValidationError("file too large");
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw new ValidationError("unsupported media type", { ext });
    if (rights === "unknown") throw new ValidationError("uploads must declare rights (owned, licensed, or attested)");
    const key = keys.sourceOriginal(productId, sourceId, ext === "mov" || ext === "webm" ? ext : ext);
    const storage = getStorage();
    const p = await storage.localPathFor(key);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(p, Buffer.from(await file.arrayBuffer()));
    await db.insert(sourceVideos).values({ id: sourceId, productId, kind: "upload", title: file.name, rights, status: "queued", storageKey: key, attestation: rights === "third_party_attested" ? { text: String(form.get("attestation") ?? "permission attested at upload"), userId: s.userId, at: new Date().toISOString() } : null });
    const run = await startRun(productId, sourceId);
    return json({ sourceId, ...run }, { status: 201 });
  }

  const body = UrlBody.parse(await req.json());
  const vid = parseVideoId(body.url);
  if (body.rights === "third_party_attested" && !body.attestation) throw new ValidationError("attestation text required for third-party sources");
  await db.insert(sourceVideos).values({
    id: sourceId,
    productId,
    kind: "youtube",
    url: canonicalUrl(vid),
    platform: "youtube",
    externalId: String(vid),
    rights: body.rights,
    status: body.run ? "queued" : "discovered",
    attestation: body.attestation ? { ...body.attestation, userId: s.userId, at: new Date().toISOString() } : null,
  });
  const run = body.run ? await startRun(productId, sourceId) : {};
  return json({ sourceId, ...run }, { status: 201 });
});
