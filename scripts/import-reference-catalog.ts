import "dotenv/config";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
import { newId } from "@distribution/core";
import { closeDb, getDb, referenceVideos } from "@distribution/db";
import { canonicalUrl, parseVideoId, probeYoutube } from "@distribution/media";
import { ReferenceAnalysis } from "../packages/pipelines/src/promo/direction";

const root = "/Users/aarizazizrasheed/Documents/Codex/2026-07-28/Promo-Video-/projects";
const sources = [
  { folder: "mori-promo", url: "https://youtu.be/4Leardp_AGc", key: "google-canvas", categoryTags: ["productivity", "devtools"], productType: "saas-web", groundPreference: "dark", style: "ui-fragment", visualLanguage: ["dark-ground", "perspective-slabs", "cursor-led-proof", "kinetic-type"] },
  { folder: "mori-launch", url: "https://youtu.be/xNUx-rMGvvw", key: "teamble", categoryTags: ["productivity", "hr"], productType: "saas-web", groundPreference: "mixed", style: "ui-fragment", visualLanguage: ["inversion", "typewriter", "perspective-slabs", "lift-out-controls"] },
  { folder: "nouri-promo", url: "https://youtu.be/Bmr_1de_pvA", key: "agency-sizzle", categoryTags: ["agency", "marketing"], productType: "agency", groundPreference: "mixed", style: "kinetic-type", visualLanguage: ["kinetic-type", "orbiting-panels", "bloom-transitions"] },
];
async function main() {
  const db = getDb();
  try {
    await mkdir(path.join(workspaceRoot, "docs/reference-catalog-evidence"), { recursive: true });
    for (const source of sources) {
      const text = await readFile(path.join(root, source.folder, "CREATIVE_DIRECTION.md"), "utf8");
      if (!text.includes(parseVideoId(source.url))) throw new Error(`Reference provenance mismatch: ${source.key}`);
      const section = text.split(/^## 2\./m)[0]!;
      const heading = /^## 1\.[^\n]*\n/m.exec(section);
      const breakdown = heading ? section.slice(heading.index + heading[0].length) : section;
      const paragraphs = breakdown.split(/\n\s*\n/).map(p => p.replace(/\s+/g, " ").trim());
      const summary = paragraphs.find(p => p.startsWith("The reference is") || p.startsWith("The reference"));
      const beats = [...breakdown.matchAll(/^\|\s*(\d+(?:\.\d+)?)\s*[–-][^|]+\|\s*([^|]+)\|\s*([^|]+)\|/gm)].map(m => ({ atSec: Number(m[1]), description: `${m[2]!.trim()}: ${m[3]!.trim()}`.slice(0, 500) })).filter((_, i, all) => all.length <= 12 || i % Math.ceil(all.length / 12) === 0).slice(0, 12);
      const meta = await probeYoutube(source.url, new AbortController().signal);
      const evidence = `docs/reference-catalog-evidence/${source.key}.md`;
      await writeFile(path.join(workspaceRoot, evidence), `# Reference evidence: ${meta.title}\n\nOriginal document: ${source.folder}/CREATIVE_DIRECTION.md\nReference: ${canonicalUrl(parseVideoId(source.url))}\n\n${breakdown}\n`);
      const parsed = ReferenceAnalysis.safeParse({ summary, visualLanguage: source.visualLanguage, beats });
      if (parsed.success && parsed.data.beats.some(b => b.atSec > meta.duration)) throw new Error(`Document timing exceeds actual reference: ${source.key}`);
      const values = { url: canonicalUrl(parseVideoId(source.url)), title: meta.title, durationSec: meta.duration, platformOfOrigin: "youtube", categoryTags: source.categoryTags, productType: source.productType, groundPreference: source.groundPreference, style: source.style, visualLanguage: source.visualLanguage, beatCount: beats.length || null, analysis: parsed.success ? { ...parsed.data, provenance: { kind: "existing-creative-direction", evidence, importedAt: new Date().toISOString() } } : null, notes: `Imported from an existing project breakdown (${evidence}). Neutral initial curator score; no new human rating. ${parsed.success ? "Timed observations available." : "No timed reference breakdown; fresh video analysis required."}`, updatedAt: new Date() };
      const inserted = await db.insert(referenceVideos).values({ id: newId(), ...values }).onConflictDoNothing({ target: referenceVideos.url }).returning({ id: referenceVideos.id });
      if (!inserted.length) { console.log(`${source.key}: already catalogued; preserved current analysis and curation`); continue; }
      console.log(`${source.key}: verified ${meta.duration}s; ${parsed.success ? "documented timed analysis imported" : "requires fresh analysis"}`);
    }
  } finally { await closeDb(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
