import { NormalizedTranscript, PipelineError, newId, productContextBlock } from "@distribution/core";
import { candidates, eq, projects, sql, transcripts } from "@distribution/db";
import type { JobContext } from "@distribution/jobs";
import { getLlm } from "@distribution/providers";
import { loadProfile } from "./common";
import { compactSegments, parseCandidateJson, DETECTION_PROMPT, fillPrompt, withProductContext } from "./ranking";

/**
 * shorts.rank — the AutoShorts viral-moment prompt, now grounded with the
 * product profile (features, audience) so the model prefers moments that map
 * to real capabilities. Output goes through the ported JSON repair / fit /
 * overlap suppression, then the top `clipsPerSource` are selected and cut.
 */
export async function shortsRank(ctx: JobContext<"shorts.rank">) {
  const { productId, projectId, transcriptId } = ctx.payload;
  const db = ctx.db;
  const profile = await loadProfile(db, productId);
  const row = (await db.select().from(transcripts).where(eq(transcripts.id, transcriptId)).limit(1))[0];
  if (!row) throw new PipelineError("transcript not found", { step: "load" });
  const transcript = NormalizedTranscript.parse({ language: row.language, duration: row.durationSec, speakers: row.speakers, words: row.words, segments: row.segments });

  const context = `${productContextBlock(profile)}\nPREFER moments that demonstrate, explain or motivate one of the listed features, or speak directly to the audience's pain points. Note the feature number(s) a moment relates to in its rationale.`;
  const prompt = withProductContext(fillPrompt(DETECTION_PROMPT, { segments: compactSegments(transcript.segments) }), context);
  await ctx.progress(10, "rank", `asking the model for moments (${transcript.segments.length} segments)`);
  const res = await getLlm().chat(
    { messages: [{ role: "user", content: prompt }], maxTokens: 8000, temperature: 0.2, json: true },
    {
      purpose: "rank",
      signal: ctx.signal,
      log: ctx.log,
      recordUsage: (u) => ctx.recordUsage({ accountId: profile.accountId, productId, provider: u.provider, model: u.model, kind: "chat", purpose: "rank", inputTokens: u.inputTokens, outputTokens: u.outputTokens, usdEstimate: u.usdEstimate }),
    },
  );
  await ctx.progress(70, "parse", `parsing ${res.provider}/${res.model} output`);
  const drafts = parseCandidateJson(res.text, transcript, { provider: res.provider, maxCandidates: 25 });
  if (drafts.length === 0) throw new PipelineError("model returned no usable candidates", { retrySafe: true, step: "parse" });

  const wanted = profile.contentPreferences.clipsPerSource;
  const featureIdsFor = (rationale: string) =>
    profile.product.features.filter((f, i) => new RegExp(`\\b(feature\\s*#?${i + 1}|${f.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "i").test(rationale)).map((f) => f.id);

  await db.transaction(async (tx) => {
    await tx.delete(candidates).where(eq(candidates.projectId, projectId));
    for (const [i, d] of drafts.entries()) {
      await tx.insert(candidates).values({ id: newId(), projectId, transcriptId, startSec: d.startSec, endSec: d.endSec, score: d.score, hook: d.hook, rationale: d.rationale, rank: i + 1, selected: i < wanted, featureIds: featureIdsFor(d.rationale) });
    }
    await tx.update(projects).set({ status: "running", updatedAt: sql`now()` }).where(eq(projects.id, projectId));
  });
  const selected = await db.select().from(candidates).where(eq(candidates.projectId, projectId)).orderBy(candidates.rank);
  let queued = 0;
  for (const c of selected.filter((c) => c.selected)) {
    await ctx.queue.enqueue("shorts.cut", { productId, projectId, candidateId: c.id }, { productId, projectId, singletonKey: `cut:${c.id}`, priority: 10 - Math.min(9, c.rank) });
    queued++;
  }
  await ctx.event("info", `${drafts.length} candidates, ${queued} queued for cutting`, { top: drafts.slice(0, 3).map((d) => ({ start: d.startSec, end: d.endSec, score: d.score, hook: d.hook })) }, "rank");
  await ctx.progress(100, "done", `${queued} clips queued`);
  return { candidates: drafts.length, queued, provider: res.provider, model: res.model };
}
