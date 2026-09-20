import { z } from "zod";
import { ContentPreferences, ValidationError } from "@distribution/core";
import { requireSession } from "@/lib/auth";
import { handler, json, NotFound } from "@/lib/api";
import { and, assets, db, eq, products } from "@/lib/db";
import { getQueue } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };

const Step = z.enum(["broll", "sfx", "outro"]);
const ORDER = ["broll", "sfx", "outro"] as const;
const Body = z.object({ steps: z.array(Step).optional() }).default({});

/** Enqueue `shorts.enrich` for a clip. Steps default to the product's content
 *  preference flags (same rule as `enrichStepsFor` in the pipelines package). */
export const POST = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  const row = (await db.select({ a: assets, prefs: products.contentPreferences }).from(assets).innerJoin(products, eq(products.id, assets.productId)).where(and(eq(assets.id, id), eq(products.accountId, s.accountId))).limit(1))[0];
  if (!row) throw new NotFound("asset");
  const asset = row.a;
  if (asset.type !== "clip") throw new ValidationError("only clips can be enriched", { type: asset.type });
  if (!asset.projectId || !asset.candidateId) throw new ValidationError("clip has no project/candidate", { assetId: id });

  const body = Body.parse(await req.json().catch(() => ({})));
  const prefs = ContentPreferences.parse(row.prefs);
  const want = new Set(body.steps ?? ORDER.filter((k) => prefs[k]));
  const steps = ORDER.filter((k) => want.has(k));
  if (!steps.length) throw new ValidationError("no enrichment steps enabled", { steps: body.steps ?? null });

  const queue = await getQueue();
  const payload = { productId: asset.productId, projectId: asset.projectId, assetId: id, steps };
  const res = await queue.enqueue("shorts.enrich", payload, { productId: asset.productId, projectId: asset.projectId, assetId: id, singletonKey: `enrich:${id}:${steps.join(",")}` });
  return json({ ...res, steps }, { status: 202 });
});
