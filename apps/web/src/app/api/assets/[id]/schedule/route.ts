import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { assets, db, eq } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { scheduleAsset } from "@/lib/publishing";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ channelIds: z.array(z.string().min(1)).min(1), scheduledFor: z.string().min(1), connectionId: z.uuid().optional() });

export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id: assetId } = await ctx.params;
  const row = (await db.select({ productId: assets.productId }).from(assets).where(eq(assets.id, assetId)).limit(1))[0];
  if (!row) throw new NotFound("asset");
  await getProduct(s.accountId, row.productId);
  const body = Body.parse(await req.json());
  const scheduled = await scheduleAsset(s.accountId, { assetId, channelIds: body.channelIds, scheduledFor: new Date(body.scheduledFor), connectionId: body.connectionId });
  return json({ scheduled }, { status: 201 });
});
