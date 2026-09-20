import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─── enums (kept in sync with @distribution/core statuses) ────────────────────
export const assetStatus = pgEnum("asset_status", [
  "draft", "processing", "review", "approved", "scheduled", "publishing", "published", "failed", "archived",
]);
export const approvalState = pgEnum("approval_state", ["pending", "approved", "rejected"]);
export const assetType = pgEnum("asset_type", [
  "source_original", "transcript", "clip", "clip_enriched", "thumbnail", "creative_image", "caption_track",
  "promo_vertical", "promo_landscape", "promo_store_portrait", "promo_store_landscape", "storyboard",
  "creative_direction_md", "audio_master", "reference_frames",
]);
export const jobStatus = pgEnum("job_status", [
  "queued", "started", "progress", "retrying", "completed", "failed", "cancelled",
]);
export const sourceStatus = pgEnum("source_status", [
  "discovered", "queued", "downloading", "ready", "failed", "archived",
]);
export const sourceKind = pgEnum("source_kind", ["upload", "youtube", "connected", "discovered"]);
export const rightsClass = pgEnum("rights_class", ["owned", "licensed", "third_party_attested", "unknown"]);
export const publishStatus = pgEnum("publish_status", ["scheduled", "publishing", "published", "failed", "cancelled"]);
export const projectKind = pgEnum("project_kind", ["shorts", "promo"]);
export const projectStatus = pgEnum("project_status", ["created", "running", "waiting_review", "completed", "failed", "cancelled"]);
export const brandAssetKind = pgEnum("brand_asset_kind", ["logo", "screenshot", "other", "font"]);
export const usageKind = pgEnum("usage_kind", ["chat", "stt", "tts", "render", "download", "storage"]);
export const eventLevel = pgEnum("event_level", ["debug", "info", "warn", "error"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ─── tenancy ─────────────────────────────────────────────────────────────────
export const accounts = pgTable("accounts", {
  id: uuid().primaryKey(),
  name: text().notNull(),
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid().primaryKey(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),
  email: text().notNull(),
  passwordHash: text().notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

// ─── product profile ─────────────────────────────────────────────────────────
export const products = pgTable("products", {
  id: uuid().primaryKey(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),
  slug: text().notNull(),
  version: integer().notNull().default(1),
  /** ProductInfo minus features (features are rows) */
  product: jsonb().$type<Record<string, unknown>>().notNull(),
  brand: jsonb().$type<Record<string, unknown>>().notNull(),
  sources: jsonb().$type<Record<string, unknown>>().notNull(),
  publishing: jsonb().$type<Record<string, unknown>>().notNull(),
  contentPreferences: jsonb().$type<Record<string, unknown>>().notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("products_account_slug_idx").on(t.accountId, t.slug)]);

export const productVersions = pgTable("product_versions", {
  id: uuid().primaryKey(),
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  version: integer().notNull(),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("product_versions_idx").on(t.productId, t.version)]);

export const features = pgTable("features", {
  id: uuid().primaryKey(),
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  title: text().notNull(),
  detail: text(),
  priority: integer().notNull(),
  evidenceAssetIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
}, (t) => [index("features_product_idx").on(t.productId)]);

export const brandAssets = pgTable("brand_assets", {
  id: uuid().primaryKey(),
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  kind: brandAssetKind().notNull(),
  assetId: uuid().notNull(),
  position: integer().notNull().default(0),
  featureId: uuid(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index("brand_assets_product_idx").on(t.productId)]);

export const postizConnections = pgTable("postiz_connections", {
  id: uuid().primaryKey(),
  accountId: uuid().notNull().references(() => accounts.id, { onDelete: "cascade" }),
  label: text().notNull(),
  apiUrl: text().notNull(),
  /** AES-GCM encrypted with APP_SECRET; never returned to the browser */
  apiKeyEnc: text().notNull(),
  channels: jsonb().$type<unknown[]>().notNull().default([]),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  ...timestamps,
});

// ─── sources ─────────────────────────────────────────────────────────────────
export const sourceVideos = pgTable("source_videos", {
  id: uuid().primaryKey(),
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  kind: sourceKind().notNull(),
  url: text(),
  platform: text(),
  externalId: text(),
  creator: text(),
  title: text(),
  durationSec: doublePrecision(),
  licenseText: text(),
  rights: rightsClass().notNull().default("unknown"),
  attestation: jsonb().$type<Record<string, unknown>>(),
  status: sourceStatus().notNull().default("discovered"),
  storageKey: text(),
  probe: jsonb().$type<Record<string, unknown>>(),
  failureReason: text(),
  ...timestamps,
}, (t) => [index("source_videos_product_idx").on(t.productId, t.status)]);

export const connectedSources = pgTable("connected_sources", {
  id: uuid().primaryKey(),
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  kind: text().notNull(),
  url: text().notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  autoQueue: boolean().notNull().default(false),
  ...timestamps,
});

export const referenceVideos = pgTable("reference_videos", {
  id: uuid().primaryKey(),
  url: text().notNull(),
  title: text().notNull(),
  durationSec: doublePrecision(),
  platformOfOrigin: text(),
  categoryTags: text().array().notNull().default(sql`'{}'::text[]`),
  productType: text(),
  style: text(),
  pacingBps: doublePrecision(),
  beatCount: integer(),
  visualLanguage: text().array().notNull().default(sql`'{}'::text[]`),
  groundPreference: text(),
  curatorScore: integer().notNull().default(3),
  notes: text(),
  analysis: jsonb().$type<Record<string, unknown>>(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  frameSetStorageKey: text(),
  posterStorageKey: text(),
  usageCount: integer().notNull().default(0),
  lastUsedProductId: uuid(),
  ...timestamps,
}, (t) => [uniqueIndex("reference_videos_url_idx").on(t.url)]);

// ─── generation runs ─────────────────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: uuid().primaryKey(),
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  kind: projectKind().notNull(),
  profileVersion: integer().notNull(),
  sourceId: uuid().references(() => sourceVideos.id, { onDelete: "set null" }),
  referenceId: uuid().references(() => referenceVideos.id, { onDelete: "set null" }),
  params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  status: projectStatus().notNull().default("created"),
  ...timestamps,
}, (t) => [index("projects_product_idx").on(t.productId, t.kind)]);

export const transcripts = pgTable("transcripts", {
  id: uuid().primaryKey(),
  sourceId: uuid().notNull().references(() => sourceVideos.id, { onDelete: "cascade" }),
  engine: text().notNull(),
  language: text(),
  durationSec: doublePrecision().notNull(),
  words: jsonb().$type<unknown[]>().notNull(),
  segments: jsonb().$type<unknown[]>().notNull(),
  speakers: jsonb().$type<string[]>().notNull().default([]),
  storageKey: text(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("transcripts_source_idx").on(t.sourceId)]);

export const candidates = pgTable("candidates", {
  id: uuid().primaryKey(),
  projectId: uuid().notNull().references(() => projects.id, { onDelete: "cascade" }),
  transcriptId: uuid().notNull().references(() => transcripts.id, { onDelete: "cascade" }),
  startSec: doublePrecision().notNull(),
  endSec: doublePrecision().notNull(),
  score: doublePrecision().notNull(),
  hook: text().notNull(),
  rationale: text().notNull(),
  rank: integer().notNull(),
  selected: boolean().notNull().default(false),
  featureIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("candidates_project_idx").on(t.projectId, t.rank)]);

// ─── content library ─────────────────────────────────────────────────────────
export const assets = pgTable("assets", {
  id: uuid().primaryKey(),
  productId: uuid().notNull().references(() => products.id, { onDelete: "cascade" }),
  projectId: uuid().references(() => projects.id, { onDelete: "set null" }),
  type: assetType().notNull(),
  sourceId: uuid().references(() => sourceVideos.id, { onDelete: "set null" }),
  candidateId: uuid().references(() => candidates.id, { onDelete: "set null" }),
  derivedFromAssetId: uuid(),
  storageKey: text().notNull(),
  mimeType: text().notNull(),
  width: integer(),
  height: integer(),
  durationSec: doublePrecision(),
  sizeBytes: integer(),
  thumbnailAssetId: uuid(),
  status: assetStatus().notNull().default("draft"),
  approvalState: approvalState().notNull().default("pending"),
  approvalReason: text(),
  profileVersion: integer().notNull(),
  jobId: uuid(),
  platforms: text().array().notNull().default(sql`'{}'::text[]`),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishResult: jsonb().$type<Record<string, unknown>>(),
  failureReason: text(),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (t) => [
  index("assets_product_status_idx").on(t.productId, t.status),
  index("assets_project_idx").on(t.projectId),
  index("assets_derived_idx").on(t.derivedFromAssetId),
]);

export const assetCopy = pgTable("asset_copy", {
  id: uuid().primaryKey(),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: "cascade" }),
  platform: text().notNull(),
  hook: text().notNull().default(""),
  title: text().notNull().default(""),
  caption: text().notNull().default(""),
  description: text().notNull().default(""),
  hashtags: text().array().notNull().default(sql`'{}'::text[]`),
  cta: text().notNull().default(""),
  version: integer().notNull().default(1),
  approved: boolean().notNull().default(false),
  generatedBy: jsonb().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("asset_copy_asset_idx").on(t.assetId, t.platform)]);

// ─── jobs ────────────────────────────────────────────────────────────────────
export const jobs = pgTable("jobs", {
  id: uuid().primaryKey(),
  type: text().notNull(),
  productId: uuid().references(() => products.id, { onDelete: "cascade" }),
  projectId: uuid().references(() => projects.id, { onDelete: "cascade" }),
  assetId: uuid(),
  sourceId: uuid(),
  status: jobStatus().notNull().default("queued"),
  priority: integer().notNull().default(0),
  progressPct: integer().notNull().default(0),
  currentStep: text(),
  attempts: integer().notNull().default(0),
  maxAttempts: integer().notNull().default(3),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  result: jsonb().$type<Record<string, unknown>>(),
  error: jsonb().$type<Record<string, unknown>>(),
  pgbossId: text(),
  singletonKey: text(),
  cost: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  index("jobs_status_idx").on(t.status, t.createdAt),
  index("jobs_product_idx").on(t.productId, t.createdAt),
  index("jobs_project_idx").on(t.projectId),
]);

export const jobEvents = pgTable("job_events", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  jobId: uuid().notNull().references(() => jobs.id, { onDelete: "cascade" }),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  level: eventLevel().notNull().default("info"),
  step: text(),
  pct: integer(),
  message: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>(),
}, (t) => [index("job_events_job_idx").on(t.jobId, t.id)]);

// ─── publishing ──────────────────────────────────────────────────────────────
export const publishSchedule = pgTable("publish_schedule", {
  id: uuid().primaryKey(),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: "cascade" }),
  postizConnectionId: uuid().notNull().references(() => postizConnections.id, { onDelete: "restrict" }),
  channelId: text().notNull(),
  platform: text().notNull(),
  copyId: uuid().references(() => assetCopy.id, { onDelete: "set null" }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  status: publishStatus().notNull().default("scheduled"),
  postizPostId: text(),
  postizMediaId: text(),
  attempts: integer().notNull().default(0),
  lastError: text(),
  publishedUrl: text(),
  jobId: uuid(),
  ...timestamps,
}, (t) => [
  index("publish_schedule_time_idx").on(t.scheduledFor, t.status),
  index("publish_schedule_asset_idx").on(t.assetId),
]);

// ─── usage / limits / ops ────────────────────────────────────────────────────
export const usageLedger = pgTable("usage_ledger", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  accountId: uuid().notNull(),
  productId: uuid(),
  jobId: uuid(),
  provider: text().notNull(),
  model: text(),
  kind: usageKind().notNull(),
  purpose: text(),
  inputTokens: integer(),
  outputTokens: integer(),
  seconds: doublePrecision(),
  bytes: integer(),
  usdEstimate: doublePrecision().notNull().default(0),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("usage_ledger_product_idx").on(t.productId, t.at)]);

export const limits = pgTable("limits", {
  id: uuid().primaryKey(),
  scope: text().notNull(),
  scopeId: text().notNull(),
  key: text().notNull(),
  value: doublePrecision().notNull(),
}, (t) => [uniqueIndex("limits_scope_key_idx").on(t.scope, t.scopeId, t.key)]);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text().primaryKey(),
  hostname: text().notNull(),
  queues: text().array().notNull().default(sql`'{}'::text[]`),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});
