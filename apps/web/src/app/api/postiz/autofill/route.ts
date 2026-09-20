import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { autoFill } from "@/lib/publishing";
import { getProduct } from "@/lib/products";

const Body = z.object({ productId: z.uuid(), dryRun: z.boolean().default(true), days: z.number().int().min(1).max(60).optional() });

export const POST = handler(async (req) => {
  const s = await requireSession();
  const body = Body.parse(await req.json());
  await getProduct(s.accountId, body.productId);
  const slots = await autoFill(body.productId, s.accountId, { dryRun: body.dryRun, days: body.days });
  return json({ slots, applied: !body.dryRun });
});
