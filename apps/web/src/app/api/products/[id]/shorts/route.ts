import { z } from "zod";
import { newId, ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { and, db, eq, projects, sourceVideos } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { getQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ sourceId: z.uuid() });

/** Start a shorts run for one source: creates the project and enqueues source.ingest. */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  const product = await getProduct(s.accountId, productId);
  const { sourceId } = Body.parse(await req.json());
  const src = (await db.select().from(sourceVideos).where(and(eq(sourceVideos.id, sourceId), eq(sourceVideos.productId, productId))).limit(1))[0];
  if (!src) throw new ValidationError("source not found");
  if (src.rights === "unknown" && src.kind === "upload") throw new ValidationError("set the rights of the upload first");
  const projectId = newId();
  await db.insert(projects).values({ id: projectId, productId, kind: "shorts", profileVersion: product.version, sourceId, status: "created", params: { clipsPerSource: product.contentPreferences.clipsPerSource } });
  const queue = await getQueue();
  const res = await queue.enqueue("source.ingest", { productId, sourceId, projectId }, { productId, projectId, sourceId, singletonKey: `source.ingest:${sourceId}:${projectId}` });
  return json({ projectId, ...res }, { status: 202 });
});
