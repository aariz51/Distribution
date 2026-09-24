import "dotenv/config";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { screenFinalClip, requireScreenedOutput } from "../packages/pipelines/src/shorts/screening";
import type { JobContext } from "@distribution/jobs";
import { PipelineError } from "@distribution/core";
async function main() {
  const file = path.resolve("storage/projects/51b088ca-505d-4278-9b2e-69037c389e12/clips/f4cade8f-6075-43d5-894a-d0b00040a7fd/enriched.mp4");
  const ctx = { signal: new AbortController().signal, event: async (_level: string, message: string) => { if (message.startsWith("Checking") || message.startsWith("visual")) console.log(message); } } as unknown as JobContext<"shorts.enrich">;
  try {
    const report = await screenFinalClip(ctx, file);
    throw new Error(`Known music-containing output incorrectly passed: ${report.contentSha256}`);
  } catch (error) {
    if (!(error instanceof PipelineError) || error.step !== "final_screening") throw error;
    await writeFile(path.resolve("storage/tmp/finished-clip-screening-regression.json"), JSON.stringify(error.details, null, 2));
    console.log(JSON.stringify({ status: "blocked", reason: error.message }));
  }
  let missingBlocked = false;
  try { await requireScreenedOutput("projects/51b088ca-505d-4278-9b2e-69037c389e12/clips/f4cade8f-6075-43d5-894a-d0b00040a7fd/enriched.mp4", undefined, new AbortController().signal); }
  catch (error) { if (!(error instanceof PipelineError) || error.step !== "final_screening") throw error; missingBlocked = true; }
  if (!missingBlocked) throw new Error("Missing final-output evidence accepted");
  console.log("PASS: actual existing enriched SafeChoice clip assessed; publication rejects absent output-specific evidence");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
