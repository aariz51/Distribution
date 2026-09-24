import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { getProduct } from "@/lib/products";
import { referenceChoices } from "@/lib/references";
type Ctx = { params: Promise<{ id: string }> };
export const GET = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const profile = await getProduct(session.accountId, id);
  const duration = z.coerce.number().int().min(15).max(90).parse(new URL(req.url).searchParams.get("durationSec") ?? 24);
  return json({ references: await referenceChoices(profile, duration) });
});
