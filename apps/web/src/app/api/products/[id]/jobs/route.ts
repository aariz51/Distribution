import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { db, desc, eq, jobs } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { getQueue } from "@/lib/queue";
import { ValidationError } from "@distribution/core";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ type: z.enum(["brand.palette"]) });

export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: productId } = await ctx.params;
  const product = await getProduct(s.accountId, productId);
  const body = Body.parse(await req.json());
  const queue = await getQueue();
  if (body.type === "brand.palette") {
    const assetIds = [product.brand.logoAssetId, ...product.brand.screenshotAssetIds].filter((x): x is string => Boolean(x));
    if (assetIds.length === 0) throw new ValidationError("upload a logo or screenshots first");
    const res = await queue.enqueue("brand.palette", { productId, assetIds }, { productId, singletonKey: `brand.palette:${productId}` });
    return json(res, { status: 202 });
  }
  throw new ValidationError("unknown job type");
});

export const GET = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  await getProduct(s.accountId, id);
  const rows = await db.select().from(jobs).where(eq(jobs.productId, id)).orderBy(desc(jobs.createdAt)).limit(50);
  return json({ jobs: rows });
});
