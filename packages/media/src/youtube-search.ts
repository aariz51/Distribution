import { ValidationError } from "@distribution/core";
import { bin, run } from "./exec";
import { parseChannelVideos } from "./channel";

export function normalizeSearchQuery(input: string): string {
  const query = input.replace(/\s+/g, " ").trim();
  if (query.length < 3 || query.length > 240 || [...query].some(char => char.charCodeAt(0) < 32)) throw new ValidationError("Enter a topic between 3 and 240 characters");
  return query;
}
/** Creative Commons UI filter verified on YouTube 2026-09-22. Still probe each license independently. */
export function youtubeSearchUrl(query: string): string {
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", normalizeSearchQuery(query));
  url.searchParams.set("sp", "EgIwAQ%3D%3D");
  return url.toString();
}
/** Actual filtered metadata search. Results remain unscreened; a search badge is not approval. */
export async function searchYoutube(query: string, signal: AbortSignal) {
  const result = await run(bin("yt-dlp"), ["--flat-playlist", "--dump-single-json", "--skip-download", "--playlist-end", "20", "--socket-timeout", "20", "--retries", "2", "--", youtubeSearchUrl(query)], { timeoutMs: 120_000, signal, step: "search" });
  return parseChannelVideos(result.stdout).filter(video => video.durationSec !== null && video.durationSec >= 300 && video.durationSec <= 10_800);
}
