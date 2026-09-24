import { z } from "zod";
import { Platform, RightsClass } from "../statuses";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #RRGGBB");

export const ProvenanceSource = z.enum(["provided", "inferred", "confirmed"]);

export const Palette = z.object({
  ink: hex,
  accent: hex,
  canvas: hex,
  ground: hex,
  extra: z.array(hex).max(8).default([]),
  source: ProvenanceSource,
  /** asset ids the palette was sampled from, when inferred */
  inferredFrom: z.array(z.uuid()).default([]),
});
export type Palette = z.infer<typeof Palette>;

export const Typography = z.object({
  display: z.string().optional(),
  body: z.string().optional(),
  heavy: z.string().optional(),
  source: ProvenanceSource,
});
export type Typography = z.infer<typeof Typography>;

export const Feature = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(120),
  detail: z.string().max(600).optional(),
  priority: z.number().int().min(1),
  evidenceAssetIds: z.array(z.uuid()).default([]),
});
export type Feature = z.infer<typeof Feature>;

export const Competitor = z.object({ name: z.string().min(1).max(120), url: z.url().optional() });

export const Audience = z.object({
  summary: z.string().min(1).max(600),
  segments: z.array(z.string().max(120)).default([]),
  painPoints: z.array(z.string().max(240)).default([]),
});

export const ProductPlatform = z.enum(["ios", "android", "web", "desktop"]);

export const ProductInfo = z.object({
  name: z.string().min(1).max(80),
  tagline: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  category: z.object({ primary: z.string().min(1).max(80), tags: z.array(z.string().max(40)).default([]) }),
  features: z.array(Feature).min(1),
  competitors: z.array(Competitor).default([]),
  audience: Audience,
  platforms: z.array(ProductPlatform).min(1),
  urls: z
    .object({ website: z.url().optional(), appStore: z.url().optional(), playStore: z.url().optional() })
    .default({}),
});
export type ProductInfo = z.infer<typeof ProductInfo>;

export const BrandInfo = z.object({
  logoAssetId: z.uuid().optional(),
  screenshotAssetIds: z.array(z.uuid()).default([]),
  otherAssetIds: z.array(z.uuid()).default([]),
  palette: Palette.optional(),
  typography: Typography.optional(),
  cta: z.string().max(80).default("Download on the App Store & Google Play"),
});
export type BrandInfo = z.infer<typeof BrandInfo>;

export const Attestation = z.object({
  text: z.string(),
  userId: z.uuid(),
  at: z.iso.datetime(),
  proofAssetId: z.uuid().optional(),
});

export const PromoReference = z.union([
  z.object({ kind: z.literal("url"), url: z.url(), rights: RightsClass, attestation: Attestation.optional() }),
  z.object({ kind: z.literal("library"), referenceId: z.uuid() }),
]);

export const ConnectedSource = z.object({
  kind: z.enum(["youtube_channel", "podcast_rss"]),
  url: z.url(),
  rights: z.literal("owned"),
  autoQueue: z.boolean().default(false),
});

export const SourcesInfo = z.object({
  promoReference: PromoReference.optional(),
  longFormSourceIds: z.array(z.uuid()).default([]),
  connected: z.array(ConnectedSource).default([]),
});

export const CadenceWindow = z.object({
  dow: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const CadenceRule = z.object({
  channelId: z.string().min(1),
  platform: Platform,
  perWeek: z.number().int().min(0).max(21),
  windows: z.array(CadenceWindow).default([]),
});

export const PublishingPrefs = z.object({
  postizConnectionId: z.uuid().optional(),
  channelIds: z.array(z.string()).default([]),
  timezone: z.string().min(1).default("UTC"),
  cadence: z.array(CadenceRule).default([]),
  leadTimeMinutes: z.number().int().min(5).max(24 * 60).default(30),
  minGapHours: z.number().min(0).max(168).default(6),
});
export type PublishingPrefs = z.infer<typeof PublishingPrefs>;

export const PeoplePolicy = z.enum(["off", "no-people", "no-women"]);
export const VoicePreference = z.preprocess(value => value === "clone" ? "female" : value, z.enum(["female", "none"]));

/** Content preferences have NO defaults for policy fields on purpose (Gate 1 OQ1):
 *  the intake form must collect them. Technical toggles do have defaults. */
export const ContentPreferences = z.object({
  captionPresetId: z.string().min(1).default("hormozi-pop"),
  captionUseBrandColors: z.boolean().default(true),
  titleBanner: z.boolean().default(true),
  broll: z.boolean().default(false),
  sfx: z.boolean().default(true),
  outro: z.boolean().default(true),
  voice: VoicePreference,
  peoplePolicy: PeoplePolicy,
  cleanSource: z.boolean().default(false),
  clipLengthSec: z.object({ min: z.number().min(5).max(180).default(30), max: z.number().min(10).max(180).default(90) }).default({ min: 30, max: 90 }),
  clipsPerSource: z.number().int().min(1).max(25).default(8),
  copyTone: z.string().max(200).default("direct, specific, no hype"),
  hashtagStrategy: z.enum(["none", "few", "many"]).default("few"),
  languages: z.array(z.string().min(2).max(8)).default(["en"]),
});
export type ContentPreferences = z.infer<typeof ContentPreferences>;

export const ProductProfile = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  slug: z.string().min(1),
  version: z.number().int().min(1),
  product: ProductInfo,
  brand: BrandInfo,
  sources: SourcesInfo,
  publishing: PublishingPrefs,
  contentPreferences: ContentPreferences,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProductProfile = z.infer<typeof ProductProfile>;

/** What the intake form posts. Server fills ids/version/timestamps. */
export const ProductProfileInput = ProductProfile.omit({
  id: true,
  accountId: true,
  slug: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});
export type ProductProfileInput = z.infer<typeof ProductProfileInput>;

/** Compact block injected into every LLM prompt so ranking, hooks, titles and
 *  copy know what the product actually is. Kept short and deterministic. */
export function productContextBlock(p: Pick<ProductProfile, "product">): string {
  const f = [...p.product.features].sort((a, b) => a.priority - b.priority);
  const lines = [
    `PRODUCT: ${p.product.name} — ${p.product.tagline}`,
    p.product.description ? `DESCRIPTION: ${p.product.description}` : null,
    `CATEGORY: ${p.product.category.primary}${p.product.category.tags.length ? ` (${p.product.category.tags.join(", ")})` : ""}`,
    `FEATURES (priority order):\n${f.map((x, i) => `  ${i + 1}. ${x.title}${x.detail ? ` — ${x.detail}` : ""}`).join("\n")}`,
    `AUDIENCE: ${p.product.audience.summary}${p.product.audience.painPoints.length ? `\n  pain points: ${p.product.audience.painPoints.join("; ")}` : ""}`,
    p.product.competitors.length ? `COMPETITORS: ${p.product.competitors.map((c) => c.name).join(", ")}` : null,
    `PLATFORMS: ${p.product.platforms.join(", ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}
