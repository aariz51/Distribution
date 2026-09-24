import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { PipelineError, ProductProfile, type Palette } from "@distribution/core";
import { and, desc, eq, features, products, productVersions, projects, sql, sourceVideos, transcripts, type Db } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import type { JobTypeName } from "@distribution/jobs";

export async function loadProfile(db: Db, productId: string, projectId?: string | null): Promise<ProductProfile> {
  if (!projectId) return loadCurrentProfile(db, productId);
  return db.transaction(async tx => {
    const project = (await tx.select().from(projects).where(eq(projects.id, projectId)).for("update"))[0];
    if (!project || project.productId !== productId) throw new PipelineError("Project does not belong to this product", { step: "load" });
    if (project.params.profileSnapshot) {
      const snapshot = ProductProfile.parse(project.params.profileSnapshot);
      if (snapshot.id !== productId || snapshot.version !== project.profileVersion) throw new PipelineError("Invalid project profile snapshot", { step: "load" });
      return snapshot;
    }
    // One-time compatibility for old projects. Never silently substitute a new
    // profile version when its historical configuration cannot be recovered.
    const current = await loadCurrentProfile(tx, productId);
    let snapshot = current;
    if (current.version !== project.profileVersion) {
      const historical = (await tx.select().from(productVersions).where(and(eq(productVersions.productId, productId), eq(productVersions.version, project.profileVersion))).limit(1))[0];
      if (!historical) throw new PipelineError("Run configuration is unavailable. Start a new run from the source.", { step: "load" });
      snapshot = ProductProfile.parse({ ...current, ...historical.snapshot, id: productId, accountId: current.accountId, version: project.profileVersion });
    }
    await tx.update(projects).set({ params: sql`${projects.params} || ${JSON.stringify({ profileSnapshot: snapshot })}::jsonb` }).where(eq(projects.id, projectId));
    return snapshot;
  });
}

async function loadCurrentProfile(db: Pick<Db, "select">, productId: string): Promise<ProductProfile> {
  const row = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!row) throw new PipelineError("product not found", { step: "load" });
  const feats = await db.select().from(features).where(eq(features.productId, productId));
  return ProductProfile.parse({
    id: row.id,
    accountId: row.accountId,
    slug: row.slug,
    version: row.version,
    product: { ...(row.product as object), features: feats.sort((a, b) => a.priority - b.priority).map((f) => ({ id: f.id, title: f.title, detail: f.detail ?? undefined, priority: f.priority, evidenceAssetIds: f.evidenceAssetIds })) },
    brand: row.brand,
    sources: row.sources,
    publishing: row.publishing,
    contentPreferences: row.contentPreferences,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function loadSource(db: Db, sourceId: string) {
  const row = (await db.select().from(sourceVideos).where(eq(sourceVideos.id, sourceId)).limit(1))[0];
  if (!row) throw new PipelineError("source not found", { step: "load" });
  return row;
}

export async function latestTranscript(db: Db, sourceId: string, cacheKey: string) {
  return (await db.select().from(transcripts)
    .where(and(eq(transcripts.sourceId, sourceId), eq(transcripts.cacheKey, cacheKey)))
    .orderBy(desc(transcripts.createdAt)).limit(1))[0];
}

/** Per-job scratch directory, removed when the callback settles. */
export async function withScratch<T>(label: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(process.env.SCRATCH_ROOT ?? os.tmpdir(), `dist-${label}-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const DEFAULT_PALETTE: Palette = { ink: "#14171A", accent: "#17B26A", canvas: "#F6F5F1", ground: "#0D1114", extra: [], source: "inferred", inferredFrom: [] };

export function paletteOf(p: ProductProfile): Palette {
  return p.brand.palette ?? DEFAULT_PALETTE;
}

export function usageSink<T extends JobTypeName>(ctx: JobContext<T>, accountId: string, productId: string) {
  return async (u: { provider: string; model: string; kind: "chat" | "stt"; purpose?: string; inputTokens?: number; outputTokens?: number; seconds?: number; usdEstimate: number }) => {
    await ctx.recordUsage({ accountId, productId, provider: u.provider, model: u.model, kind: u.kind, purpose: u.purpose, inputTokens: u.inputTokens, outputTokens: u.outputTokens, seconds: u.seconds, usdEstimate: u.usdEstimate });
  };
}

export function transcriptTextBetween(t: { segments: unknown[] }, start: number, end: number): string {
  const segs = t.segments as { start: number; end: number; text: string }[];
  return segs.filter((s) => s.end > start && s.start < end).map((s) => s.text).join(" ").trim();
}
