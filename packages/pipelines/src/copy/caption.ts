import twitterText from "twitter-text";
import { PipelineError } from "@distribution/core";

export const captionLength = (text: string, platform?: string): number => platform === "x" ? twitterText.parseTweet(text).weightedLength : text.length;

export interface CaptionParts { caption: string; cta: string; hashtags: string[] }
export function composeCaption(parts: CaptionParts, attribution?: string): string {
  const caption = parts.caption.trim();
  return [caption, parts.cta.trim(), parts.hashtags.map(h => `#${h.replace(/^#/, "")}`).join(" "), attribution && !caption.includes(attribution) ? attribution : ""].filter(Boolean).join("\n\n");
}

/** Preserve required credits. Fit generated prose and optional extras around them. */
export function fitGeneratedCaption(parts: CaptionParts, maximum: number, attribution?: string, platform?: string): CaptionParts {
  let prose = attribution ? parts.caption.replaceAll(attribution, "").trim() : parts.caption.trim();
  const credit = attribution?.trim() ?? "";
  const length = (text: string) => captionLength(text, platform);
  if (length(credit) > maximum) throw new PipelineError("Source attribution does not fit this platform. Use a platform with a longer caption limit.", { step: "copy", retrySafe: false });
  const result = { ...parts, hashtags: parts.hashtags.map(h => h.replace(/^#/, "").toLowerCase()) };
  // Keep space for meaningful prose before retaining optional hashtags/CTA.
  const available = () => {
    const rest = composeCaption({ ...result, caption: credit });
    return maximum - length(rest) - (rest ? 2 : 0);
  };
  while (result.hashtags.length && available() < Math.min(60, prose.length)) result.hashtags.pop();
  if (available() < Math.min(60, prose.length)) result.cta = "";
  const budget = Math.max(0, available());
  prose = prose.slice(0, budget).trimEnd();
  // Avoid cutting a UTF-16 surrogate pair at the boundary.
  if (/[\uD800-\uDBFF]$/.test(prose)) prose = prose.slice(0, -1);
  while (prose && length(prose) > budget) prose = Array.from(prose).slice(0, -1).join("");
  result.caption = [prose, credit].filter(Boolean).join("\n\n");
  if (!result.caption || length(composeCaption(result)) > maximum) throw new PipelineError("Generated caption exceeds the platform limit", { step: "copy" });
  return result;
}
