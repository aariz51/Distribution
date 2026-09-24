import { PipelineError, ValidationError } from "@distribution/core";
import { bin, run } from "./exec";
import { canonicalUrl, isVideoId } from "./ports/youtube";

export function canonicalChannel(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new ValidationError("Enter a YouTube channel URL"); }
  if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com"].includes(url.hostname) || url.username || url.password || url.port) throw new ValidationError("Use an HTTPS YouTube channel URL");
  let path: string;
  try { path = decodeURIComponent(url.pathname).replace(/\/$/, ""); } catch { throw new ValidationError("Invalid channel URL encoding"); }
  const match = /^(\/@[\p{L}\p{N}_.-]+|\/channel\/UC[A-Za-z0-9_-]{22}|\/(?:c|user)\/[A-Za-z0-9_.-]+)(?:\/(?:videos|featured|shorts|streams))?$/u.exec(path);
  if (!match) throw new ValidationError("Use a channel URL, not a video, playlist or search URL");
  return `https://www.youtube.com${encodeURI(match[1]!)}/videos`;
}

export interface ChannelVideo { externalId: string; url: string; title: string; creator: string | null; durationSec: number | null }
export function parseChannelVideos(output: string): ChannelVideo[] {
  let data: { entries?: unknown[]; uploader?: unknown };
  try { data = JSON.parse(output); } catch { throw new PipelineError("Channel metadata was not valid JSON", { step: "discovery" }); }
  if (!data || !Array.isArray(data.entries)) throw new PipelineError("Channel response did not contain a video list", { step: "discovery" });
  const result = new Map<string, ChannelVideo>();
  for (const value of data.entries) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || !isVideoId(entry.id) || typeof entry.title !== "string" || !entry.title.trim() || entry.live_status === "is_live" || entry.live_status === "is_upcoming") continue;
    const duration = typeof entry.duration === "number" && Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : null;
    result.set(entry.id, { externalId: entry.id, url: canonicalUrl(entry.id), title: entry.title, creator: typeof entry.uploader === "string" ? entry.uploader : typeof data.uploader === "string" ? data.uploader : null, durationSec: duration });
  }
  return [...result.values()];
}

/** Metadata only, most recent 50 ordinary videos; never keyword search or media download. */
export async function discoverChannel(url: string, signal: AbortSignal) {
  const result = await run(bin("yt-dlp"), ["--flat-playlist", "--dump-single-json", "--skip-download", "--playlist-end", "50", "--socket-timeout", "20", "--retries", "2", "--", canonicalChannel(url)], { timeoutMs: 120_000, signal, step: "discovery" });
  return parseChannelVideos(result.stdout);
}
