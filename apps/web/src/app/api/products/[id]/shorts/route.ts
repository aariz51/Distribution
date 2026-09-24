import { z } from "zod";
import { ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { and, db, eq, sourceVideos } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { startRun } from "@/lib/runs";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ sourceId: z.uuid() });

/** Start a shorts run for one source: creates the project and enqueues source.ingest. */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  await getProduct(s.accountId, productId);
  const { sourceId } = Body.parse(await req.json());
  const src = (await db.select().from(sourceVideos).where(and(eq(sourceVideos.id, sourceId), eq(sourceVideos.productId, productId))).limit(1))[0];
  if (!src) throw new ValidationError("source not found");
  if (src.rights === "unknown" && src.kind === "upload") throw new ValidationError("set the rights of the upload first");
  return json(await startRun(productId, sourceId), { status: 202 });
});
