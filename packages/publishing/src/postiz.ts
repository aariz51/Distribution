import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PipelineError, redact } from "@distribution/core";
import { bin, run } from "@distribution/media";

/**
 * Postiz public API client.
 *
 * Ported from the working Python sidecar the desktop app used
 * (`vendor/autoshorts-py/assets/postiz_post.py`): same base URL, the same raw
 * `Authorization` header (no Bearer), the same upload-then-post flow and the
 * same per-provider `settings` table. Differences on purpose: the upload is
 * streamed instead of read into memory, scheduling is a first-class argument,
 * and errors are typed so the job layer knows whether a retry can help.
 */

export const DEFAULT_API_URL = "https://api.postiz.com/public/v1";

/**
 * Channel types a workspace can add from our UI through Postiz's OAuth route.
 * Ids are Postiz provider identifiers; credential-based providers (Bluesky,
 * Mastodon) are left out because that route has no redirect for them.
 */
export const CONNECTABLE_PROVIDERS = [
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
  { id: "instagram-standalone", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "linkedin-page", label: "LinkedIn Page" },
  { id: "threads", label: "Threads" },
  { id: "pinterest", label: "Pinterest" },
] as const;

/** Postiz allows 90 create-post calls an hour (100 on cloud). */
export const CREATE_POST_HOURLY_LIMIT = 90;

const UPLOAD_LIMIT_BYTES = 45 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 600_000;
const MAX_ATTEMPTS = 5;

export interface Integration {
  id: string;
  name: string;
  /** provider key: x, instagram, instagram-standalone, youtube, tiktok, linkedin, facebook… */
  identifier: string;
  picture?: string | null;
  disabled: boolean;
  profile?: string | null;
}

export interface UploadedMedia {
  id: string;
  path: string;
}

export interface PostTarget {
  integrationId: string;
  provider: string;
  content: string;
  media?: UploadedMedia[];
  /** overrides merged over `providerSettings(provider, …)` */
  settings?: Record<string, unknown>;
}

export interface CreatePostInput {
  type: "schedule" | "now" | "draft";
  /** ISO-8601; required by the API even for `now` */
  date: string;
  posts: PostTarget[];
  shortLink?: boolean;
  tags?: string[];
}

export interface CreatedPost {
  id: string;
  /** every id the API reported, when it creates one per channel */
  ids: string[];
  raw: unknown;
}

export interface PostStatus {
  id: string;
  state: "published" | "pending" | "error" | "unknown";
  publishedUrl: string | null;
  error: string | null;
  raw: unknown;
}

export class PostizError extends PipelineError {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    // 4xx is a request the caller must change; 5xx and transport are worth retrying.
    super(`Postiz HTTP ${status}: ${redact(body).slice(0, 300)}`, {
      retrySafe: status >= 500 || status === 408 || status === 429,
      step: "publish",
      details: { status },
    });
    this.name = "PostizError";
  }
}

/**
 * Per-provider `settings` payloads, ported verbatim from `postiz_post.py:230-261`.
 * Postiz validates these server-side and rejects a post whose settings block is
 * missing a required key, so the table is data rather than guesswork.
 */
export function providerSettings(provider: string, opts: { title?: string } = {}): Record<string, unknown> {
  const p = provider.toLowerCase();
  const title = opts.title ?? "";
  switch (p) {
    case "tiktok":
      return {
        __type: "tiktok",
        content_posting_method: process.env.TIKTOK_POSTING_METHOD ?? "DIRECT_POST",
        privacy_level: "PUBLIC_TO_EVERYONE",
        disclose: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        duet: true,
        stitch: true,
        comment: true,
        autoAddMusic: "no",
        title,
      };
    case "instagram":
    case "instagram-standalone":
      return { __type: p, post_type: "post" };
    case "youtube":
      return { __type: "youtube", type: "public", title };
    case "pinterest":
      return { __type: "pinterest", board: "", title };
    case "x":
      return { __type: "x", who_can_reply_post: "everyone" };
    case "reddit":
      return { __type: "reddit", subreddit: [] };
    default:
      return { __type: p };
  }
}

/** Providers that need a title: first caption line, capped per platform. */
export function titleFor(provider: string, caption: string): string {
  const caps: Record<string, number> = { tiktok: 90, youtube: 100, pinterest: 100 };
  const cap = caps[provider.toLowerCase()];
  if (!cap) return "";
  const firstLine = caption.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return firstLine.trim().slice(0, cap);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PostizClientOptions {
  apiUrl?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class PostizClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PostizClientOptions) {
    if (!opts.apiKey) throw new PipelineError("Postiz API key is not configured", { retrySafe: false });
    this.apiUrl = (opts.apiUrl || DEFAULT_API_URL).replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // Postiz takes the raw key, not `Bearer <key>`.
    return { authorization: this.apiKey, ...extra };
  }

  private async request(method: string, endpoint: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    const safeToRepeat = method === "GET" || method === "DELETE";
    const attempts = safeToRepeat ? MAX_ATTEMPTS : 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await this.fetchImpl(`${this.apiUrl}${endpoint}`, { ...init, method, signal: combined });
        const text = await res.text();
        if (!res.ok) throw new PostizError(res.status, text);
        return text ? JSON.parse(text) : {};
      } catch (err) {
        if (signal?.aborted) throw new PipelineError("cancelled", { retrySafe: false, cause: err });
        if (!safeToRepeat && err instanceof PostizError && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(err.status)) throw err;
        if (!safeToRepeat) throw new PipelineError(`Postiz ${method} outcome could not be confirmed; check Postiz before submitting again: ${redact(String(err instanceof Error ? err.message : err))}`, { retrySafe: false, step: "publish", cause: err });
        if (err instanceof PostizError && !err.retrySafe) throw err;
        lastErr = err;
        if (attempt < attempts - 1) await sleep(Math.min(30, 2 ** attempt) * 1000);
      }
    }
    throw new PipelineError(`Postiz request failed: ${redact(String(lastErr instanceof Error ? lastErr.message : lastErr))}`, { retrySafe: true, step: "publish", cause: lastErr });
  }

  /** Connected channels. Disabled ones are returned too; the caller decides. */
  async listIntegrations(signal?: AbortSignal): Promise<Integration[]> {
    const data = await this.request("GET", "/integrations", { headers: this.headers() }, signal);
    const rows = Array.isArray(data) ? data : ((data as { integrations?: unknown[] }).integrations ?? []);
    return (rows as Record<string, unknown>[]).map((r) => ({
      id: String(r.id ?? ""),
      name: String(r.name ?? ""),
      identifier: String(r.providerIdentifier ?? r.identifier ?? ""),
      picture: (r.picture as string | undefined) ?? null,
      profile: (r.profile as string | undefined) ?? null,
      disabled: Boolean(r.disabled),
    }));
  }

  /**
   * The provider's own OAuth page for adding a channel to this Postiz
   * organisation (`GET /social/:provider`). The user authorises on the
   * provider's site and lands on Postiz's callback, so callers open it in a new
   * tab and poll `listIntegrations` for the new channel. Pass `refresh` with an
   * existing integration id to reconnect that channel instead.
   */
  async connectUrl(provider: string, opts: { refresh?: string; signal?: AbortSignal } = {}): Promise<string> {
    if (!CONNECTABLE_PROVIDERS.some((p) => p.id === provider)) throw new PipelineError(`Unsupported channel type: ${provider}`, { retrySafe: false, step: "connect" });
    const query = opts.refresh ? `?${new URLSearchParams({ refresh: opts.refresh })}` : "";
    const data = (await this.request("GET", `/social/${encodeURIComponent(provider)}${query}`, { headers: this.headers() }, opts.signal)) as { url?: unknown };
    const url = typeof data.url === "string" ? data.url : "";
    if (!/^https:\/\//.test(url)) throw new PipelineError("Postiz did not return a sign-in link for this channel", { retrySafe: true, step: "connect" });
    return url;
  }

  /** Removes a channel from the Postiz organisation. Already-removed is not an error. */
  async deleteIntegration(id: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.request("DELETE", `/integrations/${encodeURIComponent(id)}`, { headers: this.headers() }, signal);
    } catch (err) {
      if (err instanceof PostizError && err.status === 404) return;
      throw err;
    }
  }

  /**
   * Upload a media file. Files over 45 MB are re-encoded down a CRF ladder
   * first (the ladder is `postiz_post.py:126-201`), because the API rejects
   * anything larger. The upload itself streams.
   */
  async uploadFile(filePath: string, opts: { contentType?: string; signal?: AbortSignal; onLog?: (m: string) => void; validateMedia?: (file: string) => Promise<string> } = {}): Promise<UploadedMedia> {
    let sourcePath = filePath;
    const size = (await stat(filePath)).size;
    if (size > UPLOAD_LIMIT_BYTES) {
      sourcePath = await shrinkForUpload(filePath, { signal: opts.signal, onLog: opts.onLog });
    }
    const body = new FormData();
    // Generated media is supplied by persistent runtime storage, not build output.
    const fileSize = (await stat(/* turbopackIgnore: true */ sourcePath)).size;
    const stream = createReadStream(/* turbopackIgnore: true */ sourcePath);
    const blob = await streamToBlob(stream, opts.contentType ?? "video/mp4");
    // Compare the immutable upload body to evidence for the final transport
    // file, including any size-reduction derivative. Never certify only input.
    if (opts.validateMedia) {
      const expected = await opts.validateMedia(sourcePath);
      const actual = createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
      if (actual !== expected) throw new PipelineError("Upload media changed after content screening", { step: "final_screening", retrySafe: false });
    }
    body.set("file", blob, path.basename(sourcePath));
    const data = (await this.request("POST", "/upload", { headers: this.headers(), body }, opts.signal)) as Record<string, unknown>;
    const id = String(data.id ?? "");
    const url = String(data.path ?? data.url ?? "");
    if (!id && !url) throw new PipelineError(`Postiz upload returned neither id nor path (${fileSize} bytes)`, { retrySafe: true, step: "publish" });
    return { id, path: url };
  }

  /** Create a scheduled, immediate or draft post across one or more channels. */
  async createPost(input: CreatePostInput, signal?: AbortSignal): Promise<CreatedPost> {
    const payload = {
      type: input.type,
      date: input.date,
      shortLink: input.shortLink ?? false,
      tags: input.tags ?? [],
      posts: input.posts.map((p) => ({
        integration: { id: p.integrationId },
        value: [{ content: p.content, image: p.media ?? [] }],
        settings: { ...providerSettings(p.provider, { title: titleFor(p.provider, p.content) }), ...(p.settings ?? {}) },
      })),
    };
    const data = await this.request("POST", "/posts", { headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify(payload) }, signal);
    const ids = collectIds(data);
    return { id: ids[0] ?? "", ids, raw: data };
  }

  async getPost(id: string, signal?: AbortSignal, scheduledFor = new Date()): Promise<PostStatus> {
    const startDate = new Date(scheduledFor.getTime() - 86400000).toISOString();
    const endDate = new Date(scheduledFor.getTime() + 86400000).toISOString();
    const query = new URLSearchParams({ startDate, endDate });
    const data = await this.request("GET", `/posts?${query}`, { headers: this.headers() }, signal) as { posts?: Record<string, unknown>[] };
    if (!Array.isArray(data.posts)) throw new PipelineError("Postiz returned an invalid post list", { step: "poll" });
    const post = data.posts.find(p => String(p.id) === id);
    return interpretStatus(id, post ?? {});
  }

  /** Deleting an already-deleted post is not an error. */
  async deletePost(id: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.request("DELETE", `/posts/${encodeURIComponent(id)}`, { headers: this.headers() }, signal);
    } catch (err) {
      if (err instanceof PostizError && err.status === 404) return;
      throw err;
    }
  }
}

/** Collect post ids from the several shapes the API has used. */
export function collectIds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.postId)) return (d.postId as Record<string, unknown>[]).map((p) => String(p.postId ?? p.id ?? "")).filter(Boolean);
  if (Array.isArray(d.ids)) return (d.ids as unknown[]).map(String).filter(Boolean);
  if (Array.isArray(data)) return (data as Record<string, unknown>[]).map((p) => String(p.postId ?? p.id ?? "")).filter(Boolean);
  if (d.postId || d.id) return [String(d.postId ?? d.id)];
  return [];
}

/**
 * Postiz has reported state under several keys across versions, so read
 * defensively: an explicit error wins, then an explicit state, then a release
 * URL. A past scheduled date alone never proves publication.
 */
export function interpretStatus(id: string, data: Record<string, unknown>): PostStatus {
  const errorText = typeof data.error === "string" ? data.error : typeof data.errorMessage === "string" ? data.errorMessage : null;
  const releaseUrl = (data.releaseURL ?? data.releaseUrl ?? data.url) as string | undefined;
  const rawState = String(data.state ?? data.status ?? "").toUpperCase();
  if (errorText) return { id, state: "error", publishedUrl: null, error: errorText, raw: data };
  if (rawState === "ERROR") return { id, state: "error", publishedUrl: null, error: "provider reported ERROR", raw: data };
  if (rawState === "PUBLISHED" || rawState === "RELEASED") return { id, state: "published", publishedUrl: releaseUrl ?? null, error: null, raw: data };
  if (releaseUrl) return { id, state: "published", publishedUrl: releaseUrl, error: null, raw: data };
  return { id, state: rawState === "" ? "unknown" : "pending", publishedUrl: null, error: null, raw: data };
}

/** Re-encode until the file fits the upload cap. Ladder from postiz_post.py. */
export async function shrinkForUpload(filePath: string, opts: { signal?: AbortSignal; onLog?: (m: string) => void } = {}): Promise<string> {
  const ext = path.extname(filePath) || ".mp4";
  for (const crf of [20, 23, 26]) {
    const out = path.join(path.dirname(filePath), `${path.basename(filePath, ext)}_upload_crf${crf}${ext}`);
    opts.onLog?.(`[postiz] file over 45 MB; re-encoding at crf ${crf}`);
    await run(bin("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-i", filePath, "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", out], {
      timeoutMs: 45 * 60_000,
      signal: opts.signal,
      step: "publish",
    });
    if ((await stat(out)).size <= UPLOAD_LIMIT_BYTES) return out;
  }
  throw new PipelineError("video is still over the 45 MB Postiz upload limit after re-encoding", { retrySafe: false, step: "publish" });
}

async function streamToBlob(stream: NodeJS.ReadableStream, type: string): Promise<Blob> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return new Blob([Buffer.concat(chunks)], { type });
}

/** `instagram-standalone` → `instagram`; the platform we store on a schedule row. */
export function platformOf(identifier: string): string {
  return identifier.replace(/-standalone$/, "").toLowerCase();
}
