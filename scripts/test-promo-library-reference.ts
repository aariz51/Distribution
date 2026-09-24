import "dotenv/config";
import { randomUUID } from "node:crypto";
import { assets, brandAssets, closeDb, eq, getDb, jobs, products, projects, referenceVideos, sourceVideos, users } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb(), queue = await JobQueue.start(db), referenceId = randomUUID();
  let restore: { id: string; sources: typeof products.$inferSelect.sources } | undefined;
  try {
    const user = (await db.select().from(users).where(eq(users.email, "upload-acceptance@local")))[0]!;
    const product = (await db.select().from(products).where(eq(products.accountId, user.accountId)))[0]!;
    restore = { id: product.id, sources: product.sources };
    const logo = (await db.select().from(brandAssets).where(eq(brandAssets.kind, "logo")))[0]!;
    const image = (await db.select().from(assets).where(eq(assets.id, logo.assetId)))[0]!;
    const imageId = randomUUID();
    await db.insert(assets).values({ ...image, id: imageId, productId: product.id, projectId: null, jobId: null, thumbnailAssetId: null });
    await db.insert(brandAssets).values({ ...logo, id: randomUUID(), productId: product.id, assetId: imageId });
    await db.update(products).set({ brand: { ...product.brand, logoAssetId: imageId }, sources: { ...product.sources, promoReference: { kind: "library", referenceId } } }).where(eq(products.id, product.id));
    const source = (await db.select().from(sourceVideos)).find(s => s.url?.includes("youtube.com"));
    if (!source?.url) throw new Error("Real source URL required");
    // Only a disposable catalog transport fixture; not a production curated recommendation.
    await db.insert(referenceVideos).values({ id: referenceId, url: source.url, title: "QA reference transport" });
    const origin = "http://127.0.0.1:3002";
    const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw new Error("Login failed");
    const choicesUrl = `${origin}/api/products/${product.id}/promo/references?durationSec=18`;
    if ((await fetch(choicesUrl)).status !== 401) throw new Error("Reference choices leaked without login");
    const choicesResponse = await fetch(choicesUrl, { headers: { cookie } });
    const choices = await choicesResponse.json() as { references: { id: string; score: number; posterUrl: string }[] };
    if (!choicesResponse.ok || choices.references.length !== 3 || choices.references.some((r, index) => !r.posterUrl.startsWith("https://i.ytimg.com/") || (index > 0 && choices.references[index - 1]!.score < r.score))) throw new Error("Reference choices are missing or unsorted");
    const call = (body: object) => fetch(`${origin}/api/products/${product.id}/promo`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const body of [{ referenceId: randomUUID() }, { referenceId, referenceUrl: source.url }, { referenceId, referenceAssetId: imageId }]) {
      if ((await call(body)).status !== 400) throw new Error("Invalid or ambiguous reference accepted");
    }
    const selectedBrand = { ...product.brand, logoAssetId: imageId };
    for (const brand of [{ ...selectedBrand, logoAssetId: undefined }, { ...selectedBrand, screenshotAssetIds: [randomUUID()] }]) {
      await db.update(products).set({ brand }).where(eq(products.id, product.id));
      if ((await call({ durationSec: 18 })).status !== 400) throw new Error("Invalid selected brand assets were queued");
    }
    await db.update(products).set({ brand: selectedBrand }).where(eq(products.id, product.id));
    const response = await call({ referenceId, durationSec: 18, useLlm: true });
    const result = await response.json() as { projectId: string; jobId: string };
    if (response.status !== 202) throw new Error(`Reference failed: ${JSON.stringify(result)}`);
    await queue.cancel(result.jobId);
    const project = (await db.select().from(projects).where(eq(projects.id, result.projectId)))[0]!;
    const job = (await db.select().from(jobs).where(eq(jobs.id, result.jobId)))[0]!;
    if (project.referenceId !== referenceId || project.params.referenceId !== referenceId || job.payload.referenceId !== referenceId) throw new Error("Reference lost between request, project and job");
    const selection = project.params.referenceSelection as { selectedId?: string; alternatives?: unknown[] };
    const chosen = (await db.select().from(referenceVideos).where(eq(referenceVideos.id, referenceId)))[0]!;
    if (selection?.selectedId !== referenceId || selection.alternatives?.length !== 3 || chosen.usageCount !== 1 || chosen.lastUsedProductId !== product.id) throw new Error("Selection alternatives or usage audit lost");
    console.log("PASS: normal-login HTTP rejects missing selected logo/screenshots and missing/ambiguous catalog references and preserves selected reference in project, parameters and queued job; cancelled before provider use");
  } finally { if (restore) await db.update(products).set({ sources: restore.sources }).where(eq(products.id, restore.id)); await db.delete(referenceVideos).where(eq(referenceVideos.id, referenceId)); await queue.stop(); await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
