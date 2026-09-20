import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { ValidationError } from "@distribution/core";
import { listSchedule } from "@/lib/publishing";
import { getProduct } from "@/lib/products";

export const GET = handler(async (req) => {
  const s = await requireSession();
  const productId = new URL(req.url).searchParams.get("productId");
  if (!productId) throw new ValidationError("productId is required");
  await getProduct(s.accountId, productId);
  return json({ schedule: await listSchedule(productId, s.accountId) });
});
