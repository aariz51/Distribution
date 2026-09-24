import { z } from "zod";
import { normalizeSearchQuery } from "@distribution/media";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { getProduct } from "@/lib/products";
import { getQueue } from "@/lib/queue";
type Ctx = { params: Promise<{ id: string }> };
export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id: productId } = await ctx.params;
  await getProduct(session.accountId, productId);
  const body = z.object({ query: z.string() }).parse(await req.json());
  const query = normalizeSearchQuery(body.query);
  const queue = await getQueue();
  return json(await queue.enqueue("source.search", { productId, query }, { productId, singletonKey: `search:${productId}` }), { status: 202 });
});
