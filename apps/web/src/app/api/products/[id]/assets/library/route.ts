import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { getProduct } from "@/lib/products";
import { listLibrary } from "@/lib/library";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  await getProduct(s.accountId, id);
  const url = new URL(req.url);
  return json({ assets: await listLibrary(id, { status: url.searchParams.get("status") ?? undefined, type: url.searchParams.get("type") ?? undefined }) });
});
