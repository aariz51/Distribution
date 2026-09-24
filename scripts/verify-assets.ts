/**
 * Production check: every video/image asset row must point at a file that
 * exists, decodes, and matches the dimensions and duration the row claims.
 * A row without a playable file is worse than no row — the UI shows a card the
 * user cannot use.
 *
 *   pnpm exec tsx scripts/verify-assets.ts [--deep]
 * Add --project <UUID> to verify one completed run without scanning older assets.
 * --deep additionally decodes every frame (slow, catches truncation).
 */
import "./_env";
import { closeDb, getDb, assets, desc, eq } from "@distribution/db";
import { getStorage } from "@distribution/storage";
import { bin, run } from "@distribution/media";

interface Row {
  id: string;
  type: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: number | null;
}

const deep = process.argv.includes("--deep");
const projectFlag = process.argv.indexOf("--project");
const projectId = projectFlag >= 0 ? process.argv[projectFlag + 1] : undefined;

async function probe(path: string) {
  const res = await run(bin("ffprobe"), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], { timeoutMs: 120_000, step: "verify" });
  return JSON.parse(res.stdout) as {
    format?: { duration?: string; size?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; nb_read_packets?: string }[];
  };
}

async function main() {
  const db = getDb();
  const storage = getStorage();
  if (projectFlag >= 0 && (!projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId))) throw new Error("--project requires a project UUID");
  const rows = (await db.select().from(assets).where(projectId ? eq(assets.projectId, projectId) : undefined).orderBy(desc(assets.createdAt))) as unknown as Row[];
  if (!rows.length) throw new Error("No assets to verify");

  let ok = 0;
  const problems: string[] = [];

  for (const r of rows) {
    const label = `${r.type} ${r.id.slice(0, 8)}`;
    const head = await storage.head(r.storageKey);
    if (!head) {
      problems.push(`${label}: MISSING FILE at ${r.storageKey}`);
      continue;
    }
    if (head.size === 0) {
      problems.push(`${label}: ZERO BYTES`);
      continue;
    }

    if (r.mimeType.startsWith("video/")) {
      const path = await storage.localPathFor(r.storageKey);
      try {
        const p = await probe(path);
        const v = p.streams?.find((s) => s.codec_type === "video");
        if (!v) {
          problems.push(`${label}: no video stream`);
          continue;
        }
        const dur = Number(p.format?.duration ?? 0);
        if (!(dur > 0)) {
          problems.push(`${label}: duration is ${dur}`);
          continue;
        }
        if (r.width && v.width !== r.width) problems.push(`${label}: width ${v.width} but row says ${r.width}`);
        if (r.height && v.height !== r.height) problems.push(`${label}: height ${v.height} but row says ${r.height}`);
        if (r.durationSec && Math.abs(dur - r.durationSec) > 0.75) {
          problems.push(`${label}: duration ${dur.toFixed(2)}s but row says ${r.durationSec.toFixed(2)}s`);
        }
        if (deep) {
          // Decode everything; a truncated file fails here but passes a header probe.
          await run(bin("ffmpeg"), ["-v", "error", "-i", path, "-f", "null", "-"], { timeoutMs: 600_000, step: "verify" });
        }
        ok++;
      } catch (err) {
        problems.push(`${label}: UNDECODABLE — ${err instanceof Error ? err.message.slice(0, 120) : err}`);
      }
    } else if (r.mimeType.startsWith("image/")) {
      const path = await storage.localPathFor(r.storageKey);
      try {
        const p = await probe(path);
        const v = p.streams?.find((s) => s.codec_type === "video");
        if (!v?.width) problems.push(`${label}: not a decodable image`);
        else ok++;
      } catch (err) {
        problems.push(`${label}: UNDECODABLE IMAGE — ${err instanceof Error ? err.message.slice(0, 80) : err}`);
      }
    } else {
      ok++; // text/json assets: existence and non-zero size is the contract
    }
  }

  console.log(`\nchecked ${rows.length} assets${deep ? " (deep decode)" : ""}`);
  console.log(`  valid:   ${ok}`);
  console.log(`  problems:${problems.length}`);
  for (const p of problems) console.log(`   ✗ ${p}`);
  await closeDb();
  process.exit(problems.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
