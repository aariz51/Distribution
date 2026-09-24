import { z } from "zod";
import { Platform } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { and, assetCopy, assets, db, desc, eq, products, sql } from "@/lib/db";
import { getQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };

async function owned(accountId: string, assetId: string) {
  const row = (await db.select({ a: assets }).from(assets).innerJoin(products, eq(products.id, assets.productId)).where(and(eq(assets.id, assetId), eq(products.accountId, accountId))).limit(1))[0]?.a;
  if (!row) throw new NotFound("asset");
  return row;
}

export const GET = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  await owned(s.accountId, id);
  const rows = await db.select().from(assetCopy).where(eq(assetCopy.assetId, id)).orderBy(desc(assetCopy.version));
  return json({ copy: rows });
});

const Edit = z.object({ copyId: z.uuid(), hook: z.string().optional(), title: z.string().optional(), caption: z.string().optional(), description: z.string().optional(), hashtags: z.array(z.string()).optional(), cta: z.string().optional(), approved: z.boolean().optional() });

/** Edit a copy version in place (founder edits), or regenerate with {regenerate: true, platforms}. */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  const asset = await owned(s.accountId, id);
  const body = (await req.json()) as { regenerate?: boolean; platforms?: string[] } | z.infer<typeof Edit>;
  if ("regenerate" in body && body.regenerate) {
    const queue = await getQueue();
    const requested = z.array(Platform).max(10).optional().parse(body.platforms);
    const platforms: Array<z.infer<typeof Platform>> = [...new Set(requested?.length ? requested : ["instagram", "tiktok", "youtube", "x", "linkedin"] as const)];
    const res = await queue.enqueue("copy.generate", { productId: asset.productId, assetId: id, platforms }, { productId: asset.productId, assetId: id });
    return json(res, { status: 202 });
  }
  const e = Edit.parse(body);
  const { copyId, ...patch } = e;
  await db.update(assetCopy).set({ ...patch }).where(and(eq(assetCopy.id, copyId), eq(assetCopy.assetId, id)));
  await db.update(assets).set({ updatedAt: sql`now()` }).where(eq(assets.id, id));
  return json({ ok: true });
});
