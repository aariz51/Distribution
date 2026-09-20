/**
 * Seed a real product profile from a folder of assets, then enqueue brand.palette.
 *
 *   pnpm exec tsx scripts/seed-product.ts --name Civia --logo ~/civia-promo-assets/logo/app-icon-1024.png --screens ~/civia-promo-assets/screens
 *
 * Prints the product id and the job id; the worker must be running to process it.
 */
import "./_env.js";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { newId, slugify, type ProductProfileInput } from "@distribution/core";
import { accounts, assets, brandAssets, closeDb, eq, getDb, products, productVersions, features as featuresTable } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { getStorage, keys } from "@distribution/storage";
import sharp from "sharp";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (def !== undefined) return def;
  throw new Error(`missing --${name}`);
}

async function main() {
  const db = getDb();
  const storage = getStorage();
  const name = arg("name");
  const logoPath = arg("logo");
  const screensDir = arg("screens");
  const accountName = process.env.APP_ACCOUNT_NAME ?? "Founder";

  let account = (await db.select().from(accounts).where(eq(accounts.name, accountName)).limit(1))[0];
  if (!account) {
    account = (await db.insert(accounts).values({ id: newId(), name: accountName }).returning())[0]!;
  }

  const productId = newId();
  const profileVersion = 1;

  async function storeImage(file: string, kind: "logo" | "screenshot", position: number) {
    const buf = await readFile(file);
    const meta = await sharp(buf).metadata();
    const ext = (meta.format === "jpeg" ? "jpg" : meta.format) ?? "png";
    const assetId = newId();
    const key = keys.brandAsset(productId, assetId, ext);
    await storage.putBuffer(key, buf);
    await db.insert(assets).values({
      id: assetId,
      productId,
      type: "creative_image",
      storageKey: key,
      mimeType: `image/${meta.format ?? "png"}`,
      width: meta.width ?? null,
      height: meta.height ?? null,
      sizeBytes: buf.length,
      status: "approved",
      approvalState: "approved",
      profileVersion,
      metadata: { role: kind, originalName: path.basename(file) },
    });
    await db.insert(brandAssets).values({ id: newId(), productId, kind, assetId, position });
    return assetId;
  }

  const input: ProductProfileInput = {
    product: {
      name,
      tagline: arg("tagline", `${name} — describe it in one line`),
      description: arg("description", ""),
      category: { primary: arg("category", "productivity"), tags: [] },
      features: arg("features", "Feature one|Feature two|Feature three")
        .split("|")
        .map((t, i) => ({ id: newId(), title: t.trim(), priority: i + 1, evidenceAssetIds: [] })),
      competitors: [],
      audience: { summary: arg("audience", "Founders and small teams"), segments: [], painPoints: [] },
      platforms: ["ios", "android"],
      urls: {},
    },
    brand: { screenshotAssetIds: [], otherAssetIds: [], cta: "Download on the App Store & Google Play" },
    sources: { longFormSourceIds: [], connected: [] },
    publishing: { channelIds: [], timezone: "Asia/Kolkata", cadence: [], leadTimeMinutes: 30, minGapHours: 6 },
    contentPreferences: {
      captionPresetId: "hormozi-pop",
      captionUseBrandColors: true,
      titleBanner: true,
      broll: false,
      sfx: true,
      outro: true,
      voice: "none",
      peoplePolicy: "off",
      cleanSource: false,
      clipLengthSec: { min: 30, max: 90 },
      clipsPerSource: 8,
      copyTone: "direct, specific, no hype",
      hashtagStrategy: "few",
      languages: ["en"],
    },
  };

  const { features, ...productNoFeatures } = input.product;
  await db.insert(products).values({
    id: productId,
    accountId: account.id,
    slug: slugify(name),
    version: profileVersion,
    product: productNoFeatures,
    brand: input.brand,
    sources: input.sources,
    publishing: input.publishing,
    contentPreferences: input.contentPreferences,
  });
  for (const f of features) {
    await db.insert(featuresTable).values({ id: f.id, productId, title: f.title, detail: f.detail ?? null, priority: f.priority, evidenceAssetIds: [] });
  }

  const logoId = await storeImage(logoPath, "logo", 0);
  const screenFiles = (await readdir(screensDir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  const screenIds: string[] = [];
  for (const [i, f] of screenFiles.entries()) screenIds.push(await storeImage(path.join(screensDir, f), "screenshot", i));

  await db
    .update(products)
    .set({ brand: { ...input.brand, logoAssetId: logoId, screenshotAssetIds: screenIds } })
    .where(eq(products.id, productId));
  await db.insert(productVersions).values({ id: newId(), productId, version: profileVersion, snapshot: { ...input, brand: { ...input.brand, logoAssetId: logoId, screenshotAssetIds: screenIds } } });

  const queue = await JobQueue.start(db);
  const { jobId } = await queue.enqueue("brand.palette", { productId, assetIds: [logoId, ...screenIds] }, { productId, singletonKey: `brand.palette:${productId}` });
  await queue.stop();
  console.log(JSON.stringify({ productId, logoId, screenIds, jobId }, null, 2));
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
