import { PipelineError } from "@distribution/core";
import { reuseAllowed } from "@distribution/media";

/** YouTube's documented CC BY notice; keep actual title/creator/source intact. */
export function sourceAttribution(source: { rights: string; title: string | null; creator: string | null; url: string | null; licenseText: string | null }): string | undefined {
  if (source.rights === "owned" || !reuseAllowed(source.licenseText)) return undefined;
  if (!source.title?.trim() || !source.creator?.trim() || !source.url) throw new PipelineError("Licensed source needs its title, creator and original URL. Refresh source metadata before generating clips.", { step: "attribution" });
  const version = /\b([1-4]\.0)\b/.exec(source.licenseText ?? "")?.[1];
  // An unversioned provider label cannot establish a historical license version.
  const license = version ? `CC BY ${version}: https://creativecommons.org/licenses/by/${version}/` : "CC BY: https://support.google.com/youtube/answer/2797468";
  return `Source: “${source.title.trim()}” — ${source.creator.trim()}\n${source.url}\n${license}\nEdited excerpt; captions and branding added.`;
}
