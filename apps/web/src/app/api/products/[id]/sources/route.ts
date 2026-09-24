import { z } from "zod";
import { newId, RightsClass, ValidationError } from "@distribution/core";
import { parseVideoId, canonicalUrl, withStagedUpload, probeMedia } from "@distribution/media";
import { getStorage, keys } from "@distribution/storage";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { and, db, eq, products, sourceVideos } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { listSources } from "@/lib/library";
import { startImportedSource } from "@/lib/runs";

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
    return withStagedUpload(req, { maxBytes: MAX_UPLOAD }, async file => {
      const rights = RightsClass.parse(file.fields.rights ?? "unknown");
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      if (!ALLOWED_EXT.has(ext)) throw new ValidationError("Unsupported media type", { ext });
      if (rights === "unknown") throw new ValidationError("Declare whether this upload is owned, licensed, or used with permission");
      const attestation = file.fields.attestation?.trim();
      if (rights === "third_party_attested" && (!attestation || attestation.length < 10)) throw new ValidationError("Permission attestation text is required");
      const probe = await probeMedia(file.path, { signal: req.signal });
      if (!probe.hasVideo || !probe.hasAudio || probe.durationSec <= 0) throw new ValidationError("Upload a playable video with an audio track");
      const key = keys.sourceOriginal(productId, sourceId, ext);
      const storage = getStorage();
      await storage.putFile(key, file.path, { contentType: file.contentType || "application/octet-stream" });
      try {
        await db.insert(sourceVideos).values({ id: sourceId, productId, kind: "upload", title: file.name, rights, status: "discovered", storageKey: key, attestation: rights === "third_party_attested" ? { text: attestation!, userId: s.userId, at: new Date().toISOString() } : null });
      } catch (error) {
        await storage.delete(key);
        throw error;
      }
      const run = await startImportedSource(productId, sourceId);
      return json({ sourceId, ...run }, { status: 201 });
    });
  }

  const body = UrlBody.parse(await req.json());
  const vid = parseVideoId(body.url);
  if (body.rights === "third_party_attested" && !body.attestation) throw new ValidationError("attestation text required for third-party sources");
  await db.transaction(async tx => {
    // Discovery takes this same product lock before checking/inserting URLs.
    await tx.select({ id: products.id }).from(products).where(eq(products.id, productId)).for("update");
    const existing = await tx.select({ id: sourceVideos.id }).from(sourceVideos).where(and(eq(sourceVideos.productId, productId), eq(sourceVideos.url, canonicalUrl(vid)))).limit(1);
    if (existing.length) throw new ValidationError("This video is already saved. Open its source to generate clips or retry processing.");
    await tx.insert(sourceVideos).values({
    id: sourceId,
    productId,
    kind: "youtube",
    url: canonicalUrl(vid),
    platform: "youtube",
    externalId: String(vid),
    rights: body.rights,
    status: "discovered",
    attestation: body.attestation ? { ...body.attestation, userId: s.userId, at: new Date().toISOString() } : null,
  });
  });
  const run = body.run ? await startImportedSource(productId, sourceId) : {};
  return json({ sourceId, ...run }, { status: 201 });
});
