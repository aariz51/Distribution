/** Real SafeChoice composition renders; exercises worker isolation and bundle cleanup. */
import "./_env";
import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeDb, eq, getDb, projects } from "@distribution/db";
import { assertDiskSpace, bin, probeMedia, run } from "@distribution/media";
import { renderPromoStill, type Storyboard, type Theme } from "../packages/promo-kit/src/render";

async function main() {
  if (!process.env.DATABASE_URL?.includes("distribution_qa_")) throw new Error("Use QA database");
  const db = getDb();
  const project = (await db.select().from(projects).where(eq(projects.id, "9e0ce875-5236-4494-b179-b184ce3c660b")))[0];
  if (!project || project.productId !== "3fe71fcc-3101-432d-a1ec-583d785592a4") throw new Error("Verified SafeChoice project missing");
  const params = project.params as { storyboard: Storyboard; theme: Theme; publicDir: string };
  if (params.storyboard?.product.name !== "SafeChoice" || !path.isAbsolute(params.publicDir)) throw new Error("Expected real SafeChoice input");
  const workspace = path.resolve(import.meta.dirname, "..");
  const output = path.join(workspace, "storage/tmp/promo-bundle-lifecycle");
  await mkdir(output, { recursive: true });
  await assertDiskSpace(output, 250 * 1024 ** 2, "single-frame lifecycle verification");
  const namespace = path.join(workspace, "packages/promo-kit/src/index.ts");
  const root = path.join(os.tmpdir(), "distribution-remotion-bundles", createHash("sha256").update(namespace).digest("hex").slice(0, 20));
  const cwd = process.cwd();
  const options = { ...params, compositionId: "PromoVertical" as const, frame: 8 * params.storyboard.fps };
  for (const name of ["first", "second"]) {
    const file = path.join(output, `${name}.png`);
    await renderPromoStill({ ...options, outPath: file });
    const probe = await probeMedia(file);
    if (probe.width !== 1080 || probe.height !== 1920 || probe.videoCodec !== "png") throw new Error("Real SafeChoice still is invalid");
    await run(bin("ffmpeg"), ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"], { timeoutMs: 30_000 });
    if ((await readdir(root)).length || process.cwd() !== cwd) throw new Error("Bundle or cwd leaked after a real render");
    console.log(`PASS: real SafeChoice ${name} still, full decode, no retained bundle and unchanged cwd`);
  }
  const controller = new AbortController(), cancelledFile = path.join(output, `cancelled-${Date.now()}.png`);
  const timer = setTimeout(() => controller.abort(), 20);
  let cancelled = false;
  try { await renderPromoStill({ ...options, outPath: cancelledFile, signal: controller.signal }); }
  catch (error) { if (!controller.signal.aborted || !(error instanceof Error) || error.name !== "AbortError") throw error; cancelled = true; }
  finally { clearTimeout(timer); }
  if (!cancelled || await stat(cancelledFile).then(() => true, () => false) || (await readdir(root)).length || process.cwd() !== cwd) throw new Error("Actual bundle cancellation left output or temporary files");
  console.log("PASS: cancelled real bundle settled before cleanup; no render output or retained bundle");
}
main().finally(closeDb).catch(error => { console.error(error.message); process.exitCode = 1; });
