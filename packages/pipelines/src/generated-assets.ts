import { and, assets, eq, sql, type Db } from "@distribution/db";

/** One library identity per generated file, even across concurrent/retried jobs. */
export async function saveGeneratedAsset(db: Pick<Db, "transaction">, value: typeof assets.$inferInsert): Promise<string> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${value.productId}:${value.storageKey}`}, 0))`);
    // Serialize derivative registration with the parent thumbnail handoff.
    if (value.type === "clip_enriched" && value.derivedFromAssetId) {
      const parent = (await tx.select({ thumbnailAssetId: assets.thumbnailAssetId }).from(assets)
        .where(and(eq(assets.id, value.derivedFromAssetId), eq(assets.productId, value.productId))).for("update"))[0];
      if (!parent) throw new Error("Enriched clip parent is missing or belongs to another product");
      value = { ...value, thumbnailAssetId: parent.thumbnailAssetId };
    }
    const existing = (await tx.select({ id: assets.id }).from(assets)
      .where(and(eq(assets.productId, value.productId), eq(assets.storageKey, value.storageKey))).limit(1))[0];
    if (existing) {
      const { id: _id, createdAt: _createdAt, ...fields } = value;
      await tx.update(assets).set({ ...fields, updatedAt: sql`now()` }).where(eq(assets.id, existing.id));
      return existing.id;
    }
    await tx.insert(assets).values(value);
    return value.id;
  });
}

/** Update existing derivatives while preventing a concurrent registration from missing the handoff. */
export async function attachClipThumbnail(db: Pick<Db, "transaction">, productId: string, assetId: string, thumbnailId: string): Promise<void> {
  await db.transaction(async tx => {
    const parent = (await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.id, assetId), eq(assets.productId, productId))).for("update"))[0];
    if (!parent) throw new Error("Thumbnail parent is missing or belongs to another product");
    const thumbnail = (await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.id, thumbnailId), eq(assets.productId, productId), eq(assets.type, "thumbnail"))))[0];
    if (!thumbnail) throw new Error("Thumbnail is missing or belongs to another product");
    await tx.update(assets).set({ thumbnailAssetId: thumbnailId, updatedAt: sql`now()` }).where(eq(assets.id, assetId));
    await tx.update(assets).set({ thumbnailAssetId: thumbnailId, updatedAt: sql`now()` }).where(and(eq(assets.derivedFromAssetId, assetId), eq(assets.productId, productId), eq(assets.type, "clip_enriched")));
  });
}
