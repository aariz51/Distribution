CREATE TYPE "public"."approval_state" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('draft', 'processing', 'review', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('source_original', 'transcript', 'clip', 'clip_enriched', 'thumbnail', 'creative_image', 'caption_track', 'promo_vertical', 'promo_landscape', 'promo_store_portrait', 'promo_store_landscape', 'storyboard', 'creative_direction_md', 'audio_master', 'reference_frames');--> statement-breakpoint
CREATE TYPE "public"."brand_asset_kind" AS ENUM('logo', 'screenshot', 'other', 'font');--> statement-breakpoint
CREATE TYPE "public"."event_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'started', 'progress', 'retrying', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('shorts', 'promo');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('created', 'running', 'waiting_review', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('scheduled', 'publishing', 'published', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rights_class" AS ENUM('owned', 'licensed', 'third_party_attested', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('upload', 'youtube', 'connected', 'discovered');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('discovered', 'queued', 'downloading', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('chat', 'stt', 'tts', 'render', 'download', 'storage');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_copy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"cta" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"generated_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"project_id" uuid,
	"type" "asset_type" NOT NULL,
	"source_id" uuid,
	"candidate_id" uuid,
	"derived_from_asset_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" double precision,
	"size_bytes" integer,
	"thumbnail_asset_id" uuid,
	"status" "asset_status" DEFAULT 'draft' NOT NULL,
	"approval_state" "approval_state" DEFAULT 'pending' NOT NULL,
	"approval_reason" text,
	"profile_version" integer NOT NULL,
	"job_id" uuid,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"publish_result" jsonb,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "brand_asset_kind" NOT NULL,
	"asset_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"feature_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"transcript_id" uuid NOT NULL,
	"start_sec" double precision NOT NULL,
	"end_sec" double precision NOT NULL,
	"score" double precision NOT NULL,
	"hook" text NOT NULL,
	"rationale" text NOT NULL,
	"rank" integer NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"feature_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"auto_queue" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"priority" integer NOT NULL,
	"evidence_asset_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" "event_level" DEFAULT 'info' NOT NULL,
	"step" text,
	"pct" integer,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"product_id" uuid,
	"project_id" uuid,
	"asset_id" uuid,
	"source_id" uuid,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"current_step" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"pgboss_id" text,
	"singleton_key" text,
	"cost" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"key" text NOT NULL,
	"value" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postiz_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"label" text NOT NULL,
	"api_url" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"product" jsonb NOT NULL,
	"brand" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"publishing" jsonb NOT NULL,
	"content_preferences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "project_kind" NOT NULL,
	"profile_version" integer NOT NULL,
	"source_id" uuid,
	"reference_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "project_status" DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_schedule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"postiz_connection_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"platform" text NOT NULL,
	"copy_id" uuid,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "publish_status" DEFAULT 'scheduled' NOT NULL,
	"postiz_post_id" text,
	"postiz_media_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"published_url" text,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_videos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"duration_sec" double precision,
	"platform_of_origin" text,
	"category_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"product_type" text,
	"style" text,
	"pacing_bps" double precision,
	"beat_count" integer,
	"visual_language" text[] DEFAULT '{}'::text[] NOT NULL,
	"ground_preference" text,
	"curator_score" integer DEFAULT 3 NOT NULL,
	"notes" text,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"frame_set_storage_key" text,
	"poster_storage_key" text,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"last_used_product_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_videos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text,
	"platform" text,
	"external_id" text,
	"creator" text,
	"title" text,
	"duration_sec" double precision,
	"license_text" text,
	"rights" "rights_class" DEFAULT 'unknown' NOT NULL,
	"attestation" jsonb,
	"status" "source_status" DEFAULT 'discovered' NOT NULL,
	"storage_key" text,
	"probe" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"language" text,
	"duration_sec" double precision NOT NULL,
	"words" jsonb NOT NULL,
	"segments" jsonb NOT NULL,
	"speakers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"product_id" uuid,
	"job_id" uuid,
	"provider" text NOT NULL,
	"model" text,
	"kind" "usage_kind" NOT NULL,
	"purpose" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"seconds" double precision,
	"bytes" integer,
	"usd_estimate" double precision DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"queues" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_copy" ADD CONSTRAINT "asset_copy_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_source_id_source_videos_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_transcript_id_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."transcripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_sources" ADD CONSTRAINT "connected_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "features" ADD CONSTRAINT "features_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postiz_connections" ADD CONSTRAINT "postiz_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_versions" ADD CONSTRAINT "product_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_id_source_videos_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_reference_id_reference_videos_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."reference_videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_schedule" ADD CONSTRAINT "publish_schedule_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_schedule" ADD CONSTRAINT "publish_schedule_postiz_connection_id_postiz_connections_id_fk" FOREIGN KEY ("postiz_connection_id") REFERENCES "public"."postiz_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_schedule" ADD CONSTRAINT "publish_schedule_copy_id_asset_copy_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."asset_copy"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_videos" ADD CONSTRAINT "source_videos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_source_id_source_videos_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_copy_asset_idx" ON "asset_copy" USING btree ("asset_id","platform");--> statement-breakpoint
CREATE INDEX "assets_product_status_idx" ON "assets" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "assets_project_idx" ON "assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "assets_derived_idx" ON "assets" USING btree ("derived_from_asset_id");--> statement-breakpoint
CREATE INDEX "brand_assets_product_idx" ON "brand_assets" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "candidates_project_idx" ON "candidates" USING btree ("project_id","rank");--> statement-breakpoint
CREATE INDEX "features_product_idx" ON "features" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_product_idx" ON "jobs" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_project_idx" ON "jobs" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "limits_scope_key_idx" ON "limits" USING btree ("scope","scope_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "product_versions_idx" ON "product_versions" USING btree ("product_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "products_account_slug_idx" ON "products" USING btree ("account_id","slug");--> statement-breakpoint
CREATE INDEX "projects_product_idx" ON "projects" USING btree ("product_id","kind");--> statement-breakpoint
CREATE INDEX "publish_schedule_time_idx" ON "publish_schedule" USING btree ("scheduled_for","status");--> statement-breakpoint
CREATE INDEX "publish_schedule_asset_idx" ON "publish_schedule" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_videos_url_idx" ON "reference_videos" USING btree ("url");--> statement-breakpoint
CREATE INDEX "source_videos_product_idx" ON "source_videos" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "transcripts_source_idx" ON "transcripts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_product_idx" ON "usage_ledger" USING btree ("product_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");