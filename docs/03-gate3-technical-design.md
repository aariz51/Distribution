# Gate 3 — Technical Design

Builds on [Gate 1](01-gate1-inventory.md) and [Gate 2](02-gate2-product-spec.md).

## Decision / Recommendation

| Concern | Decision | Why (against alternatives) |
|---|---|---|
| Language/runtime | TypeScript on Node 22+ for web, API and worker; Python 3.12+ for the vendored sidecars; no Rust | Gate 1 decision 2. Python is where the media logic already is. |
| Frontend + API | **Next.js 16 (App Router)** with Route Handlers for CRUD/enqueue and Server-Sent Events for progress | One deployable for UI + API. A separate Fastify/NestJS service would add a second server for CRUD that has no heavy work in it; heavy work is in the worker anyway. |
| Job queue | **pg-boss 12 on the same PostgreSQL** | Only Postgres exists locally (no Redis/Docker). pg-boss provides retries with backoff, expiration/timeouts, singleton keys (idempotent enqueue), dead-letter queues, scheduled sends (used for publish-at), archival, and transactional enqueue with app writes. BullMQ would be faster at very high throughput, which this workload (tens of jobs/day) does not need. Swap point: `packages/jobs/queue.ts` is the only file that knows pg-boss. |
| Worker | Separate Node process (`apps/worker`) running pg-boss consumers; spawns ffmpeg/yt-dlp/python via `execa` with timeouts and cancellation; renders Remotion via `@remotion/renderer` | Long-running (seconds to hours), CPU-bound, needs binaries. Never inside a request. |
| Database | **PostgreSQL 16 + Drizzle ORM** (SQL-first migrations) | Proven, already running, and pg-boss lives in it. Drizzle keeps the schema readable in TS with plain SQL migrations. |
| Storage | `StorageAdapter` interface with **local filesystem** first (`STORAGE_ROOT`), **S3-compatible (R2)** adapter second | Local FS gets the worker producing real files today; R2 adds egress-free public delivery later. Files are served through a Next route that validates keys; no raw path exposure. |
| Auth/config | Phase 1: single-tenant password login (signed HTTP-only cookie); all secrets server-side from env; per-product Postiz key encrypted at rest (AES-GCM with `APP_SECRET`) | Multi-user is a Gate 2 open question; the schema carries `accountId` from day one so tenancy is additive. |
| LLM/STT providers | `packages/providers`: one `ChatProvider` interface; OpenAI-compatible implementation covers OpenRouter, DeepSeek, OpenAI, Groq, Gemini (OpenAI-compat endpoint), Ollama; native Anthropic implementation. STT: Deepgram, Whisper API (Groq/OpenAI), local Whisper CLI. Usage rows written for every call. | Preserves all 7 existing LLM providers + Deepgram + local Whisper with one retry/timeout/redaction policy instead of seven. |
| Promo rendering | Prop-driven Remotion kit (`packages/promo-kit`) rendered by the worker with the Node API; Remotion Lambda kept as an optional adapter | Gate 1 decision 3 and promo inventory §10 option (b). |
| Deployment | Phase 1–3: runs on this Mac (web `pnpm dev`, worker `pnpm start`). Phase 6: Docker images `web` and `worker` (Debian, ffmpeg, Python venv, Chromium shell, pre-baked ONNX/Whisper weights), Postgres managed, R2 for storage. Vercel is **not** used for the worker; the web app could be Vercel-hosted later only if the API stays thin. | Heavy media needs a long-lived process with binaries. |

## Findings

### System architecture

```
 Browser ──HTTPS──▶ apps/web (Next.js)
                     ├─ UI (intake, library, review, calendar, jobs, settings)
                     ├─ Route Handlers: /api/* (zod-validated) → packages/db + packages/jobs (enqueue)
                     └─ SSE: /api/jobs/:id/events (reads job_events table)
                                │
                          PostgreSQL 16
                     ┌──────────┴───────────┐
                     │ app schema (drizzle) │ pgboss schema (queue)
                     └──────────┬───────────┘
                                │
                      apps/worker (Node) — pg-boss consumers
                        ├─ packages/pipelines/shorts   → yt-dlp, ffmpeg, python sidecars (vendor/autoshorts-py)
                        ├─ packages/pipelines/promo    → vendor/watch lib, LLM steps, packages/promo-kit, @remotion/renderer, build_audio.py
                        ├─ packages/pipelines/publish  → packages/publishing (Postiz client)
                        ├─ packages/providers          → LLM / STT / TTS with usage + cost tracking
                        └─ packages/storage            → local FS | S3/R2
```

### Repo structure

```
Distribution/
  apps/
    web/            Next.js 16 app: UI + route handlers + SSE
    worker/         pg-boss consumers; one process, N concurrent slots per queue
  packages/
    core/           domain zod schemas (ProductProfile, Asset, Job…), status enums, ids, errors, logger
    db/             drizzle schema, migrations, typed queries, pg-boss bootstrap
    jobs/           job type registry, payload schemas, enqueue helpers, progress/event writer
    providers/      ChatProvider (openai-compat, anthropic), SttProvider (deepgram, whisper-api, whisper-local), usage ledger, cost table, redaction
    storage/        StorageAdapter (local, s3), key scheme, signed URL helper
    media/          ffmpeg/ffprobe/yt-dlp wrappers with timeouts; ported pure logic (render command builder, youtube id parsing/classification, transcript normalisers, caption chunker, candidate JSON repair)
    pipelines/
      shorts/       step functions: ingest, clean, transcribe, rank, cut, title, sfx, broll, outro, creative, copy
      promo/        analyze-reference, analyze-product, storyboard, build-theme, render, audio, store-cut, qa
      publish/      schedule → postiz create → poll
    publishing/     Postiz REST client (integrations, upload streaming, posts, status), provider settings table, re-encode ladder
    promo-kit/      Remotion project: schema, Root/Film, prop-driven scenes + signature-device components, animations (from vendor)
  vendor/           pristine copies of the source systems (see vendor/README.md)
  docs/             gates, ADRs, runbooks
  scripts/          dev bootstrap (create db, run migrations, python venv), e2e runners
```

### Data model (Drizzle, Postgres)

```
accounts(id, name, created_at)
users(id, account_id, email, password_hash, created_at)
products(id, account_id, slug, version, name, tagline, description, category_primary, category_tags[],
         competitors jsonb, audience jsonb, platforms text[], urls jsonb,
         palette jsonb {ink,accent,canvas,ground,extra[],source,inferred_from}, typography jsonb, cta,
         content_preferences jsonb, publishing_prefs jsonb {timezone,cadence[],lead_time_minutes},
         created_at, updated_at)
product_versions(id, product_id, version, snapshot jsonb, created_at)          -- every edit
features(id, product_id, title, detail, priority, evidence_asset_ids uuid[])
brand_assets(id, product_id, kind logo|screenshot|other|font, asset_id, order, feature_id?, metadata jsonb)
postiz_connections(id, account_id, label, api_url, api_key_enc, channels jsonb cache, checked_at)
source_videos(id, product_id, kind upload|youtube|connected|discovered, url, platform, external_id, creator,
              title, duration_sec, license_text, rights owned|licensed|third_party_attested|unknown,
              attestation jsonb {text,user_id,at,proof_asset_id}, status discovered|queued|downloading|ready|failed|archived,
              storage_key, probe jsonb, created_at)
connected_sources(id, product_id, kind youtube_channel|podcast_rss, url, last_polled_at, auto_queue bool)
reference_videos(id, url, title, duration_sec, platform_of_origin, category_tags[], product_type, style,
                 pacing_bps, beat_count, visual_language[], ground_preference, curator_score, notes,
                 analysis jsonb, analyzed_at, frame_set_storage_key, poster_storage_key, usage_count, last_used_product_id)
projects(id, product_id, kind shorts|promo, profile_version, source_id?, reference_id?, params jsonb,
         status, created_at)                                                    -- one generation run
transcripts(id, source_id, engine, language, duration_sec, words jsonb, segments jsonb, speakers jsonb, storage_key)
candidates(id, project_id, transcript_id, start_sec, end_sec, score, hook, rationale, rank, selected bool,
           feature_ids uuid[], created_at)
assets(id, product_id, project_id, type, source_id?, derived_from_asset_id?, storage_key, mime_type,
       width, height, duration_sec, size_bytes, thumbnail_asset_id?, status, approval_state, approval_reason,
       profile_version, job_id?, platforms text[], scheduled_for?, published_at?, publish_result jsonb,
       failure_reason, metadata jsonb, created_at, updated_at)
asset_copy(id, asset_id, platform, hook, title, caption, description, hashtags text[], cta, version, approved bool,
           generated_by jsonb {provider,model,usage_id}, created_at)
jobs(id, type, product_id?, project_id?, asset_id?, status queued|started|progress|retrying|completed|failed|cancelled,
     priority, progress_pct, current_step, attempts, max_attempts, error jsonb, pgboss_id, singleton_key,
     started_at, completed_at, cost jsonb {usd_estimate, llm_tokens, stt_minutes, render_seconds, bytes_downloaded}, created_at)
job_events(id, job_id, at, level, step, message, data jsonb)                   -- feeds SSE + logs
publish_schedule(id, asset_id, postiz_connection_id, channel_id, platform, copy_id, scheduled_for, status,
                 postiz_post_id, postiz_media_id, attempts, last_error, published_url, created_at, updated_at)
usage_ledger(id, account_id, product_id?, job_id?, provider, model, kind chat|stt|tts|render|download|storage,
             input_tokens, output_tokens, seconds, bytes, usd_estimate, at)
limits(id, scope account|product|job_type, scope_id, key, value)                -- cost/concurrency caps
```

Relationships: product 1—n projects; project 1—n candidates/assets; source 1—n transcripts; asset n—n platforms via publish_schedule; every asset optionally points at its parent asset (derivation chain). Every generated row stores `profile_version`.

### Job graph

Shorts (`project.kind = shorts`), one job per step, chained by the previous step's completion, each idempotent on its inputs:

```
ingest_source ─▶ [clean_source] ─▶ extract_audio ─▶ transcribe ─▶ rank_candidates ─▶ (fan-out per selected candidate)
   cut_clip ─▶ [title_banner] ─▶ [sfx] ─▶ [broll] ─▶ [outro] ─▶ thumbnail ─▶ copy_generate ─▶ asset.review
```
Bracketed steps are profile-toggled. Fan-out uses pg-boss `singletonKey = candidateId:step` so retries never duplicate encodes.

Promo (`project.kind = promo`):

```
resolve_reference ─▶ (no reference? propose_from_library → WAIT review) ─▶ fetch_reference_frames ─▶ analyze_reference
 ─▶ analyze_product (palette first, deterministic) ─▶ storyboard ─▶ validate_storyboard ─▶ write_creative_direction
 ─▶ build_audio ─▶ render × {vertical, landscape, store_portrait, store_landscape} (parallel) ─▶ store_cut ─▶ [qa_stills] ─▶ assets.review
```

Publish:

```
schedule (row) ─▶ pg-boss sendAfter(scheduled_for − lead) ─▶ publish_post: upload → create post → poll status (every 2 min, max 2 h) ─▶ published | failed(retry policy)
```

### Event flow and progress

- Every step writes `job_events` (`step`, `message`, `pct`, `data`) via `packages/jobs/progress.ts`; the same writer updates `jobs.progress_pct/current_step`.
- Subprocesses report progress by parsing stderr (ffmpeg `time=`, yt-dlp `[download] 12.3%`, Whisper segment counts, Remotion `renderMedia` `onProgress`).
- `apps/web` exposes `GET /api/jobs/:id/events` (SSE, tails `job_events` by id) and `GET /api/products/:id/activity`.
- pg-boss hooks: `retrying` → job status `retrying` + event; `failed` after `retryLimit` → `failed` and a row in the dead-letter queue `dlq` with the payload for manual replay.

### Provider architecture

```ts
interface ChatProvider { id; chat(req: ChatRequest, ctx: CallContext): Promise<ChatResponse> }
ChatRequest { system?, messages[], json?: boolean | zodSchema, maxTokens, temperature, images?: Image[] }
CallContext { jobId, productId, purpose: "rank"|"title"|"copy"|"storyboard"|"reference_analysis"|…, budget }
```
- Implementations: `openai-compatible` (base URL + key; used for openrouter, deepseek, openai, groq, gemini-openai-compat, ollama) and `anthropic` (x-api-key or OAuth bearer + beta header, preserving `llm.rs:385-395`).
- Policy layer wraps every provider: timeout (connect 20 s / total 300 s, from `openrouter.rs:146-158`), retry on 408/409/429/5xx with `Retry-After` (ported `is_retryable`/`backoff_secs`), JSON-mode fallback (drop `response_format` on rejection, from SETUP.md), error redaction (ported `redact`), usage ledger write, budget check (`limits`).
- Routing table in `providers/routing.ts`: purpose → ordered provider/model list from env (`LLM_RANK=openrouter:anthropic/claude-sonnet-4.5,deepseek:deepseek-chat`), so fallback and switching are configuration.
- STT: `SttProvider.transcribe(wav) → NormalizedTranscript` for deepgram (nova-2 params preserved), whisper-api (Groq `whisper-large-v3` / OpenAI `whisper-1`, chunking from `vendor/watch/whisper.py`), whisper-local (CLI `--word_timestamps True`, model from env). Same normalisers as today, ported with tests.
- Secrets: env only (`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY|ANTHROPIC_OAUTH_TOKEN`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `DEEPGRAM_API_KEY`, `PEXELS_API_KEY`); Postiz keys per connection encrypted in DB. Logs never include keys; the redaction function is applied to every error string.

### Postiz integration

- `packages/publishing/postiz.ts`: `listIntegrations()`, `upload(stream)` (multipart streaming; re-encode ladder from `postiz_post.py:126-201` when > 45 MB), `createPost({type: "schedule"|"now"|"draft", date, posts:[{integration:{id}, value:[{content, image:[media]}], settings}]})`, `getPost(id)`, `deletePost(id)`. Auth header `Authorization: <key>`.
- Provider settings table ported verbatim from `postiz_post.py:230-261` (TikTok posting method/privacy, Instagram `post_type`, YouTube `type/title`, Pinterest board, X reply settings); title derivation rules (first caption line, 90/100 chars) preserved.
- Rate limit: create-post ≤ 90/h → a pg-boss queue with `teamSize 1` and a token bucket in `limits`.
- Stored: `postiz_post_id`, `postiz_media_id`, per-platform status, `published_url` when Postiz returns it, full error text on failure.

### Storage

Key scheme: `products/<productId>/sources/<sourceId>/original.mp4`, `.../transcripts/<id>.json`, `projects/<projectId>/clips/<candidateId>/flat.mp4|titled.mp4|sfx.mp4|broll.mp4|final.mp4`, `.../thumbnails/<assetId>.png`, `promo/<projectId>/{frames,project,out}/…`, `references/<id>/frames/…`. Local adapter roots at `STORAGE_ROOT`; S3 adapter uses the same keys. Downloads go to a per-job scratch dir that is deleted on completion (success or failure), with a size cap.

### Migration plan (desktop → web)

| From (AutoShorts) | To |
|---|---|
| SQLite `projects` | `source_videos` (+ `projects` for the run) |
| `transcripts.raw_json` | `transcripts.words/segments` |
| `candidates` | `candidates` (adds `feature_ids`) |
| `clips` + filename suffixes | `assets` with `derived_from_asset_id` chain |
| `brands` | `products` + `brand_assets` |
| `clip_copy` (unused) | `asset_copy` |
| `schedule_entries` (unused) | `publish_schedule` |
| `postiz_state` string | `publish_schedule.status` + Postiz ids |
| cargo-test batch + log scraping | pg-boss queues + `jobs`/`job_events` |
| localStorage keys | server env + encrypted connections |

A one-off importer (`scripts/import-autoshorts-sqlite.ts`) can pull the 14 projects/186 candidates from the live SQLite into `source_videos`/`candidates` for regression comparison; rendered files no longer exist, so assets are not migrated.

Promo (skill → jobs): `SKILL.md` steps become the promo job graph; the template becomes `packages/promo-kit` with `inputProps = { theme, storyboard, assets }`; `CREATIVE_DIRECTION.md` is still produced (sections 1–5 from the three LLM steps) and stored as an asset.

### Deployment model

- Phase 1–3: local. `scripts/dev.sh` creates the `distribution` database, runs migrations, creates the Python venv from `vendor/autoshorts-py/requirements.txt`, checks binaries, starts web and worker.
- Phase 6: two Docker images. `worker` image: Debian slim + ffmpeg (full build with libass/freetype so drawtext also works) + Python venv + fonts (DejaVu, Inter, Baloo2) + YuNet/GoogleNet/YOLOX ONNX + Whisper weights + Node + Remotion Chromium shell (`npx remotion browser ensure`). Optional `worker-tts` image (Python 3.11 + Chatterbox). Postgres managed; R2 storage. Horizontal scale = more worker replicas; pg-boss handles distribution.

### Observability

- `pino` structured logs with `requestId`, `jobId`, `productId`, `assetId`, `step`, `provider`, `durationMs`, `result`, `error` (redacted). Worker logs also go into `job_events` at `info` and above.
- Per-job cost roll-up on `jobs.cost` from `usage_ledger`.
- Health: `/api/health` (db, queue depth, worker heartbeat row), worker heartbeat every 30 s.
- Failure diagnostics: `job_events` records the failing step, the subprocess exit code and last 40 stderr lines, `attempts`, and whether the step is `retrySafe` (declared per step).

### Security model

- All provider credentials server-side; the browser only ever receives asset URLs and job status.
- Uploads: MIME sniffing + extension allowlist (mp4/mov/m4a/mp3/wav/png/jpg/webp), size limits, stored under generated keys; never user-controlled paths.
- URLs: only `https?`; YouTube ids validated by the ported `parse_video_id` (refuses `@`, other hosts); yt-dlp always invoked with `--` before the URL (as today).
- Subprocess args are arrays (no shell); Python sidecars receive JSON on stdin or fixed flags; user text never becomes a flag name.
- Storage key validation on the file-serving route (must start with an allowed prefix, no `..`).
- Rate limits on public routes; CSRF via same-site cookies; password hashing with argon2.

### Cost controls

| Control | Where | Default |
|---|---|---|
| Per-job LLM token budget | `CallContext.budget` enforced in the provider policy layer | rank 20k out, storyboard 16k, copy 2k |
| Per-product monthly USD cap | `limits(scope=product, key=usd_month)` checked before enqueue and before each provider call | env `DEFAULT_PRODUCT_MONTHLY_USD=25` |
| Concurrency | pg-boss `teamSize` per queue: `media` 2, `render` 1, `llm` 4, `publish` 1 | env-tunable |
| Transcription minutes | ledger `seconds`; local Whisper preferred when over budget | — |
| Render time | Remotion `timeoutInMilliseconds`; per-composition `render_seconds` recorded; store cuts reuse the vertical render | — |
| Downloads | `--max-filesize` on yt-dlp (env, default 2 GB); scratch dir quota | — |
| Provider fallback | routing table order; a 429/5xx exhausts one provider before the next | — |
| Estimates | `usage_ledger.usd_estimate` from a price table in `providers/pricing.ts` shown per job and per product | — |

### Testing strategy

- Unit: ported algorithms with the original Rust test vectors (vitest).
- Integration: each pipeline step against fixtures (a 20 s sample video checked into `fixtures/`), sidecars invoked for real, ffmpeg for real.
- E2E: `scripts/e2e-shorts.ts` runs a real source (`~/Downloads/AutoShorts_eKQWFJmCWZE.mp4`, 203 s) through the queue; `scripts/e2e-promo.ts` runs the Civia assets through the promo graph; `scripts/e2e-publish.ts` does a Postiz dry run then a real draft.
- Failure cases from the brief (invalid URL, transcription failure, provider failure, render failure, missing asset, interrupted job, retry, duplicate job, Postiz failure) each get an integration test that asserts the job status, event log and retry behaviour.

## Phased implementation plan (each phase ships something usable)

| Phase | Ships | Contents |
|---|---|---|
| **1. Foundation** | A working web app where a founder creates a full product profile with assets and inferred palette, and a worker that runs a real job with live progress | monorepo packages, Postgres schema + migrations, pg-boss queue, storage (local), auth, intake UI, library UI (empty states + progress rows), palette job, health/logging |
| **2. Shorts** | Real vertical clips with brand-coloured captions, titles and thumbnails from a real source, visible and approvable in the library | ingest (upload + YouTube with rights), transcribe (3 providers), rank with product context, cut with face tracking + captions, title banner, thumbnail (creative.py), copy generation, review/approve UI |
| **3. Publishing** | Approved assets scheduled and published through Postiz with per-platform status and retries | Postiz client, connections UI, calendar + auto-fill, publisher job, status polling, failure surfacing |
| **4. Promo** | A promo film (4 cuts + `CREATIVE_DIRECTION.md`) from the profile, with or without a reference | watch library wrapper, three LLM steps with schemas, prop-driven kit, render/audio/store-cut jobs, reference library + selection gate |
| **5. Enrichment & sourcing** | B-roll, SFX, outro/voice clone, source cleanup as opt-in stages; connected sources and approval queue; optional YouTube Data API discovery | wrappers for the remaining sidecars, connected-source poller, discovery |
| **6. Hardening** | Deployable containers, R2 storage, cost dashboards, multi-user | Dockerfiles, S3 adapter, limits UI, tenancy |

## Open Questions

None that block Phase 1. The Gate 2 open questions (discovery timing, cadence defaults, multi-user) affect Phases 3, 5 and 6 only.
