/**
 * Direct a promo film from a Claude Code session instead of OpenRouter.
 *
 * The same pipeline, with a different director: evidence is gathered by the
 * pipeline's own code, the plan is validated by the same compiler, and the
 * film is rendered by the same jobs. Only the creative decisions come from the
 * session (Opus 5.5 in Claude Code) rather than from an API call.
 *
 *   # 1. For reference modes, gather the evidence the director reads:
 *   pnpm exec tsx scripts/promo-direct.ts prepare --mode default
 *   pnpm exec tsx scripts/promo-direct.ts prepare --mode custom --url <youtube url>
 *
 *   # 2. Write breakdown.json (reference modes) and plan.json, then queue the film:
 *   pnpm exec tsx scripts/promo-direct.ts run <productId> --mode none|default|custom [--url <url>]
 *        --plan plan.json [--breakdown breakdown.json] [--evidence evidence.json] [--label "Claude Code · Opus 5.5"]
 *
 *   # Mode none with your own brief instead of the built-in showreel prompt: add --prompt-file brief.txt
 *
 *   # Logo, name and description only, no app screenshots anywhere: add --no-screens
 *
 *   # Print the exact brief a director works from (what the OpenRouter call sends):
 *   pnpm exec tsx scripts/promo-direct.ts brief <productId> --mode none|default|custom [--url <url>] [--breakdown breakdown.json]
 */
import "./_env";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { newId } from "@distribution/core";
import { closeDb, eq, getDb, projects, products } from "@distribution/db";
import { JobQueue } from "@distribution/jobs";
import { DirectorPlan, ReferenceBreakdown, compileShowreel, directorBrief, evidenceText, fetchReference, referenceEvidence, resolveInspiration, themeForProduct, type Inspiration } from "@distribution/pipelines";
import { profileAssets } from "@distribution/pipelines/profile-assets";
import { loadProfile } from "../packages/pipelines/src/shorts/common";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** --prompt-file: a none-mode brief for this film instead of SHOWREEL_PROMPT. */
async function promptFromArgs(): Promise<string | undefined> {
  const f = arg("prompt-file");
  if (!f) return undefined;
  const text = (await readFile(f, "utf8")).trim();
  if (!text) throw new Error(`${f} is empty`);
  return text;
}

function inspirationFromArgs(): Inspiration {
  const mode = arg("mode");
  if (mode === "custom") {
    const url = arg("url");
    if (!url) throw new Error("--mode custom needs --url");
    return resolveInspiration({ inspirationUrl: url });
  }
  if (mode === "default") return resolveInspiration({ useDefaultInspiration: true });
  if (mode === "none") return resolveInspiration({ useDefaultInspiration: false });
  throw new Error("--mode must be none, default or custom");
}

async function prepare() {
  const inspiration = inspirationFromArgs();
  if (!inspiration.url) throw new Error("mode none fetches no video; there is nothing to prepare");
  const dir = path.resolve("storage/tmp/promo-evidence", `${inspiration.mode}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const fetched = await fetchReference(inspiration.url, dir);
  const evidence = await referenceEvidence(fetched, dir);
  await writeFile(path.join(dir, "evidence.json"), JSON.stringify({ ...evidence, text: evidenceText(evidence) }, null, 2));
  console.log(evidenceText(evidence));
  console.log(`\nevidence: ${path.join(dir, "evidence.json")}`);
  for (const s of evidence.sheets) console.log(`sheet: ${s.path}`);
}

/** --no-screens: the film is made from the name, description and logo only. */
const noScreens = () => process.argv.includes("--no-screens");

async function screenInfo(productId: string) {
  const db = getDb();
  const profile = await loadProfile(db, productId);
  const found = await profileAssets(db, profile);
  const brand = noScreens() ? { ...found, screenshots: [] } : found;
  const screenKeys = brand.screenshots.map((_, i) => `screen${i + 1}`);
  const screens = Object.fromEntries(screenKeys.map((k, i) => [k, `app-screens/${String(i + 1).padStart(2, "0")}-screen.png`]));
  return { db, profile, brand, screenKeys, screens };
}

async function brief(productId: string) {
  const inspiration = inspirationFromArgs();
  const { profile, brand } = await screenInfo(productId);
  const bPath = arg("breakdown");
  const breakdown = bPath ? ReferenceBreakdown.parse(JSON.parse(await readFile(bPath, "utf8"))) : null;
  const b = directorBrief({ profile, inspiration, breakdown, screenshotCount: brand.screenshots.length, prompt: await promptFromArgs() });
  console.log(`SYSTEM:\n${b.system}\n\nUSER:\n${b.user}`);
  console.log(`\nSCREENSHOTS (in order):`);
  for (const [i, s] of brand.screenshots.entries()) console.log(`  ${i + 1}. storage/${s.storageKey}`);
}

async function runFilm(productId: string) {
  const inspiration = inspirationFromArgs();
  const planPath = arg("plan");
  if (!planPath) throw new Error("run needs --plan plan.json");
  const plan = DirectorPlan.parse(JSON.parse(await readFile(planPath, "utf8")));
  const bPath = arg("breakdown");
  const breakdown = bPath ? ReferenceBreakdown.parse(JSON.parse(await readFile(bPath, "utf8"))) : null;
  if (inspiration.mode !== "none" && !breakdown) throw new Error(`mode ${inspiration.mode} needs --breakdown (the reverse-engineering of ${inspiration.url})`);
  if (inspiration.mode === "none" && breakdown) throw new Error("mode none uses no reference; do not pass --breakdown");
  const evidencePath = arg("evidence");
  const evidence = evidencePath ? (JSON.parse(await readFile(evidencePath, "utf8")) as { url: string; cutTimes: number[]; fetchedWith: string; sheets: unknown[] }) : null;

  const { db, profile, screenKeys, screens } = await screenInfo(productId);
  // Validate now, with the pipeline's compiler, so a bad plan fails before queuing.
  compileShowreel({ plan, profile, screenKeys, screens, logo: "logo/app-logo.png", theme: themeForProduct(profile) });

  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!product) throw new Error(`no product ${productId}`);
  const projectId = newId();
  const label = arg("label") ?? "Claude Code · Opus 5.5";
  const creativePrompt = await promptFromArgs();
  if (creativePrompt && inspiration.mode !== "none") throw new Error("--prompt-file is the brief for mode none; reference modes are directed from the video");
  await db.insert(projects).values({
    id: projectId,
    productId,
    kind: "promo",
    profileVersion: product.version,
    status: "running",
    params: {
      profileSnapshot: profile,
      durationSec: 15,
      inspiration,
      director: "claude-code",
      directorLabel: label,
      ...(creativePrompt ? { creativePrompt } : {}),
      ...(noScreens() ? { useScreenshots: false } : {}),
      plan,
      ...(breakdown ? { referenceBreakdown: breakdown, referenceProvenance: { reused: false, analyzedAt: new Date().toISOString(), model: label, url: inspiration.url, cutCount: evidence?.cutTimes.length ?? breakdown.cutCount, fetchedWith: evidence?.fetchedWith ?? null, sheets: evidence?.sheets.length ?? null } } : {}),
    },
  });
  const queue = await JobQueue.start(db);
  const r = await queue.enqueue("promo.run", { productId, projectId, durationSec: 15 }, { productId, projectId, singletonKey: `promo.run:${projectId}` });
  await queue.stop();
  console.log(JSON.stringify({ projectId, mode: inspiration.mode, inspirationUrl: inspiration.url, director: label, ...r }));
}

async function main() {
  const [cmd, productId] = process.argv.slice(2);
  if (cmd === "prepare") await prepare();
  else if (cmd === "brief" && productId) await brief(productId);
  else if (cmd === "run" && productId) await runFilm(productId);
  else throw new Error("usage: promo-direct.ts prepare|brief|run … (see the header)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
