import { z } from "zod";
import { canonicalChannel } from "@distribution/media";
import { ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { getProduct } from "@/lib/products";
import { getQueue } from "@/lib/queue";
type Ctx = { params: Promise<{ id: string }> };
export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id: productId } = await ctx.params;
  const profile = await getProduct(session.accountId, productId);
  const body = z.object({ channelUrl: z.url() }).parse(await req.json());
  const channelUrl = canonicalChannel(body.channelUrl);
  if (!profile.sources.connected.some(source => source.kind === "youtube_channel" && canonicalChannel(source.url) === channelUrl)) throw new ValidationError("Choose a channel connected to this product");
  const queue = await getQueue();
  return json(await queue.enqueue("source.discover", { productId, channelUrl }, { productId, singletonKey: `discover:${productId}:${channelUrl}` }), { status: 202 });
});
