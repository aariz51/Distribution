import path from "node:path";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PipelineError, newId, type ProductProfile } from "@distribution/core";
import type { JobContext } from "@distribution/jobs";
import { getStorage, keys } from "@distribution/storage";
import { parseVideoId } from "@distribution/media";
import { loadProfile, withScratch } from "../shorts/common";
import { profileAssets } from "../profile-assets";
import { saveGeneratedAsset } from "../generated-assets";
import { stageRuntimeAssets } from "./runtime-assets";
import { themeForProduct } from "./theme";
import { mergeParams, projectParams } from "./jobs";
import { fetchReference, referenceEvidence, type ReferenceEvidence } from "./breakdown";
import { breakdownWithModel, planWithModel, promoCapUsd, promoSpendUsd } from "./director";
import { DirectorPlan, ReferenceBreakdown, SHOWREEL_PROMPT, compileShowreel, resolveInspiration, type Inspiration } from "./showreel";

/** The skill's latest build_audio.py (vendor/promo-video, synced to upstream). */
const SKILL_BUILD_AUDIO = fileURLToPath(new URL("../../../../vendor/promo-video/template/scripts/build_audio.py", import.meta.url));

/** Cached breakdowns are keyed by video and by breakdown version. */
const BREAKDOWN_VERSION = "v1";

export interface Staged {
  projectDir: string;
  publicDir: string;
  logo: string;
  screens: Record<string, string>;
  screenKeys: string[];
  screenshotPaths: string[];
}

/**
 * Copy the product's logo and screenshots into the project's Remotion public/
 * dir, with fonts, the skill's bundled sound effects and its audio builder.
 */
export async function stagePromoAssets(ctx: JobContext<"promo.run"> | JobContext<"promo.storyboard">, profile: ProductProfile, projectId: string, opts: { screenshots?: boolean } = {}): Promise<Staged> {
  const useScreens = opts.screenshots !== false;
  const storage = getStorage();
  const brand = await profileAssets(ctx.db, profile);
  if (!brand.logo) throw new PipelineError("A logo is required for the promo film. Upload one on the product page.", { retrySafe: false, step: "assets" });
  if (useScreens && brand.screenshots.length === 0) throw new PipelineError("At least one screenshot is required for the promo film. Upload your app's screens on the product page.", { retrySafe: false, step: "assets" });
  const publicDir = path.dirname(await storage.localPathFor(keys.promo(projectId, "public/.keep")));
  const projectDir = path.dirname(publicDir);
  for (const d of ["app-screens", "logo", "audio"]) await mkdir(path.join(publicDir, d), { recursive: true });
  await mkdir(path.join(projectDir, "scripts"), { recursive: true });
  await copyFile(await storage.localPathFor(brand.logo.storageKey), path.join(publicDir, "logo", "app-logo.png"));
  const screens: Record<string, string> = {};
  const screenKeys: string[] = [];
  const screenshotPaths: string[] = [];
  for (const [i, s] of (useScreens ? brand.screenshots : []).entries()) {
    const name = `${String(i + 1).padStart(2, "0")}-screen.png`;
    const dest = path.join(publicDir, "app-screens", name);
    await copyFile(await storage.localPathFor(s.storageKey), dest);
    screens[`screen${i + 1}`] = `app-screens/${name}`;
    screenKeys.push(`screen${i + 1}`);
    screenshotPaths.push(dest);
  }
  await stageRuntimeAssets(publicDir);
  await copyFile(SKILL_BUILD_AUDIO, path.join(projectDir, "scripts", "build_audio.py"));
  return { projectDir, publicDir, logo: "logo/app-logo.png", screens, screenKeys, screenshotPaths };
}

function inspirationOf(params: { inspiration?: Inspiration }): Inspiration {
  return params.inspiration ?? resolveInspiration({});
}

/**
 * promo.run — route the film by inspiration mode and director.
 *   claude-code plan supplied → compile it now (no model call)
 *   custom / default          → promo.analyze_reference (fetch + breakdown)
 *   none                      → promo.storyboard (direct from SHOWREEL_PROMPT)
 */
export async function promoRun(ctx: JobContext<"promo.run">) {
  const { productId, projectId } = ctx.payload;
  const params = await projectParams({ db: ctx.db }, projectId);
  const inspiration = inspirationOf(params);
  await ctx.event("info", `inspiration mode: ${inspiration.mode}${inspiration.url ? ` (${inspiration.url})` : " (no video will be fetched)"}; director: ${params.director ?? "openrouter"}`, { inspiration, director: params.director ?? "openrouter" }, "route");

  if (params.director === "claude-code") return writeShowreel(ctx, { plan: DirectorPlan.parse(params.plan), label: params.directorLabel ?? "Claude Code" });

  if (inspiration.mode === "none") {
    await ctx.queue.enqueue("promo.storyboard", { productId, projectId }, { productId, projectId, singletonKey: `promo.storyboard:${projectId}` });
    await ctx.progress(100, "done", "directing from the showreel brief");
    return { mode: inspiration.mode };
  }
  await ctx.queue.enqueue("promo.analyze_reference", { productId, projectId, referenceUrl: inspiration.url! }, { productId, projectId, singletonKey: `promo.analyze:${projectId}` });
  await ctx.progress(100, "done", "queued inspiration analysis");
  return { mode: inspiration.mode };
}

/** Download the inspiration and keep its evidence (sheets) with the project. */
export async function collectEvidence(ctx: JobContext<"promo.analyze_reference">, url: string, scratch: string): Promise<ReferenceEvidence> {
  await ctx.progress(5, "download", `fetching the inspiration video ${url}`);
  const fetched = await fetchReference(url, scratch, ctx.signal);
  await ctx.event("info", `fetched ${fetched.url} (${fetched.fetchedWith === "default" ? "default client" : "mweb fallback after the default client failed"})`, { fetchedWith: fetched.fetchedWith }, "download");
  await ctx.progress(25, "evidence", "detecting cuts and building contact sheets");
  const evidence = await referenceEvidence(fetched, scratch, ctx.signal);
  const storage = getStorage();
  for (const [i, s] of evidence.sheets.entries()) {
    await storage.putBuffer(keys.promo(ctx.payload.projectId, `reference/sheet-${i + 1}-${s.kind}.jpg`), await readFile(s.path), { contentType: "image/jpeg" });
  }
  return evidence;
}

/**
 * promo.analyze_reference — reverse-engineer the inspiration (custom or
 * default). The breakdown is cached per video: the same reference is not paid
 * for twice, and the project records whether it reused one.
 */
export async function promoAnalyzeReference(ctx: JobContext<"promo.analyze_reference">) {
  const { productId, projectId } = ctx.payload;
  const params = await projectParams({ db: ctx.db }, projectId);
  const inspiration = inspirationOf(params);
  if (inspiration.mode === "none" || !inspiration.url) throw new PipelineError("analyze_reference ran for a promo with no inspiration video", { step: "route", retrySafe: false });
  const profile = await loadProfile(ctx.db, productId, projectId);
  const storage = getStorage();
  const url = inspiration.url;
  const cacheKey = `references/breakdowns/${parseVideoId(url)}-${BREAKDOWN_VERSION}.json`;
  const cached = await storage.getBuffer(cacheKey).then((b) => JSON.parse(b.toString("utf8")) as { breakdown: unknown; evidence: Omit<ReferenceEvidence, "file" | "sheets"> & { sheets: unknown[] }; model: string; analyzedAt: string }, () => null);

  let breakdown: ReferenceBreakdown;
  let provenance: Record<string, unknown>;
  if (cached) {
    breakdown = ReferenceBreakdown.parse(cached.breakdown);
    provenance = { reused: true, analyzedAt: cached.analyzedAt, model: cached.model, url, cutCount: cached.evidence.cutTimes.length };
    await ctx.event("info", `reusing the breakdown of ${url} made ${cached.analyzedAt} by ${cached.model}`, provenance, "reference");
  } else {
    const result = await withScratch("reference", async (scratch) => {
      const evidence = await collectEvidence(ctx, url, scratch);
      await ctx.progress(55, "vision", `Opus reading ${evidence.sheets.length} contact sheets`);
      const read = await breakdownWithModel(ctx, evidence, projectId, profile, productId);
      const { file: _file, ...rest } = evidence;
      const record = { breakdown: read.breakdown, evidence: { ...rest, sheets: evidence.sheets.map(({ path: _p, ...s }) => s) }, model: `${read.provider}/${read.model}`, analyzedAt: new Date().toISOString() };
      // The cache only saves a repeat read; failing to write it must not fail the film.
      await storage.putBuffer(cacheKey, Buffer.from(JSON.stringify(record, null, 2)), { contentType: "application/json" }).catch((err) => ctx.event("warn", `could not cache the breakdown: ${err instanceof Error ? err.message : String(err)}`, undefined, "reference"));
      return { breakdown: read.breakdown, provenance: { reused: false, analyzedAt: record.analyzedAt, model: record.model, url, cutCount: evidence.cutTimes.length, fetchedWith: evidence.fetchedWith } };
    });
    breakdown = result.breakdown;
    provenance = result.provenance;
  }
  await storage.putBuffer(keys.promo(projectId, "reference/breakdown.json"), Buffer.from(JSON.stringify({ breakdown, provenance }, null, 2)), { contentType: "application/json" });
  await mergeParams(ctx.db, projectId, { referenceBreakdown: breakdown, referenceProvenance: provenance });
  await ctx.queue.enqueue("promo.storyboard", { productId, projectId }, { productId, projectId, singletonKey: `promo.storyboard:${projectId}` });
  await ctx.progress(100, "done", "breakdown ready; directing the film");
  return { reused: Boolean(provenance.reused) };
}

/** promo.storyboard — Opus 5.5 directs the film from the brief (and breakdown), then it is compiled. */
export async function promoStoryboard(ctx: JobContext<"promo.storyboard">) {
  const { productId, projectId } = ctx.payload;
  const params = await projectParams({ db: ctx.db }, projectId);
  const inspiration = inspirationOf(params);
  const profile = await loadProfile(ctx.db, productId, projectId);
  const staged = await stagePromoAssets(ctx, profile, projectId, { screenshots: params.useScreenshots !== false });
  const breakdown = params.referenceBreakdown ? ReferenceBreakdown.parse(params.referenceBreakdown) : null;
  if (inspiration.mode !== "none" && !breakdown) throw new PipelineError("the inspiration breakdown is missing; analyze the reference first", { step: "direct", retrySafe: false });
  await ctx.progress(20, "direct", inspiration.mode === "none" ? "directing from the showreel brief" : "directing from the inspiration breakdown");
  const theme = themeForProduct(profile);
  const directed = await withScratch("direct", (scratch) =>
    planWithModel(ctx, {
      prompt: params.creativePrompt,
      projectId,
      productId,
      profile,
      inspiration,
      breakdown,
      screenshotPaths: staged.screenshotPaths,
      scratch,
      compile: { profile, screenKeys: staged.screenKeys, screens: staged.screens, logo: staged.logo, theme },
    }),
  );
  return writeShowreel(ctx, { plan: directed.plan, label: `${directed.provider}/${directed.model}`, compiled: directed.compiled, staged, theme });
}

/** Compile (if needed), document and hand off to the renderer. Shared by both directors. */
export async function writeShowreel(
  ctx: JobContext<"promo.run"> | JobContext<"promo.storyboard">,
  input: { plan: DirectorPlan; label: string; compiled?: ReturnType<typeof compileShowreel>; staged?: Staged; theme?: ReturnType<typeof themeForProduct> },
) {
  const { productId, projectId } = ctx.payload;
  const db = ctx.db;
  const params = await projectParams({ db }, projectId);
  const inspiration = inspirationOf(params);
  const profile = await loadProfile(db, productId, projectId);
  const staged = input.staged ?? (await stagePromoAssets(ctx, profile, projectId, { screenshots: params.useScreenshots !== false }));
  const theme = input.theme ?? themeForProduct(profile);
  const compiled = input.compiled ?? compileShowreel({ plan: input.plan, profile, screenKeys: staged.screenKeys, screens: staged.screens, logo: staged.logo, theme });
  const { storyboard, notes } = compiled;
  const storage = getStorage();
  const spent = await promoSpendUsd(db, projectId);
  const breakdown = params.referenceBreakdown ? ReferenceBreakdown.parse(params.referenceBreakdown) : null;

  const md = showreelMarkdown({ screenshotsUsed: staged.screenKeys.length, prompt: params.creativePrompt?.trim() || SHOWREEL_PROMPT, profile, inspiration, plan: input.plan, breakdown, provenance: params.referenceProvenance ?? null, director: input.label, storyboard, notes, spent });
  const mdKey = keys.promo(projectId, "CREATIVE_DIRECTION.md");
  await storage.putBuffer(mdKey, Buffer.from(md), { contentType: "text/markdown" });
  const sbKey = keys.promo(projectId, "storyboard.json");
  await storage.putBuffer(sbKey, Buffer.from(JSON.stringify({ storyboard, theme, plan: input.plan }, null, 2)), { contentType: "application/json" });
  for (const [type, key, mime] of [["creative_direction_md", mdKey, "text/markdown"], ["storyboard", sbKey, "application/json"]] as const) {
    await saveGeneratedAsset(db, { id: newId(), productId, projectId, type, storageKey: key, mimeType: mime, status: "review", approvalState: "pending", profileVersion: profile.version, jobId: ctx.jobId, metadata: { inspiration: inspiration.mode, director: input.label, scenes: storyboard.scenes.length } });
  }
  await mergeParams(db, projectId, { storyboard, theme, publicDir: staged.publicDir, plan: input.plan, directionProvider: input.label, structureId: `showreel-${inspiration.mode}`, notes });
  await ctx.event("info", `film: ${storyboard.scenes.map((s) => `${s.kind}${s.transition !== "cut" ? `(${s.transition})` : ""}`).join(" → ")}`, undefined, "direct");
  await ctx.queue.enqueue("promo.build", { productId, projectId }, { productId, projectId, singletonKey: `promo.build:${projectId}` });
  await ctx.progress(100, "done", "storyboard written");
  return { mode: inspiration.mode, scenes: storyboard.scenes.length, director: input.label, spentUsd: spent };
}

function showreelMarkdown(i: {
  screenshotsUsed: number;
  prompt: string;
  profile: ProductProfile;
  inspiration: Inspiration;
  plan: DirectorPlan;
  breakdown: ReferenceBreakdown | null;
  provenance: Record<string, unknown> | null;
  director: string;
  storyboard: ReturnType<typeof compileShowreel>["storyboard"];
  notes: string[];
  spent: number;
}): string {
  const p = i.profile.product;
  const t = (f: number) => `${(f / i.storyboard.fps).toFixed(2)}s`;
  const mode = { custom: "A · custom YouTube inspiration", default: "B · default YouTube inspiration (toggle on)", none: "C · no inspiration (showreel brief)" }[i.inspiration.mode];
  return `# ${p.name} — promo film creative direction

_Generated ${new Date().toISOString().slice(0, 10)} · director: ${i.director} · provider spend for this film: $${i.spent.toFixed(4)} (cap $${promoCapUsd().toFixed(2)})_

## Mode
**${mode}**${i.inspiration.url ? `\n\nInspiration: ${i.inspiration.url}` : "\n\nNo reference video was fetched."}\n\nAssets: logo${i.screenshotsUsed ? ` + ${i.screenshotsUsed} app screenshot${i.screenshotsUsed === 1 ? "" : "s"}` : " only; no app screenshots were given to the director or the film"}.

${i.inspiration.mode === "none" ? `## Brief (verbatim)\n${i.prompt.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n")}\n` : ""}
## Concept
${i.plan.concept}
${i.breakdown ? `
## Reference breakdown
${i.breakdown.summary}

- Length ${i.breakdown.durationSec}s · ${i.breakdown.cutCount} hard cuts · a beat every ${i.breakdown.beatRateSec}s
- Acts: ${i.breakdown.acts.map((a) => `${a.name} (${a.startSec}–${a.endSec}s: ${a.job})`).join("; ")}
- Transitions: ${i.breakdown.transitions.join("; ") || "—"}
- Camera: ${i.breakdown.camera.join("; ") || "—"}
- Typography: ${i.breakdown.typography.join("; ") || "—"}
- Signature devices: ${i.breakdown.signatureDevices.map((d) => `**${d.name}** — ${d.description}`).join("; ")}
${i.provenance ? `- Analysis: ${i.provenance.reused ? `reused from ${String(i.provenance.analyzedAt)}` : `fetched and analyzed ${String(i.provenance.analyzedAt)}`} by ${String(i.provenance.model)}` : ""}

## Devices taken from the reference
${i.plan.referenceDevices.map((d) => `- **${d.device}** — ${d.howUsed}`).join("\n") || "—"}

## Self-check
${i.plan.selfCheck || "—"}
` : ""}
## Storyboard (15s · 60fps · ${i.storyboard.scenes.length} scenes)
| # | in | kind | transition | copy | screens |
|---|----|------|-----------|------|---------|
${i.storyboard.scenes.map((s, n) => `| ${n + 1} | ${t(s.start)} | ${s.kind} | ${s.transition} | ${Object.values(s.copy).join(" · ").replace(/\|/g, "/")} | ${(s.screens ?? []).join(", ")} |`).join("\n")}

## Production
- Motion: Remotion; UI and typography through Cube Motion (cube-motion 0.1.0 via the skill's cube.tsx bridge); cinematic layer via springs/easings.
- Sound: ${i.storyboard.sfx.length} cues mixed by the skill's build_audio.py (no music, no bed).
- Exports: 1080×1920, 1920×1080, 886×1920 and 1920×886 (App Store cuts at 30fps).
${i.notes.map((n) => `- ${n}`).join("\n")}
`;
}
