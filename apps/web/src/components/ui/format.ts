export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatRelative(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function humanize(s: string): string {
  return s.replace(/[_.-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const TYPE_LABELS: Record<string, string> = {
  clip: "Clip",
  clip_enriched: "Enriched clip",
  thumbnail: "Thumbnail",
  creative_image: "Creative",
  promo_vertical: "Promo · vertical",
  promo_landscape: "Promo · landscape",
  promo_store_portrait: "Store promo · portrait",
  promo_store_landscape: "Store promo · landscape",
  source_original: "Source",
  transcript: "Transcript",
  caption_track: "Captions",
  storyboard: "Storyboard",
  creative_direction_md: "Creative direction",
  audio_master: "Audio master",
  reference_frames: "Reference frames",
};

export function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? humanize(t);
}

/**
 * A promo project produces both the full-length store render and a trimmed cut
 * that satisfies Apple's ≤30s / 30fps rule. They share a type, so without this
 * the two are indistinguishable in the library and a founder cannot tell which
 * one is safe to upload.
 */
export function assetLabel(type: string, metadata?: Record<string, unknown> | null): string {
  const base = typeLabel(type);
  if (metadata?.appStoreCut) return `${base} · App Store cut`;
  if (metadata?.poster) return "Poster frame";
  return base;
}

export function isLandscapeType(t: string): boolean {
  return t === "promo_landscape" || t === "promo_store_landscape" || t === "thumbnail";
}
