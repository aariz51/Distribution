import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { db, eq, sourceVideos } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { startRun } from "@/lib/runs";
import { ValidationError } from "@distribution/core";

type Ctx = { params: Promise<{ id: string; sourceId: string }> };

/** Start (or re-run) the shorts pipeline for a source. */
export const POST = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId, sourceId } = await ctx.params;
  await getProduct(s.accountId, productId);
  const src = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)).limit(1))[0];
  if (!src || src.productId !== productId) throw new NotFound("source");
  if (src.rights === "unknown") throw new ValidationError("rights unknown: set rights before processing");
  return json(await startRun(productId, sourceId), { status: 202 });
});
