import { z } from "zod";
import { PipelineError, productContextBlock, type ProductProfile } from "@distribution/core";
import { getLlm, type CallContext } from "@distribution/providers";

/** Platform rules the copywriter must respect. Kept as data so it is auditable. */
export const PLATFORM_RULES: Record<string, { titleMax: number; captionMax: number; hashtags: [number, number]; notes: string }> = {
  x: { titleMax: 0, captionMax: 280, hashtags: [0, 2], notes: "One post, ≤280 chars including hashtags. No title. Hook is the first line." },
  instagram: { titleMax: 0, captionMax: 2200, hashtags: [3, 8], notes: "First line is the hook (shown before 'more'). Line breaks OK. Hashtags at the end." },
  tiktok: { titleMax: 90, captionMax: 2200, hashtags: [2, 5], notes: "Title ≤90 chars. Conversational. Hashtags inline or at end." },
  youtube: { titleMax: 100, captionMax: 5000, hashtags: [2, 4], notes: "Title ≤100 chars, front-load the keyword. Description: first 2 lines matter. Hashtags at end." },
  linkedin: { titleMax: 0, captionMax: 3000, hashtags: [1, 3], notes: "Professional but plain. First line is the hook. Short paragraphs. Hashtags at end." },
  facebook: { titleMax: 0, captionMax: 2000, hashtags: [0, 2], notes: "Plain, conversational. Ask a question or make one claim." },
  threads: { titleMax: 0, captionMax: 500, hashtags: [0, 1], notes: "≤500 chars, casual." },
  pinterest: { titleMax: 100, captionMax: 500, hashtags: [0, 3], notes: "Title ≤100, description ≤500, keyword-rich." },
  reddit: { titleMax: 300, captionMax: 4000, hashtags: [0, 0], notes: "Title is everything; no marketing tone; no hashtags." },
  bluesky: { titleMax: 0, captionMax: 300, hashtags: [0, 2], notes: "≤300 chars." },
};

export const PlatformCopy = z.object({
  hook: z.string().min(1).max(200),
  title: z.string().max(300).default(""),
  caption: z.string().min(1).max(5000),
  description: z.string().max(5000).default(""),
  hashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]+$/u)).max(12).default([]),
  cta: z.string().max(200).default(""),
});
export type PlatformCopy = z.infer<typeof PlatformCopy>;

const CopyResponse = z.object({ platforms: z.record(z.string(), PlatformCopy) });

export interface CopyInput {
  profile: ProductProfile;
  platforms: string[];
  /** transcript excerpt or scene summary the asset is made from */
  transcriptExcerpt: string;
  /** the clip's hook / the promo's tagline */
  hook?: string;
  assetKind: "clip" | "promo";
  durationSec?: number;
  attribution?: string;
}

export function buildCopyPrompt(input: CopyInput): { system: string; user: string } {
  const prefs = input.profile.contentPreferences;
  const rules = input.platforms
    .map((p) => {
      const r = PLATFORM_RULES[p] ?? PLATFORM_RULES.instagram!;
      return `- ${p}: caption ≤ ${r.captionMax} chars${r.titleMax ? `, title ≤ ${r.titleMax} chars` : ", no title"}, ${r.hashtags[0]}–${r.hashtags[1]} hashtags. ${r.notes}`;
    })
    .join("\n");
  const hashtagPolicy = prefs.hashtagStrategy === "none" ? "Use zero hashtags everywhere." : prefs.hashtagStrategy === "many" ? "Use the upper end of each platform's hashtag range." : "Use the lower end of each platform's hashtag range, only specific ones.";
  const system = `You write social copy for a founder's own product. You are given the product context, the exact words spoken in the clip (or the promo's storyboard), and per-platform rules.

Hard rules:
- Every claim must be supported by the transcript or the product context. Never invent features, numbers, awards or quotes.
- Write in the product's tone: ${prefs.copyTone}. No filler ("In today's fast-paced world"), no clickbait that the clip does not pay off, no emoji walls (max 1 emoji per post, 0 for linkedin/reddit).
- The hook is one line that makes the specific moment worth watching; it is not the product tagline.
- Mention at most one product feature per post, and only one that the moment actually relates to.
- ${hashtagPolicy} Hashtags are lowercase, no spaces, without the # sign in the JSON.
- The CTA is one short sentence that fits the platform (e.g. "Link in bio", "Free on the App Store").
${input.attribution ? `- Include this attribution line verbatim at the end of every caption: "${input.attribution}"` : ""}
Respond with a single JSON object: {"platforms": {"<platform>": {"hook","title","caption","description","hashtags":[],"cta"}}} with exactly the requested platforms as keys.`;
  const user = `${productContextBlock(input.profile)}

ASSET: ${input.assetKind}${input.durationSec ? `, ${Math.round(input.durationSec)}s` : ""}
${input.hook ? `HOOK USED IN THE VIDEO: ${input.hook}\n` : ""}
WHAT IS SAID / SHOWN:
"""
${input.transcriptExcerpt.slice(0, 6000)}
"""

PLATFORMS AND RULES:
${rules}

LANGUAGE: ${prefs.languages[0] ?? "en"}`;
  return { system, user };
}

/** Provider-agnostic: goes through the router's `copy` purpose chain. */
export async function generatePlatformCopy(input: CopyInput, ctx: CallContext): Promise<Record<string, PlatformCopy>> {
  const { system, user } = buildCopyPrompt(input);
  const res = await getLlm().chat({ system, messages: [{ role: "user", content: user }], maxTokens: 2000, temperature: 0.4, json: true }, { ...ctx, purpose: "copy", maxOutputTokens: ctx.maxOutputTokens ?? 2000 });
  const parsed = safeJson(res.text);
  const out = CopyResponse.safeParse(parsed);
  if (!out.success) throw new PipelineError("copy generation returned an unexpected shape", { retrySafe: true, step: "copy", details: { issues: out.error.issues.slice(0, 5) } });
  const result: Record<string, PlatformCopy> = {};
  for (const p of input.platforms) {
    const c = out.data.platforms[p];
    if (!c) throw new PipelineError(`copy missing for platform ${p}`, { retrySafe: true, step: "copy" });
    const r = PLATFORM_RULES[p];
    result[p] = { ...c, hashtags: c.hashtags.map((h) => h.replace(/^#/, "").toLowerCase()), caption: r ? c.caption.slice(0, r.captionMax) : c.caption, title: r && r.titleMax ? c.title.slice(0, r.titleMax) : c.title };
  }
  return result;
}

/** Fence-strip + brace-carve, tolerant of prose around the JSON (same idea as llm.rs extract_json_span). */
export function safeJson(text: string): unknown {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const a = stripped.indexOf("{");
    const b = stripped.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(stripped.slice(a, b + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new PipelineError("model output is not JSON", { retrySafe: true, step: "copy", details: { head: text.slice(0, 200) } });
  }
}
