import type { ProductProfile } from "@distribution/core";
import { rankReferences } from "@distribution/pipelines/reference-ranking";
import { parseVideoId } from "@distribution/media";
import { db, referenceVideos, type Db } from "./db";
export async function referenceChoices(profile: ProductProfile, durationSec: number, database: Pick<Db, "select"> = db) {
  const rows = (await database.select().from(referenceVideos)).filter(row => { try { parseVideoId(row.url); return true; } catch { return false; } });
  return rankReferences(rows, { id: profile.id, category: profile.product.category, platforms: profile.product.platforms, ground: profile.brand.palette?.ground, durationSec }).slice(0, 3).map(reference => ({ id: reference.id, title: reference.title, url: reference.url, score: reference.score, reasons: reference.reasons, visualLanguage: reference.visualLanguage, durationSec: reference.durationSec, posterUrl: `https://i.ytimg.com/vi/${parseVideoId(reference.url)}/hqdefault.jpg` }));
}
