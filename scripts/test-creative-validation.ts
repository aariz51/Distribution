import "./_env";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateCreative } from "../packages/pipelines/src/shorts/sidecars";
import { getStorage } from "@distribution/storage";

async function main() {
  const real = await getStorage().localPathFor("projects/87a4532a-92e7-4408-a6cc-18079b5d948a/thumbnails/80ff08d1-1d9b-41dd-9483-41f8e0cac3d9-portrait.png");
  const temp = await mkdtemp(path.join(os.tmpdir(), "cover-validation-"));
  const expectFailure = async (file: string, size: [number, number]) => {
    let failed = false;
    try { await validateCreative(file, size); } catch { failed = true; }
    if (!failed) throw new Error(`Invalid cover accepted: ${path.basename(file)}`);
  };
  try {
    await validateCreative(real, [1080, 1920]);
    await expectFailure(real, [1280, 720]);
    const bytes = await readFile(real), corrupt = path.join(temp, "truncated.png"), empty = path.join(temp, "empty.png");
    await writeFile(corrupt, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await writeFile(empty, "");
    await expectFailure(corrupt, [1080, 1920]);
    await expectFailure(empty, [1080, 1920]);
    console.log("PASS: real SafeChoice cover decodes; wrong dimensions, empty and truncated PNGs rejected");
  } finally { await rm(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
