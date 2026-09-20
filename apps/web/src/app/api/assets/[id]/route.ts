import { z } from "zod";
import { AssetStatus, canTransition, ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { assets, db, eq, products, sql, and } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ action: z.enum(["approve", "reject", "archive", "restore"]), reason: z.string().max(500).optional() });

export const PATCH = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  const body = Body.parse(await req.json());
  const row = (await db.select({ a: assets }).from(assets).innerJoin(products, eq(products.id, assets.productId)).where(and(eq(assets.id, id), eq(products.accountId, s.accountId))).limit(1))[0]?.a;
  if (!row) throw new NotFound("asset");
  const from = AssetStatus.parse(row.status);
  let to: z.infer<typeof AssetStatus>;
  let approval: "approved" | "rejected" | "pending" = row.approvalState;
  if (body.action === "approve") {
    to = "approved";
    approval = "approved";
  } else if (body.action === "reject" || body.action === "archive") {
    to = "archived";
    approval = body.action === "reject" ? "rejected" : approval;
  } else {
    to = "review";
    approval = "pending";
  }
  if (!canTransition(from, to)) throw new ValidationError(`cannot move asset from ${from} to ${to}`);
  await db.update(assets).set({ status: to, approvalState: approval, approvalReason: body.reason ?? null, updatedAt: sql`now()` }).where(eq(assets.id, id));
  return json({ ok: true, status: to, approvalState: approval });
});
