/** Port of autoshorts `src-tauri/src/youtube.rs`.
 *
 *  Everything here is pure: URL parsing to a validated id, stderr
 *  classification, user-facing messages, and the exact yt-dlp argv the Rust
 *  built. Spawning, retry-over-player-clients and filesystem checks stay with
 *  the caller (see `run` in `../exec`). */
import { join } from "node:path";
import { PipelineError } from "@distribution/core";

/** Player clients to try, in order (`youtube.rs:32`). */
export const PLAYER_CLIENTS = ["web_embedded", "ios", "mweb", "android", "tv"] as const;
export type PlayerClient = (typeof PLAYER_CLIENTS)[number];

/** Mirrors the `DownloadError` enum variants. */
export type DownloadErrorKind =
  | "InvalidUrl"
  | "Private"
  | "AgeRestricted"
  | "GeoBlocked"
  | "Unavailable"
  | "ToolMissing"
  | "Transient"
  | "Other";

/** A classified failure. `detail` is present for the variants that carried a
 *  payload in Rust (`InvalidUrl(reason)`, `Transient(detail)`, `Other(detail)`). */
export interface DownloadFailure {
  kind: DownloadErrorKind;
  detail?: string;
}

/** Typed error for the Rust `DownloadError`. `retrySafe` mirrors `is_retryable`. */
export class YoutubeDownloadError extends PipelineError {
  readonly kind: DownloadErrorKind;
  readonly detail: string | undefined;
  constructor(failure: DownloadFailure) {
    super(userMessage(failure), {
      retrySafe: isRetryable(failure),
      step: "download",
      details: { kind: failure.kind, ...(failure.detail !== undefined ? { detail: failure.detail } : {}) },
    });
    this.name = "YoutubeDownloadError";
    this.kind = failure.kind;
    this.detail = failure.detail;
  }
}

/** A validated eleven-character YouTube id. Only `parseVideoId` produces one. */
export type VideoId = string & { readonly __brand: "VideoId" };

/** `VideoId::canonical_url` -- built from the id, never echoed from input. */
export function canonicalUrl(id: VideoId): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** YouTube ids are exactly 11 characters from the URL-safe base64 alphabet. */
export function isVideoId(value: string): value is VideoId {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

const ALLOWED_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"];

function invalid(reason: string): YoutubeDownloadError {
  return new YoutubeDownloadError({ kind: "InvalidUrl", detail: reason });
}

/** `parse_video_id`. Throws `YoutubeDownloadError` with `kind: "InvalidUrl"`
 *  for anything that is not a YouTube link; this is the SSRF / argv boundary. */
export function parseVideoId(input: string): VideoId {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw invalid("The link is empty.");

  if (isVideoId(trimmed)) return trimmed;

  let withScheme: string;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    withScheme = trimmed;
  } else if (trimmed.includes("://")) {
    throw invalid("Only http and https links are supported.");
  } else {
    withScheme = `https://${trimmed}`;
  }

  const schemeIdx = withScheme.indexOf("://");
  const afterScheme = schemeIdx >= 0 ? withScheme.slice(schemeIdx + 3) : withScheme;

  const authority = afterScheme.split(/[/?#]/, 1)[0] ?? "";
  if (authority.includes("@")) throw invalid("Links with embedded credentials are not accepted.");
  const host = (authority.split(":", 1)[0] ?? "").toLowerCase();

  if (!ALLOWED_HOSTS.includes(host)) throw invalid(`\`${host}\` is not a YouTube address.`);

  const pathAndQuery = afterScheme.slice(authority.length);
  const qIdx = pathAndQuery.indexOf("?");
  const path = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery;
  const query = qIdx >= 0 ? pathAndQuery.slice(qIdx + 1) : "";

  let pathCandidate: string | undefined;
  const parts = path.replace(/^\/+/, "").split("/");
  if (host.endsWith("youtu.be")) {
    pathCandidate = parts[0];
  } else {
    const first = parts[0];
    if (first === "shorts" || first === "embed" || first === "live" || first === "v") {
      pathCandidate = parts[1];
    }
  }
  if (pathCandidate !== undefined) {
    const candidate = pathCandidate.split("#", 1)[0] ?? pathCandidate;
    if (isVideoId(candidate)) return candidate;
  }

  for (const pair of query.split("&")) {
    if (pair.startsWith("v=")) {
      const raw = pair.slice(2);
      const value = raw.split("#", 1)[0] ?? raw;
      if (isVideoId(value)) return value;
    }
  }

  throw invalid("No video id found in that link.");
}

/** yt-dlp prints warnings before the real error; take the line that matters. */
export function firstMeaningfulLine(stderr: string): string {
  const lines = stderr.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.length > 0 && !line.startsWith("WARNING")) return Array.from(line).slice(0, 200).join("");
  }
  return "no detail";
}

/** `classify`: yt-dlp's stderr into something the UI can act on. */
export function classify(stderr: string): DownloadFailure {
  const lower = stderr.toLowerCase();
  if (lower.includes("private video") || lower.includes("this video is private")) return { kind: "Private" };
  if (lower.includes("confirm your age") || lower.includes("age-restricted")) return { kind: "AgeRestricted" };
  if (
    lower.includes("available in your country") ||
    lower.includes("available in your location") ||
    lower.includes("geo restricted") ||
    lower.includes("geo-restricted") ||
    lower.includes("blocked it in your country")
  ) {
    return { kind: "GeoBlocked" };
  }
  if (lower.includes("video unavailable") || lower.includes("has been removed") || lower.includes("does not exist")) {
    return { kind: "Unavailable" };
  }
  if (
    lower.includes("403") ||
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("timed out") ||
    lower.includes("temporary failure") ||
    lower.includes("connection reset") ||
    lower.includes("needs to be reloaded") ||
    lower.includes("unable to download video data")
  ) {
    return { kind: "Transient", detail: firstMeaningfulLine(stderr) };
  }
  return { kind: "Other", detail: firstMeaningfulLine(stderr) };
}

function toFailure(f: DownloadFailure | DownloadErrorKind): DownloadFailure {
  return typeof f === "string" ? { kind: f } : f;
}

/** `DownloadError::is_retryable`: only `Transient` advances to the next client. */
export function isRetryable(failure: DownloadFailure | DownloadErrorKind): boolean {
  return toFailure(failure).kind === "Transient";
}

/** `DownloadError::user_message`: a sentence the user can act on. */
export function userMessage(failure: DownloadFailure | DownloadErrorKind): string {
  const f = toFailure(failure);
  const detail = f.detail ?? "";
  switch (f.kind) {
    case "InvalidUrl":
      return `That does not look like a YouTube link. ${detail}`;
    case "Private":
      return "This video is private. Ask the owner to make it unlisted or public, or use a different video.";
    case "AgeRestricted":
      return "This video is age-restricted, so YouTube will not serve it without a signed-in account. Try a different video.";
    case "GeoBlocked":
      return "This video is not available in your region.";
    case "Unavailable":
      return "This video is unavailable -- it may have been deleted or the link may be wrong.";
    case "ToolMissing":
      return "yt-dlp is not installed. Install it with `brew install yt-dlp` (macOS) or `pip install -U yt-dlp`, then try again.";
    case "Transient":
      return `YouTube refused the download after trying every available method. This is usually temporary -- wait a minute and retry. (${detail})`;
    case "Other":
      return `The download failed for an unexpected reason. Check the link opens in a browser, then try again. If it keeps failing, updating yt-dlp usually fixes it: \`brew upgrade yt-dlp\`. (${detail})`;
  }
}

/** `run_ytdlp` prefixes every attempt with the player client (`youtube.rs:344-347`). */
export function playerClientArgv(client: PlayerClient, args: readonly string[]): string[] {
  return ["--extractor-args", `youtube:player_client=${client}`, ...args];
}

/** One argv per player client, in the order `run_ytdlp` tries them. The caller
 *  runs them sequentially and stops at the first success or the first
 *  non-retryable `classify` result. */
export function ytdlpAttempts(args: readonly string[]): string[][] {
  return PLAYER_CLIENTS.map((client) => playerClientArgv(client, args));
}

/** `probe` argv (before the player-client prefix). */
export function probeArgv(id: VideoId): string[] {
  return ["--dump-json", "--no-warnings", "--skip-download", "--", canonicalUrl(id)];
}

/** Cap at 1080p: short-form output is 1080x1920 at most. */
export const YTDLP_FORMAT = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best";

/** Output template inside `destDir`; `%(id)s` rather than `%(title)s` so the
 *  filename is eleven validated characters that cannot escape the directory. */
export function downloadTemplate(destDir: string): string {
  return join(destDir, "AutoShorts_%(id)s.%(ext)s");
}

/** `download` argv (before the player-client prefix). */
export function downloadArgv(id: VideoId, destDir: string, maxFileSize?: string): string[] {
  return [
    "--format",
    YTDLP_FORMAT,
    "--merge-output-format",
    "mp4",
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--no-warnings",
    "-o",
    downloadTemplate(destDir),
    "--print",
    "after_move:filepath",
    "--no-simulate",
    "--progress",
    "--newline",
    "--socket-timeout",
    "20",
    ...(maxFileSize ? ["--max-filesize", maxFileSize] : []),
    "--",
    canonicalUrl(id),
  ];
}

/** The path yt-dlp printed via `--print after_move:filepath`: the last
 *  non-empty line, or `null` when nothing usable was printed. The existence
 *  check that follows in Rust is I/O and stays with the caller. */
export function parseDownloadOutput(stdout: string): string | null {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  return last === undefined || last.length === 0 ? null : last;
}

/** Metadata for a video, without downloading it (`VideoMeta`). */
export interface VideoMeta {
  title: string;
  uploader: string;
  duration: number;
  license: string | null;
  /** True only when YouTube says the video is Creative Commons. */
  reuseAllowed: boolean;
}

/** The CC check at `youtube.rs:309-315`. */
export function reuseAllowed(licenseText: string | null | undefined): boolean {
  if (licenseText === null || licenseText === undefined) return false;
  const l = licenseText.toLowerCase().trim().replace(/\s+/g, " ");
  return /^creative commons attribution licen[cs]e(?: \(reuse allowed\))?$/.test(l)
    || /^cc by(?: [1-4]\.0)?$/.test(l);
}

/** `probe`'s stdout (`--dump-json`) into `VideoMeta`. Throws `Other` when the
 *  JSON does not parse, as the Rust did. */
export function parseVideoMeta(stdout: string): VideoMeta {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch (e) {
    throw new YoutubeDownloadError({ kind: "Other", detail: `could not read video metadata: ${e instanceof Error ? e.message : String(e)}` });
  }
  const obj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const license = str(obj.license);
  return {
    title: str(obj.title) ?? "Untitled",
    uploader: str(obj.uploader) ?? "",
    duration: typeof obj.duration === "number" ? obj.duration : 0,
    license,
    reuseAllowed: reuseAllowed(license),
  };
}
