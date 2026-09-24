import { requireSession } from "@/lib/auth";
import { handler } from "@/lib/api";
import { getStorage, assertValidKey, storedResponse } from "@distribution/storage";
import { and, assets, db, eq, or, products, sql } from "@/lib/db";

/** Serve a stored object. The key is validated against the allowed prefixes and
 *  segment grammar, so a crafted URL cannot reach outside the storage root. */
export const GET = handler(async (req, ctx: { params: Promise<{ key: string[] }> }) => {
  const session = await requireSession();
  const { key: parts } = await ctx.params;
  const key = assertValidKey(parts.join("/"));
  const owned = await db.select({ id: assets.id }).from(assets)
    .innerJoin(products, eq(products.id, assets.productId))
    .where(and(eq(products.accountId, session.accountId), or(
      eq(assets.storageKey, key),
      sql`${assets.metadata}->>'srtKey' = ${key}`,
    )))
    .limit(1);
  if (!owned.length) return new Response("not found", { status: 404 });
  return storedResponse(getStorage(), key, req);
});

export const HEAD = GET;
