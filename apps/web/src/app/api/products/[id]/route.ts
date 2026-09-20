import { ProductProfileInput, Palette } from "@distribution/core";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { handler, json } from "@/lib/api";
import { getProduct, listBrandAssets, setPalette, updateProduct } from "@/lib/products";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  const product = await getProduct(s.accountId, id);
  const brandAssets = await listBrandAssets(id);
  return json({ product, brandAssets });
});

export const PUT = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  const input = ProductProfileInput.parse(await req.json());
  return json({ product: await updateProduct(s.accountId, id, input) });
});

const PatchBody = z.object({ palette: Palette.optional() });

/** Partial updates that must not bump the profile version (e.g. confirming an inferred palette). */
export const PATCH = handler(async (req, ctx: Ctx) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  const body = PatchBody.parse(await req.json());
  if (body.palette) await setPalette(s.accountId, id, body.palette);
  return json({ product: await getProduct(s.accountId, id) });
});
