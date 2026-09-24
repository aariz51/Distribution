# Video repair audit — in progress

This is an evidence log, not a production-readiness sign-off.

## Verified baseline

- Actual implementation: `/Users/aarizazizrasheed/Distribution`.
- Original requirements: `/Users/aarizazizrasheed/prompt md/prompt.md`.
- Baseline: 173 automated tests passed; workspace typecheck passed. No queue tests existed at baseline.
- User authorized provider validation up to $2 for this task. No provider calls initiated by this audit yet. Other running workers share the existing usage ledger.
- Another Claude session is actively editing worker/queue files and running jobs against the same database. Coordination requested; do not overwrite those edits or restart its processes without coordination.
- Available disk fell from about 2.1 GiB to 324 MiB while external render work was running. Additional renders need sufficient scratch capacity.

## Findings

| Area | Evidence | Impact / outstanding action |
| --- | --- | --- |
| HTTP video delivery | Real authenticated Range `bytes=0-1023` request returned 200, no Content-Range, and all 8,109,493 bytes. | Added bounded streaming, 206/416, suffix/open ranges and HEAD. Unit regression passes. Existing Next process still serves its old compiled handler; live HTTP verification pending coordinated restart. |
| Queue recovery | `JobQueue.start()` called `reclaimStaleJobs()` even for enqueue-only clients. Recovery selected every started/progress/retrying app row without checking actual pg-boss lease. | A web process or second worker can reset active jobs. External session is editing this file; must coordinate and test multiworker startup/retry behavior. |
| Reference promos | `promo.run` enqueues `promo.analyze_reference`; `registerPromo` registers neither this nor `promo.storyboard`. Comment refers to an enable flag without implementation. | Reference requests cannot work. Implement and validate actual reference analysis/storyboard pipeline. |
| Concurrent titles | `title_bar.py` writes `tempfile.gettempdir()/f'{video.stem}_title.png'`. Live processes both used `flat.mp4` in different scratch directories but shared `flat_title.png`. | Cross-job title contamination or missing overlay when the other process unlinks it. Isolate temporary files per invocation and run concurrent real media tests. |
| Silent feature failures | Promo audio/poster and shorts captions/title/enrichment have catch-and-continue paths. | Jobs can report success without requested features; required steps must fail accurately or expose explicit partial outcomes. |
| Fresh-checkout audio | `git ls-files packages/promo-kit/public/sfx` empty, but audio builder requires these files. Global `*.mp3` ignore excludes them. | Local success does not establish reproducible deployment; ship licensed assets or resolve tracked vendored sounds explicitly. |
| Project completion | Shorts marks complete when any selected clip exists; promo finalization marks complete after available store renders. | UI can claim completion before remaining required outputs, captions/copy or other jobs finish. |
| Retry safety | Rendering inserts new asset IDs each invocation; ranking deletes/recreates candidates. | Interrupted/retried fan-out can duplicate outputs or invalidate downstream references. Test and implement idempotency at persistence boundaries. |
| Clip test provenance | Stored source title `AutoShorts_eKQWFJmCWZE.mp4`; transcript begins with a dietitian explaining sugar. | General nutrition footage is not proof of clipping actual SafeChoice source assets. Locate actual SafeChoice footage or use a genuinely rendered SafeChoice promo for deterministic clipping verification. |
| Storage deployment | Only local storage adapter exists; unsupported drivers throw. | Web and worker require the same durable volume; marketing Vercel deployment alone cannot run this architecture. |
| Access boundaries | File endpoint requires a session but does not check asset ownership. | Account isolation must be enforced before multi-account production use. |
| Usage controls | Ledger tracks estimates; no enforced aggregate test budget found. Unknown model prices default to zero. | Ensure bounded provider testing and enforce configured runtime limits before public production use. |

## Existing output inspection

Project `768f6cc0-8878-41df-a84b-58a25e927a67` contains six valid ffprobe-readable exports, each 18.048 seconds with H.264/AAC:

- Vertical 1080×1920, 60fps.
- Landscape 1920×1080, 60fps.
- Store portrait 886×1920 and landscape 1920×886, 60fps originals.
- Both store derivatives at 30fps.

`ffmpeg -v error -xerror -i storage/promo/768f6cc0-8878-41df-a84b-58a25e927a67/out/promo_vertical.mp4 -f null -` succeeded.

These files predate this audit. They do not prove a new request, complete job graph, correct cancellation/recovery, successful HTTP playback, or all specified features. New end-to-end runs and visual inspection remain required.

## Repair evidence added during continuation

- Byte delivery now verified against the running Next app: exact range 206/1024 bytes, suffix range 206/512 bytes, out-of-bounds 416. File ownership was also reproduced and repaired: owner 206, unrelated signed account 404.
- Title CLI regression: overlapping calls with identical input basenames failed before the patch because one deleted the other's PNG. Encoder failure also leaked the PNG. Both pass after invocation-specific temporary directories.
- Real concurrent title outputs: `storage/tmp/qa-title-one/titled.mp4` and `storage/tmp/qa-title-two/titled.mp4`; 3 seconds each, 1080×1920, full FFmpeg decode succeeded, distinct titles confirmed visually. These are focused media regressions, not proof of the complete auto-shorts graph.
- Provider cancellation regression sent an HTTP request despite an already-aborted signal; it now rejects before sending and cleans up retry listeners.
- Visual inspection discovered generated storyboards hardcoded `score: "92"` and a `SOLVED` claim. Automatic promo direction now uses an uploaded screenshot scene instead. A separate regression fixes truncating the tagline at six words. Rendered callouts were overflowing; their bounds and typography were corrected.
- Newly rendered SafeChoice film: `storage/tmp/qa-verified-safechoice/promo-vertical.mp4`; 18.048 seconds, 1080×1920, 60fps H.264 plus AAC, 9,203,690 bytes, full decode passed. `proof.png` was visually inspected after the bounds correction. `verification.json` records the storyboard and media probe.
- Isolated Postgres regression database: `distribution_qa_video_repair`. `scripts/test-queue-startup.ts` demonstrated queued/0 corruption before the fix and now verifies active work stays progress/37 and orphaned work terminates visibly. Recovery follows pg-boss state rather than resetting every in-flight app row.
- New real authenticated promo request returned HTTP 202 with project `20cfa718-cec9-42b3-8ff1-b80565352551`. All four render jobs completed; finalization is pending behind media jobs at the time of this entry. This run uses the repaired director through the actual web/queue/worker path.
- Other sessions continue submitting jobs and changing shared state. Do not equate those runs with this audit's controlled verification or claim complete production readiness yet.

## 2026-09-22 verification update

The new API project `20cfa718-cec9-42b3-8ff1-b80565352551` finished all seven jobs and now contains all six deliverable videos. Full FFmpeg decoding passed for all four originals and both store derivatives. Store derivatives are 886×1920 / 1920×886, H.264 with AAC, 30fps, 18.048 seconds. The original four contain audio, run 18.048 seconds, and match their declared native dimensions at 60fps.

Finalization retried after a timeout and completed, but left its old error field set. The isolated real-DB retry test reproduced this independently. Queue success now clears the current error while preserving event history; the regression passes. The tested project's completed finalization error was cleared after independently verifying both resulting files.

The controlled application promo run is verified. Full production readiness is still unproven: reference-driven generation, complete clipping recovery/idempotency/cancellation, reproducible deployment assets, and broader requirements remain open. Do not use this single successful run as evidence for those requirements.

### Additional verification — 2026-09-22

- Sound staging now uses tracked `vendor/promo-video/template/public/sfx` rather than ignored local kit MP3s. Asset copies fail visibly. URL-to-path conversion uses `fileURLToPath`, including paths containing spaces.
- Promo audio processing no longer degrades silently; the master must contain audio and match the storyboard duration. Poster extraction errors also propagate before asset registration.
- Rebuilt the real SafeChoice 18-cue master from tracked source effects: `storage/tmp/qa-tracked-sfx-master.wav`, 18.000 seconds, stereo PCM at 48 kHz.
- Each orientation completion now schedules reconciliation under a distinct singleton key. Finalization requires all four orientations and uses a project-scoped Postgres transaction advisory lock across workers, preventing premature completion and duplicate store cuts. Silent source videos no longer reference a nonexistent audio stream in the filter graph.
- `scripts/test-promo-finalization.ts` uses the real SafeChoice profile/features and four verified renders, with a disposable database. Verified a partial render set remains running, then ran two finalizers concurrently. Exactly two new 30 fps previews with audio were generated, probed, and decoded fully. QA project: `b930ee4a-3a64-4c59-8572-aa609f2b7c8e`.
- Pipeline unit suite: 80 passed. Pipeline and scripts typechecks passed before the last documentation-only changes.
- Scope remains open: missing reference-analysis/storyboard handlers, complete controlled clipping workflow, cancellation and broader reliability/security checks. The new finalization changes have integration coverage but have not yet been exercised by a fresh complete four-orientation render run on the live worker.

### Reference-driven promo path — verified 2026-09-22

The previously unregistered `promo.analyze_reference` and `promo.storyboard` jobs now have real handlers. The analysis extracts eight chronological frames, calls a configured vision provider, validates and records observations, then requests a bounded scene plan. The renderer uses the product's own assets and copy; reference frames inform structure rather than appearing in the output. Invalid scene kinds (including unsupported fabricated result scenes), missing lockups, unsupported assets, and out-of-range timestamps fail visibly.

`POST /api/products/:id/promo` accepts a YouTube reference URL or a video asset belonging to the same product. Input ownership, URL host, and provider configuration are checked before project creation. The promo form exposes optional AI direction and YouTube reference input, with provider-credit notice. YouTube downloading is implemented with a size/time cap but its network path has not yet been verified; the successful test used a real owned SafeChoice video reference.

Verification: `scripts/test-promo-reference.ts` in the isolated QA database copied the real SafeChoice profile, features, logo and six screenshots, and used the prior verified SafeChoice promo as its reference. Project `2f8461d4-a346-44c2-906e-44b7019a1114` completed vision → storyboard → audio → four orientation renders → two store previews. All six outputs have video/audio, approximately 15 seconds duration, and passed full FFmpeg decode. Actual successful provider usage: $0.009595; including the first failed schema-validation attempt: $0.0129605. The first real call exposed an under-specified description length limit; the analysis prompt now specifies bounded descriptions matching validation.

Output directory: `storage/promo/2f8461d4-a346-44c2-906e-44b7019a1114/out/`. A poster was visually inspected; automatic copy truncation still produces awkward ellipses and needs editorial/layout correction. The downloadable storyboard is now updated after audio building so it records the actual audio track. Unit suite: 82 passed; pipeline, scripts and web typechecks passed. Browser UI checking reached the sign-in page; the new controls still require authenticated browser validation.

Remaining work includes controlled clipping tests, cancellation, retry idempotency and lifecycle/security review. These findings are not a production-ready completion claim.

### Controlled clipping run — in progress 2026-09-22

QA project `5b433aab-0520-4980-9aed-1e1a2343fa24`, product `3fe71fcc-3101-432d-a1ec-583d785592a4`, account `fe8c93f8-8d9f-43d9-9ea4-ae6c87575f68`, disposable database `distribution_qa_video_repair`. The actual source is the nutrition video attached to SafeChoice (`c806bbdb-fcd5-4fa6-bdf3-0d1a65238c0e`), not SafeChoice product footage. Script `test-safechoice-clipping.ts` requests two branded clips with real provider transcription and ranking; no cached transcript is supplied.

Caption-generation failures, caption encoder failures, and title-banner rendering failures now propagate rather than silently stripping requested features. Clips are checked for valid bounds/ownership, dimensions, duration, and expected audio/video before asset registration. Requested enrichment failures likewise propagate. A shared completion check requires every selected clip, thumbnail, platform copy, and requested enriched output before completing a shorts project.

Real test reached transcription completion (92 segments), ranking completion, and a captioned/titled 72-second clip at `storage/projects/5b433aab-0520-4980-9aed-1e1a2343fa24/clips/981aae91-a73d-438a-b75b-e71aecfb212b/titled.mp4`. First recorded test cost was $0.0624818. Completion regression correctly reports `running` while other deliverables are absent. Full test remains live in exec session 36944; do not restart solely because observation expires. The active worker loaded before the enrichment/completion edits, so those changes need fresh-process integration verification after this run. The script's cloned profile logo ID was corrected to its copied logo asset before enrichment. Full decoding and output inspection are still pending.

### Clipping result and cancellation — verified 2026-09-22

Session 36944 completed successfully. QA project `5b433aab-0520-4980-9aed-1e1a2343fa24` produced two clips plus enriched versions (74.520s and 59.174s with SFX and SafeChoice logo outros), two thumbnails, and copy for five platforms. All four videos passed probing and full FFmpeg decoding. No enrichment steps were skipped. Provider cost: $0.069459 for this run; known controlled provider tests including reference work total $0.0824195, below the authorized $2 cap. The real caption and SafeChoice end-card frames were visually inspected (`storage/tmp/qa-clip-caption.png`, `storage/tmp/qa-clip-outro.png`). This is branded nutrition-source clipping, not a claim that the original footage depicts SafeChoice.

`test-shorts-completion.ts` now verifies both outcomes against actual rows: incomplete deliverables remain running, complete deliverables become completed. The stricter enrichment implementation still requires a fresh-process rerun; the successful run had loaded the earlier handler before that edit.

Cancellation regression `test-queue-cancel.ts` first failed with `cancellation overwritten: completed/100`. Job claiming, completion/failure, and progress updates now guard terminal states. A per-active-job database poll combines cancellation with pg-boss's abort signal, allowing cancellation from a different web/worker process to reach the active subprocess. Real pg-boss regression passes for late progress/success and for terminating a real long-running Node subprocess within five seconds. Jobs unit suite: five passed. Jobs, pipeline and script typechecks pass.

Outstanding: retry idempotency, broader API ownership/lifecycle review, authenticated browser validation, rendering copy quality, production packaging and full requirements completion audit. Goal remains active.

### Job API access — verified 2026-09-22

A real HTTP regression (`scripts/test-job-ownership.ts`) reproduced another-account access: expected 404, got 200 from job detail. Shared `getOwnedJob` now resolves the job's product ownership, with fallbacks through its project/asset/source associations, before exposing either detail or event streams. The same signed-session test now passes owner access (200) and unrelated account denial (404) for both routes. Invalid IDs return not-found before reaching UUID SQL conversion. The SSE loop validates its cursor, avoids writes after disconnect, removes its abort listener, and drains all terminal event pages instead of dropping events after the first 200. Web typecheck and diff whitespace checks pass.

Retry enqueue/output idempotency, retry/cancel UI controls, and a full browser workflow remain to be completed; the presence of working internal cancellation does not prove those UI requirements.

### Retry identity and strict enrichment — verified 2026-09-22

Generated asset registration now serializes on product + storage key using a transaction advisory lock. Retrying registration updates the existing logical file's asset row and returns its original ID. Promo artifacts/posters/videos, cuts, clip thumbnails, and enriched outputs use this path. Thumbnail filenames use the source asset's stable ID rather than a fresh random thumbnail ID. A real DB regression launched eight concurrent registrations for the same verified clip and retained exactly one row with the original ID.

Ranking now reuses persisted candidates rather than deleting identities already referenced by clips. Concurrent first ranking writes serialize and recheck for existing rows. A different transcript is rejected explicitly instead of silently substituting it into an existing project. `test-rank-resume.ts` verified original candidate IDs, no new provider usage, and resume behavior. It cancelled the test's queued cuts after checking so they cannot execute accidentally in a later test worker.

`test-enrich-retry.ts` ran the new strict enrichment handler in a fresh process against a real SafeChoice branded clip. It actually regenerated SFX and outro, stored the playable result, passed full decode, retained the original enriched asset ID, and created no duplicate. Session 60450 exited successfully. This resolves the earlier note that strict enrichment still needed fresh-process verification.

Asset registration idempotency is not a claim of full transactional pipeline recovery: enqueue handoff, file replacement during retries, copy-version deduplication and stage replay still need auditing. Pipeline unit tests remain 82 passed, pipeline/scripts typechecks and diff checks pass.

### Atomic queue submission and live reconnect — verified 2026-09-22

`JobQueue.enqueue` now inserts the application job and pg-boss transport record in the same Drizzle transaction, using pg-boss 12.33.2's installed `fromDrizzle` adapter. Singleton submission takes a transaction advisory lock before checking active jobs. A rejected transport submission rolls back rather than returning a phantom cancelled job. `test-queue-atomic.ts` verifies eight concurrent requests return exactly one job identity. A real QA database trigger then forces failure after transport insertion; neither the app nor transport row survives rollback. Trigger/function are removed in finally.

Real queue startup/recovery, cancellation/active-subprocess termination, and successful retry/error-clearing regressions all passed after the atomic change. Jobs tests (5) and jobs/scripts typechecks pass.

The UI previously closed EventSource permanently on any network error. It now permits browser reconnection and displays an explicit reconnecting message. SSE emits event IDs, accepts Last-Event-ID, and defers terminal status until all event pages have drained. The authenticated HTTP ownership regression also checks resume cursor behavior. Web typecheck passes. Browser-level network interruption validation and user-facing retry/cancel actions are still pending.

### User recovery controls — implemented and API/queue tested 2026-09-22

Jobs now expose cancel for active processing and retry for failed media/content jobs. The API resolves ownership before either mutation, rejects invalid terminal actions, and keeps publishing operations within the publishing workflow. `JobQueue.retry` locks the failed job, creates its replacement through the same transactional enqueue path, and records the new job ID in the original result without erasing its failure history. Repeated clicks reuse that replacement. The original Jobs row shows that a retry was created; live completion refreshes the page so action buttons reflect terminal state.

Real database regression: eight concurrent manual retries produced one replacement and one original-to-retry link, preserved payload and failure history, and rejected retry of a cancelled job. HTTP tests verify unrelated-account cancel/retry returns 404 and actions on completed jobs return 400. Web/jobs/scripts typechecks and whitespace checks pass. Authenticated browser action testing is still pending, and long-lived web/worker processes must be restarted to load the new JobQueue methods before testing a valid action through the UI.

### Project status and copy replay — verified 2026-09-22

Project status now reconciles terminal failures/cancellations across directly linked jobs and asset-linked jobs. A failed job with a recorded replacement does not leave the project failed while its retry runs. Actual queue regression `test-project-state.ts` proved processing failure → project failed, manual retry → running, cancellation → cancelled. Copy enqueue now includes projectId explicitly.

Copy generation checks outputs already saved by the same job and generates only missing platforms. Inserts serialize by asset/platform, check same-job provenance, and avoid duplicate versions on automatic replay. `test-copy-replay.ts` replayed a completed real SafeChoice copy job and verified no additional versions/provider call. Deliberate new jobs can still create new copy versions.

Verified zero live jobs, stopped stale idle workers and web process, and started fresh services: web exec session 95853 (port 3000), worker session 50506 (worker ID Aarizs-MacBook-Air.local-36182), light/media/llm/render queues with media/LLM/render concurrency 1. The copy-replay edit landed after this restart, so a final worker restart is still needed before final UI validation. API ownership/actions/resumption tests pass against the restarted web app. Worker/pipeline/scripts typechecks pass.

Browser has no authenticated session. Opened the local sign-in tab and asked the user to sign in via asynchronous input; tab 2 was marked for handoff. This is pending, not a blocker to independent implementation and API verification. Do not claim authenticated browser completion.

### Atomic media replacement — verified 2026-09-22

Local `putFile` and `putBuffer` now stage into a unique adjacent temporary file and atomically rename only after a complete write. Cleanup runs on success/failure. Promo renders, posters and store-preview encodes run in scratch directories and are probed before publishing their final storage keys. A failed encode does not truncate the previously served output. This protects file replacement, not cross-file or database/filesystem transactional atomicity.

Storage regression verifies missing-source replacement preserves the old content and concurrent readers observe only complete old/new buffers; no temporary files remain after completion. Storage tests: four passed. Real SafeChoice promo retry (`test-promo-render-retry.ts`, session 82710) completed, passed full decode, and preserved the original asset ID without duplicates. Real store-finalization concurrency regression (session 27795) also passed, producing two fully decoded store previews in QA project `39534ac6-e229-42d2-813e-270f5f3630e2` while retaining the partial-render completion guard.

Browser tab 2 is still at the sign-in page and was marked for handoff again. No authenticated browser validation claimed. Local disk has roughly 3.5 GiB free; avoid unbounded scratch/download work. Current workers predate atomic storage/promo edits and need a final safe restart before final end-to-end UI verification.

### Complete promo copy and malformed-job recovery — verified 2026-09-22

Promo hooks and feature titles now preserve complete profile text. Feature cards use orientation-aware sizes and padding. `scripts/verify-safechoice-copy.ts` rendered fresh 18.048-second 60fps H.264/AAC portrait (1080×1920) and landscape (1920×1080) videos using the original SafeChoice profile and staged assets. Both passed full decoding; both feature frames were visually inspected with complete readable titles. Files are in `storage/tmp/qa-safechoice-copy/`. No additional provider spend.

Persisted payload parsing now runs inside failure handling, ensuring invalid data records a terminal error and clears the cancellation poll. Real PostgreSQL regression `test-queue-invalid-payload.ts` passes without invoking the handler. Startup/recovery regression passes, and recovered terminal jobs reconcile project state. Pipeline tests: 83; jobs tests: 5; workspace lint and typecheck pass. Browser remains at the local sign-in page; authenticated browser QA and broader production verification remain pending.

### Independent completion review and ingest/storage repair — 2026-09-22

Applied `iterate-until-verified` with an independent read-only code reviewer. The review rejects production sign-off: publishing create retries can duplicate remote posts after ambiguous responses; cancellation can race active publishing; domain-row creation and enqueue are not one transaction; the advertised monthly provider cap is unenforced; production runtime packaging is absent. `source.probe` is declared but has no handler or application caller. These remain work, not completed features.

Fixed shared storage resolution: relative `STORAGE_ROOT` now resolves against the workspace root for both app working directories. Packaged installations without a workspace marker must configure an absolute persistent mount. Six storage tests pass, including web/worker directory equivalence and packaged-path rejection.

Fixed schedule cancellation ownership: schedule, route asset, and product account must all match before mutation. Remote deletion failures now propagate rather than confirming false cancellation. Real local HTTP regression rejects an unrelated account and a mismatched asset path (404, unchanged row), then permits the owner (200, cancelled). Only unsent test rows were created; no external posting or deletion occurred. Active publishing/cancellation races remain unresolved.

Source ingest now validates source/project ownership, reuses stored downloads, performs requested cleaning for uploaded sources, preserves the original separately, validates cleaned output, and records failure on the source. Original asset registration is serialized and transcription submission is project-specific. Removed silent fallback to unprocessed audio and band-pass substitution when voice separation fails. Missing caption-inspection dependencies now fail explicitly. Three Python failure-contract regressions pass. A real four-second excerpt of the existing SafeChoice nutrition source passed caption inspection, Demucs voice separation, export, and full decode with the configured Python runtime. The default system Python lacks OpenCV and correctly cannot satisfy this operation.

Production Next build passed before these latest ingest/storage/cancellation edits, with two dynamic-file-tracing warnings in the publishing client. Workspace lint/typecheck passed after the main edits. Latest changes still require final integrated build and browser verification. Provider spend unchanged.

Queued upload-cleaning follow-up: `test-ingest-recovery.ts` now clones the real SafeChoice profile/features into the disposable QA database and submits the real four-second excerpt as an upload with cleaning enabled. The initial test fixture omitted feature rows and correctly failed profile validation; after copying the real features, the queued handler completed with Demucs isolation, a separate cleaned storage key, and the original retained. Repeated stored-source ingest and foreign-product rejection also pass. Pipeline suite remains 83 tests; script typecheck passes.

### Publishing transport and cancellation — 2026-09-22

Official Postiz contracts reviewed: https://docs.postiz.com/public-api/posts/create and https://docs.postiz.com/public-api/posts/list. Fixed documented array `postId` response parsing (previously only `id` was read); polling now queries the documented date-range list and selects the exact post. A past scheduled timestamp no longer counts as published. GET/DELETE retain retries; create requests never automatically resend after uncertain responses. Definitive validation/auth/rate-limit rejections remain distinguishable from ambiguous network/server failures.

A persisted attempt reservation prevents another job from sending a second create for the same unconfirmed schedule. Confirmed rejections release that reservation and store the error; ambiguous outcomes require reconciliation, whose user workflow remains incomplete. No exactly-once delivery claim is made.

Schedule cancellation locks and verifies ownership, and refuses to claim cancellation after a create has started without a known outcome. Pre-create uploads remain cancellable; the subsequent guarded reservation cannot win after cancellation. Publish claim and aggregate asset update share a transaction. Poll published/error updates and aggregate asset status share a transaction, and late timeout results cannot overwrite cancellation.

Evidence: seven publishing unit/HTTP transport tests pass. `test-publish-uncertain.ts` uses actual SafeChoice clip bytes, the real queue and disposable Postgres, and an isolated local fault-injection server: accepted body plus lost response causes one create; a second job does not resend; delayed published/error/timeout responses preserve cancellation and asset state. This is fault-injection evidence, not live Postiz publication validation. No external post was sent. `test-schedule-ownership.ts` confirms HTTP ownership guards and refusal to cancel an unconfirmed submission. Workspace lint and typecheck pass.

Remaining: complete reconciliation of unconfirmed remote submissions, visible upload failure state, multi-schedule aggregate concurrency review, atomic schedule/project enqueue, provider budget enforcement, runtime packaging, authenticated browser QA and authorized live Postiz verification. Goal remains active.

### Atomic workflow startup and scheduling — 2026-09-22

Added `JobQueue.enqueueInTransaction` so callers can commit project/schedule changes and both app/pg-boss job records together. Promo API startup now uses this boundary. Both shorts entry routes share `startRun`: it locks the source, checks actual active ingest jobs, creates the project, updates source state, and submits ingest in one transaction. A cancelled job no longer blocks restart merely because a source retains a queued label. New source uploads start as discovered until their job commits and use atomic storage writes.

Scheduling locks the owned asset, validates every channel and copy before mutation, restricts channels to the selected owned connection, rejects disabled channels, deduplicates channel IDs, and atomically commits schedules, linked jobs, and asset state.

Evidence: `test-project-enqueue-atomic.ts` proves real Postgres rollback/commit across project, source state, app job and transport. `test-run-start.ts` exercises the actual web service function with an injected post-send database failure, active duplicate rejection, and restart after cancellation. `test-schedule-atomic.ts` exercises the local authenticated HTTP endpoint: invalid second channel produces no schedules/jobs; repeated valid channel creates exactly one linked schedule and queue message. Unsent test schedules and transport records were removed; no provider request or public post occurred. Web service restarted to load the new queue interface (session 19165).

Independent review confirmed transaction wiring and found duplicate scheduling across requests. Fixed by reusing an uncancelled schedule with the same asset, connection, channel and timestamp while holding the asset lock. The HTTP test now runs repeated and concurrent identical requests and verifies one schedule/app job/transport message. Review also identified remaining work: cancelling an active ingest can overlap a restart before old-worker teardown; descendant work can share source/transcript files; source import precedes auto-run and should return a retained-source recovery path or share the transaction. These are not covered by the queued-cancellation test and remain open.

### Source recovery and cancellation lease — 2026-09-22

Import now returns its retained source ID with an explicit processing-failure result when initial job submission fails. Both source forms clear the uploaded input, refresh the source list, and show the retry message instead of prompting another upload. Failure-status persistence is best-effort, so a second database failure cannot hide the already-saved source. A failed source-row insert removes the just-written upload file. The older SourcesPanel attestation shape now matches the API object contract.

Ingest and transcription hold a per-source Postgres advisory lease until processing and cleanup finish. `startRun` takes the matching transaction lock and checks active descendant jobs, preventing restart during cancelled-worker cleanup or ongoing downstream work. A cancelled job is checked again after acquiring the lease, before processing starts. Dedicated lease connections avoid exhausting the normal database pool, and connection errors abort the protected work.

Evidence: `test-source-lease.ts` starts a real Node subprocess, cancels it, delays its final cleanup, verifies restart is refused during that interval, releases cleanup, and verifies successful restart with source state intact. It also passes with `PG_POOL_MAX=1`. `test-run-start.ts` injects both enqueue failure and failure of the diagnostic update; the retained-source result survives both. These tests use the disposable QA database and no providers. UI logic is changed and typechecked; authenticated visual/interaction validation remains pending.

Fresh real-handler verification after the lease change: `PG_POOL_MAX=1 ... test-ingest-recovery.ts` passed actual SafeChoice excerpt cleaning with voice isolation, original preservation, source reuse, stable registration, and foreign-product rejection. Workspace lint and typecheck pass. No additional provider spend.

### Provider spending enforcement follow-up

Product monthly limits now reserve conservative estimated spending under a Postgres advisory transaction lock before worker provider calls. Paid models without known rates stop before sending. Successful usage replaces the hold; uncertain failures retain it. Retry success counts earlier attempts conservatively. B-roll application planning uses the TypeScript Anthropic adapter instead of unmetered Python calls. This is an estimated-cost control, not an invoice guarantee; pricing maintenance and operator reconciliation of uncertain reservations remain operational requirements. Eight concurrent reservation attempts against a $1 test cap permit exactly one $0.60 call. Provider regressions prove exhausted budgets stop HTTP and retry estimates survive success. All 200 workspace tests, lint, typecheck and production web build pass. Build still reports two pre-existing Postiz upload filesystem tracing warnings. New migration applied to local application and QA databases. B-roll's changed bridge still needs actual full rendering validation.

Latest SafeChoice queued promo rerender on the updated queue passed valid audio/video probing, full FFmpeg decoding, and preserved its existing asset ID. Two initial attempts correctly failed the free-space preflight; clearing disposable Next caches allowed the render. Disk capacity remains tight. Local web and video worker were restarted; the worker continues polling light/media/llm/render only. No provider calls or external publishing were performed in this validation pass.

### Real B-roll and visual repair

Two actual eight-second B-roll runs used the existing SafeChoice nutrition-source transcript and actual Pexels footage with no-people screening. Each sourced six stock scenes. Planning cost estimates were $0.002517 and $0.002497; combined known controlled provider spend is now $0.0874335. The first decoded output exposed broken caption fragments on visual inspection. Application B-roll now disables color-key caption extraction and renders the actual captions/title only over replacement scenes. A single-frame title overlay needed an explicit image loop to survive initially disabled intervals. Fresh full sourcing/rendering and full FFmpeg decode passed after that fix. Current output: `storage/tmp/qa-safechoice-broll/broll-text/restored.mp4`.

Independent review found remaining correctness gaps: parent clips need persisted caption colors and original title-band geometry so enrichment after a brand edit (or a dedicated title-band layout) remains visually consistent. These are not yet fixed. B-roll now rejects unresolved frame-count mismatches after repair, and enrichment validates duration, dimensions and required streams before storing. Those last validation guards require targeted failure regression coverage. Voice-clone outro still silently falls back to system speech and needs strict requested-mode handling. Deployment runbook added; external deployment and authenticated browser acceptance remain unverified.

### Text snapshots and revised voice requirement

New clips persist original caption settings, the exact title overlay and the title-band transform. Title overlays now use SHA256 content-addressed keys so a failed re-cut cannot overwrite an older clip's text artifact. Legacy clips can be regenerated by starting a new run from their source (completed jobs cannot be retried). Real 270px title-band B-roll restoration passed full decoding and visual inspection. A complete queued 8s clip test produced cut, thumbnail, copy and SFX/silent outro with saved snapshot (project `003912d3-5652-4b22-a159-281f5d5d8850`, clip `4ecf9ccb-e8d5-4f87-bf2b-34cf7b6bb503`); this run preceded the final content-addressed filename change.

The user explicitly replaced cloning with a realistic female synthetic voice. The app now offers female AI voice or none and normalizes legacy clone preferences to female. No speaker reference goes to TTS. Current default is OpenRouter `deepgram/aura-2`, voice `aura-2-thalia-en`; explicit OpenAI configuration supports Coral but the local OpenAI account returned credit_balance_exhausted. OpenRouter's documented OpenAI example model was absent from the live speech catalogue; Microsoft provider attempts returned502. Deepgram succeeded and the real10.72s SafeChoice branded outro passed full decoding: `storage/tmp/qa-safechoice-broll/female-outro.mp4`; voice audio `female-voice.mp3`. Estimated successful speech cost $0.0006; selected QA product usage total is $0.092107 including the new clip run. Failed requests retain conservative budget holds; recorded usage does not assert those uncertain attempts were free.

Current implementation uses the official OpenRouter speech contract (https://openrouter.ai/docs/guides/overview/multimodal/tts) and the live models/endpoints catalogue; voice catalogue https://developers.deepgram.com/docs/tts-models. Four Python outro failure tests, two title isolation tests, full workspace typecheck/lint and200existing tests passed; two additional TTS boundary tests also passed. Cloning model download was stopped and its newly created partial file removed, recovering disk space; that workflow is no longer required by the user. Remaining: final queued female-voice acceptance, browser acceptance, production build after these changes, broader provider-budget operations and deployment verification.

### Queued female voice validation — September 22

The user replaced voice cloning with a realistic female synthetic voice. The app uses Deepgram Aura 2 / Thalia through the configured OpenRouter speech endpoint. A real queued `shorts.enrich` run completed B-roll sourcing, sound design, female speech and branded outro. Output asset `af8a7073-7da5-4ea6-aaf4-57bccfe327dd` is stored at `storage/projects/f9137449-d3ca-4cbb-9dc1-23b0acea81d9/clips/7401bb58-464e-4bbf-bbe7-294ddff2b5fb/enriched.mp4`. Duration 10.72s; audio/video present; complete FFmpeg decode succeeded; end-card frame visually checked. Recorded provider estimate $0.003092. This verifies the enrichment job and stored asset, not completion of the isolated project (thumbnail/copy were outside this test).

Full workspace regression run: 202 tests passed, typecheck and lint passed. Enrichment now checks clip/product/project, candidate/project and transcript/source ownership before processing; configured missing or foreign logos fail explicitly. The test fixture initially lacked product feature rows and correctly failed schema validation before processing; copying the real feature rows fixed the test setup.

The latest Next production build passes. Two full-project tracing warnings from Postiz media upload reads were fixed by annotating the runtime storage paths; the subsequent build completed without warnings. Authenticated browser workflow and external deployment validation remain pending; the overall production-readiness goal is still active.

### Transcription cache correctness — September 22

Old behavior reused a source's transcript despite changed media, language, or STT backend/model. It also selected the newest of only the oldest50 rows. Cache reuse now requires a SHA256 identity over actual file bytes and transcription settings; rows without provenance are deliberately regenerated. Queries select the newest compatible row directly. Migration0002 adds nullable `transcripts.cache_key` without deleting historical transcripts. Both local databases migrated successfully. Unit tests cover same-path content changes, language/model/provider changes, credential rotation, backend selection and cancellation; actual PostgreSQL test verifies newest matching selection beyond50 rows and mismatch rejection. Pipeline85 tests passed; workspace typecheck/lint passed. Worker restarted with latest code, publication queues excluded. No additional paid provider call was needed for these cache regressions.

### Publishing failure state — September 22

Upload and configuration errors before post creation now persist `failed` and a redacted reason on both calendar row and asset. Ambiguous submissions retain their attempt marker and display explicit reconciliation guidance; confirmed post IDs remain available for polling recovery. Late errors preserve cancelled/published schedule rows. `test-publish-uncertain.ts` passes actual PostgreSQL/queue/upload transport fault injection with SafeChoice media: rejected upload produces no create call, dropped create response cannot be resubmitted by another queue job, and late published/error/timeout polls do not overwrite cancellation. This is failure-path validation against a local server, not live social-platform acceptance. Workspace typecheck and lint passed.

### Export integrity — September 22

Enrichment validates complete media decoding before storing an output or registering its asset. Probe metadata is insufficient: the regression corrupts middle packets while retaining valid duration and audio/video stream metadata. Strict FFmpeg decoding rejects that file. Other actual-media cases remove audio, shorten the clip and change dimensions; each fails. The valid 10.72s SafeChoice female-outro export passes. These tests require no provider calls and do not modify the originals. Workspace typecheck/lint and all85pipeline unit tests passed. The long-running video worker still needs restart to load this newest export guard; no live video jobs were initiated in this pass.

### Production process smoke and shared export integrity — September 22

Full decoding now runs before storage for promo, store previews, base clips and enriched clips through `assertDecodableVideo`. Base clips previously wrote storage before checking their metadata; validation now precedes replacement. All204workspace tests, typecheck/lint and production Next build pass. Damaged-media regression passes after extracting the shared helper.

Production web process started on loopback port3001 and worker restarted as53160 with video queues only. `test-production-runtime.ts` uses normal password login without printing secrets, then verifies library/jobs server pages, library API, live render worker health, unauthenticated file401, range206/1024bytes and HEAD size against real SafeChoice promo20cfa718-cec9-42b3-8ff1-b80565352551. This is production-mode HTTP verification, not browser interaction or external deployment. Initial arbitrary asset selection hit a missing historical file; storage audit found26historical missing rows, all already failed. The smoke now targets the explicitly verified promo run.

### Independent review and intake fixes — September 22

Long-form URLs were collected but explicitly discarded by the intake wizard. They now persist as validated, deduplicated source rows atomically with the product and version snapshot, including explicitly selected owned/licensed rights. Users start them from Sources after assets finish uploading. Discovered/failed rows with known rights now offer processing; previously those states incorrectly disabled the action. Saved promo URL references now initialize the generation form and AI-direction choice instead of being silently ignored. Actual QA database test validates source/profile/version linkage, duplicate elimination and rejection of invalid URLs without partial product creation. Connected-channel helper text now truthfully says automatic monitoring is unavailable rather than promising a nonexistent operation.

Independent audit identified remaining core work: snapshot the full product/run deliverable contract so edits cannot alter completion requirements mid-run; replace2GiB buffered multipart uploads with bounded streaming; finish browser acceptance. Broader gaps include curated reference-library selection, connected-source monitoring promised by the adopted spec, aggregate media workload accounting and Postiz reconciliation. Deployment host question and fresh browser login handoff are pending. See `video-acceptance-status.md`; do not infer completion from older progress entries.

### Stable run configuration — September 22

All new web and CLI projects capture full ProductProfile snapshots. Web creation reads product/features under a shared product-row lock. Pipeline stages and completion use the project's snapshot, not the mutable current profile. Legacy projects capture their matching current/historical version once; missing historical configuration fails with a new-run recovery instruction instead of substituting a different version. Actual PostgreSQL regression clones real SafeChoice clip/copy rows, edits product enrichment/branding/platform preferences mid-run, verifies the original settings remain, prevents completion before original enrichment, and permits completion after original deliverables exist despite new preferences. Foreign-product access is rejected. This test verifies configuration and completion semantics; it does not represent a fresh render.

### Bounded source uploads — September 22

The2GiB source-upload path no longer uses `req.formData()` plus `file.arrayBuffer()`. Busboy streams a single file into a private temporary directory with64KiB stream buffers, byte/part/field limits and30minute timeout. Only a validated nonempty video with audio and declared rights becomes durable storage/source row. Staging is removed after success, malformed input, limit failure, client abort or downstream failure. Exact maximum file size is accepted. Configured permission attestations now require real text rather than an invented fallback.

Parser regressions cover exact limit, oversize body/file, multiple files, duplicate fields, incomplete multipart, downstream failure and client abort. Native Node26 FormData's lazy test stream produced an unhandled enqueue-after-cancel error; fixtures now serialize multipart bytes to emulate incoming HTTP, and the real HTTP integration also passed. Production-mode QA server on loopback3002 signed in through normal password login, created a QA product through the real API, streamed an actual SafeChoice clip, verified identical SHA256 stored bytes and queued ingestion, rejected unknown rights, and left no staging files. Test ingest was cancelled before paid processing. No large fake or dummy video is presented as functional output.

### Fresh queue acceptance after configuration/export changes — September 22

Actual queued clip project4c9fad74-519e-4796-af09-cfa8622c36ea passed cut, title/captions, thumbnail, copy and silent enrichment. Clip61cd4082-20ec-49ec-8fb7-c348164784c5 persisted a content-addressed title PNG and270pxband. Actual queued female enrichment project51b088ca-505d-4278-9b2e-69037c389e12 saved asset3c779dfd-8011-4666-8c5a-bf53e050736f at `storage/projects/51b088ca-505d-4278-9b2e-69037c389e12/clips/f4cade8f-6075-43d5-894a-d0b00040a7fd/enriched.mp4`; B-roll/SFX/femaleoutro completed,10.72s, full decode, estimated$0.003122. These are actual provider/render outputs.

Follow-up inspection found promo/thumbnail still queried live brand associations despite the profile snapshot. They now resolve only the saved profile's owned image IDs and screenshot order, failing explicitly if missing. Real productionSafeChoice profile lookup verifies logo and six screenshots plus exclusion of unselected/foreign images. Pipeline85tests/typecheck/lint pass. These last asset-resolution changes were made after the fresh clip job loaded, so its prior success is not claimed as end-to-end proof of that final change. Long-lived services still need a coordinated restart after final changes.

### Confirmed Postiz submission recovery — September 22

Calendar rows with unresolved submissions now accept a user-confirmed Postiz post ID and resume status checks. The server verifies ownership, schedule eligibility, no active submission/poll, provider post existence, exact channel and original content before atomically saving the ID and queuing `publish.poll`. It never repeats `createPost`. The provider response shape was checked against official https://docs.postiz.com/public-api/posts/list . Known confirmed IDs cannot be replaced. An absent or mismatched post still requires investigation; the application does not infer non-publication from a missing list entry. Cancel action API errors now surface instead of being discarded.

Actual production-mode QA HTTP test logs in normally, rejects wrong asset/channel/content, races two recovery requests (one succeeds, one is refused), verifies exactly one status job and zero non-GET provider requests. Local fault server only; no public posting or live Postiz acceptance claimed. Build/typecheck/lint pass. Browser sign-in/deployment host responses remain pending.

## Final snapshot render regression (2026-09-22)

Saved catalog references now pass through the product page, promo request, project reference column and queue payload. Authenticated production-mode QA HTTP rejects missing catalog entries and conflicting reference inputs; the selected real source URL fixture is preserved. This is transport coverage, not a curated catalog claim. Production catalog remains empty.

Fresh SafeChoice promo project `87a4532a-92e7-4408-a6cc-18079b5d948a` completed using the final immutable asset resolver. Four 18-second renders (1080×1920, 1920×1080, 886×1920, 1920×886) and both 30fps store previews passed full decoding before persistent storage. The generated vertical thumbnail visibly contains the supplied product screenshots. The initial QA attempt `ca3656d1-8554-4f4c-96e1-05a40acde255` correctly rejected stale screenshot IDs in the old QA clone; repaired that disposable profile to its existing owned brand-asset IDs before creating a new run. No ownership guard was relaxed. CLI verification now exits unsuccessfully on failure/timeout and requires completed finalization rather than treating cancelled jobs as success.

All 212 automated tests, workspace typechecks, lint and production web build passed. Main video worker restarted on the current code (PID65670); publishing queue stays excluded. Browser login and production-host choice remain pending. Connected-source discovery and curated fallback ranking are still incomplete; the goal is not complete.

Independent review caught page/API eligibility using any uploaded logo while the renderer used selected profile IDs. Page display/count now follows the saved selection; the API resolves and validates the complete selected asset set inside the profile snapshot transaction. Actual authenticated QA HTTP rejects an unselected logo even with an existing logo association and rejects a missing selected screenshot; valid catalog request still queues correctly. Production build passes with the narrow profile-assets export, avoiding importing worker/Remotion dependencies into the web route.

## Source inspection repair (2026-09-22)

The declared `source.probe` job had no handler. Added actual metadata inspection, a scoped authenticated POST endpoint and a source-list Refresh metadata button with live queue/SSE status. A dedicated source lease protects against concurrent ingestion; admission checks source ownership and active source/project jobs atomically. Metadata inspection preserves source lifecycle state and explicitly chosen rights. It can infer licensed reuse only from the actual YouTube license metadata.

`test-source-probe.ts` uses normal password login on production-mode QA web, proves simultaneous requests produce one queued inspection, runs the actual worker against stored SafeChoice media, checks actual persisted duration, and rejects foreign/missing sources. Live YouTube inspection of the existing documentary source returned its real BBC title/uploader and211second duration without downloading or invoking paid AI. The shared YouTube probe has a180second total deadline, per-attempt limits, cancellation and classified client fallback, and is also used by ingestion. Four regression tests cover429fallback, private-video termination, cancellation and unusable duration. All94media tests pass; workspace typechecks/lint and production web build pass.

This closes individual source metadata inspection. It does not claim connected-channel discovery or recurring monitoring is implemented.

## Connected YouTube discovery (2026-09-22)

Added a real metadata-only channel scanner, source.discover worker, authenticated source-page action and daily worker scheduling. Channel URLs are restricted to HTTPS YouTube channel forms and normalized to the videos tab. Each scan reads the most recent50ordinary videos with a120second subprocess timeout; invalid/live/upcoming entries are excluded. The worker validates the saved connection again under product-row lock before persisting canonical source URLs, real titles/durations/creators, declared connection rights and poll time. Existing sources retain their state and rights. autoQueue=true atomically creates new snapshot projects and ingest jobs; this branch still needs targeted ingestion acceptance.

Live QA worker plus normal-login production HTTP scanned the BBC channel underlying the existing documentary source, received50real entries, and a repeat added zero duplicates. This used a disposable connected-owned configuration fixture strictly for testing; no media queue ran and all resulting third-party metadata rows were reset to unknown rights afterward. It is not a claim that SafeChoice owns BBC content. Unauthenticated and unconnected-channel requests were rejected. Daily scheduler QA confirms concurrency deduplication, persistent24hour cooldown, and next-day scheduling; those jobs were cancelled before network work. Full226unit tests, workspace typechecks and lint pass. Podcast RSS remains missing; configured owned-channel end-to-end automatic processing and browser interaction remain unverified.

## Automatic discovery admission and profile persistence (2026-09-22)

`test-discovery-autoqueue.ts` uses live channel metadata and the actual transaction/queue implementation. It injects an interruption immediately after the first transactional ingest enqueue and verifies no sources, projects or ingest jobs survive. Then two concurrent scans produce exactly50unique source/project/ingest groups, each containing the correct immutable product snapshot. No media worker runs; all generated ingest jobs are cancelled and test-source rights set back to unknown. This validates automatic admission, not downloading or clipping an owned channel. Requested an owned channel from the user for that final acceptance.

Connected channel URLs are now normalized and deduplicated on create/update, with invalid forms rejected before writes. Concurrent full-profile saves previously calculated the next version before taking a row lock; the version now increments from the locked current row. `test-connected-profile.ts` verifies two concurrent updates produce versions2and3 with complete snapshots, and an invalid channel leaves version3 unchanged. Workspace typechecks, lint and production build pass.

## Source approval workflow (2026-09-22)

The source list disabled processing for unknown rights and instructed the user to set rights, but offered no editor. Added a real editor and authenticated PATCH endpoint. Non-unknown declarations require confirmation; license/third-party declarations require an explanation. Stored attestation includes text, rights, acting user and timestamp. The endpoint checks product/source ownership and prevents changes while any associated processing is queued or running, using the same source advisory lock. Revoking a declaration sets rights back to unknown.

The ingest handler also now rejects already-stored media with unknown rights before cleaning/probing/processing; previously its rights gate only covered a new URL download. Normal-login production-mode QA HTTP plus actual ingest worker test verifies authorization, invalid declarations, pending-work exclusion, audit fields and early rights rejection with a real stored SafeChoice media source. No provider call or media processing occurs in the rejection test. Typechecks, lint and production build pass. Browser interaction acceptance remains pending.

## Real reference catalog and cached-analysis render (2026-09-22)

Expanded the search to dated Documents/Codex projects and found eight creative-direction files rather than the fifteen asserted by the early spec. They identify three distinct YouTube references: Introducing Canvas in Gemini(60s), Teamble(98s), Motion The Agency Sizzle Reel(57s). Live yt-dlp metadata verified all three. Evidence excerpts are preserved in docs/reference-catalog-evidence. Google/Teamble contain timed reference observations suitable for schema-validated cached analysis; the agency breakdown lacks timed observations and therefore still uses fresh video analysis. Initial curator score is neutral, explicitly not a new human rating. No missing references or timecodes were invented.

The catalog is now populated in both databases. Reference ranking implements the spec weights for category/platform/background/duration/curation/repetition with stable ID tie-breaking. The promo UI offers three real thumbnail choices and explains matches; the user explicitly chooses a reference or product-only direction. Authenticated choice API and promo submission tests verify sorted candidates, poster URLs, selected/alternative persistence and usage tracking inside the project transaction. Cached analysis needs only storyboard-provider configuration; invalid/out-of-range cache data falls back to video analysis.

Fresh SafeChoice project fb2b3b4a-8f4a-4429-9a0a-01254a7945a0 reached completed with four18second orientation renders and two30fpsstore previews. Every video passed full decoding before storage. Project metadata records referenceAnalysisCached=true and existing-creative-direction provenance. Usage ledger contains one storyboard call for$0.007053, with no vision call. The generated vertical thumbnail was inspected. Four ranking regressions/89pipeline tests, workspace typechecks, lint and production build pass. UI browser interaction remains unverified.

## Concurrent admission and catalog preservation (2026-09-22)

Manual source insertion previously bypassed the product lock used by channel discovery, allowing duplicate canonical URLs. Both paths now serialize on the product row. Actual production-build authenticated HTTP regression submits two URL aliases concurrently and verifies exactly one201/one400, one canonical row and unchanged unknown rights; no processing is queued. The initial test fixture omitted required feature rows and correctly received validation errors; the fixture was corrected before the successful run.

Reference import previously replaced the complete existing row on URL conflict, which could discard newer sampled-frame analysis or curator edits. It now inserts missing references only. A disposable QA regression changes existing analysis/curation/usage, runs the actual importer with live metadata checks for all three references, verifies every catalog row is unchanged, then restores the QA changes. Import evidence paths resolve relative to the script's workspace, independent of invocation directory. Unicode YouTube handles now normalize identically in raw/encoded form; malformed encodings and escaped separators are rejected. Media108tests, web/scripts typechecks, lint and production build pass. QA web restarted on port3002 with this build.

RSS inspection confirms connected podcast feeds are represented in the profile but have no discovery/ingestion implementation; audio-only media is rejected by current ingestion. An owned SafeChoice feed was requested for acceptance. No RSS completion claim is made.

## User clarification: simple promos and screened YouTube discovery (2026-09-22)

The user replaced podcast-feed work with two workflows: product name/description/assets generate promos; manual YouTube URLs or automatic product-topic discovery generate branded clips, thumbnails and publishing through the existing integration. Both supplied and discovered videos must be blocked if music or female figures are detected, and alternatives suggested. Existing synthetic female narration authorization remains unchanged; the new restriction refers to visible figures/source music. RSS and owned-feed acceptance requests are superseded.

Implemented actual yt-dlp topic search using its documented ytsearch metadata mode (https://github.com/yt-dlp/yt-dlp/blob/master/README.md), bounded20results/120seconds and5minute–3hour recordings. Added authenticated API, registered queue handler, product-topic search input, canonical deduplication, pending-screening provenance and unknown source rights. Actual normal-login production-build HTTP + real light-worker search for “ultra processed food health nutrition podcast interview” found19videos, including dzUDhstqXbg and5QOTBreQaIk. These are candidates only; no media was downloaded or approved. Fixture removed after test. Typechecks and production build pass; metadata tests cover duration/live/unknown cases and query constraints.

Independent review confirmed the existing B-roll filter is inadequate for original-source admission: eight samples miss brief appearances; region tiles do not guarantee each person has a corresponding face; music detection is absent. Fixed two concrete false-pass bugs: missing/undecodable sampled frames now reject, and invalid/non-finite classifier scores reject. Three Python regression cases pass. Do not equate these repairs with full-source content screening. Required next work: dedicated overlapping-window music classification; original video coverage and conservative uncertain outcomes; content-hash/policy-version cache; enforce before cleaning/transcription/clipping for manual, searched and rerun sources; provide independently screened alternatives. Automated absence detection cannot guarantee perfect results.

## Mandatory original-media screening foundation (2026-09-22)

Added a separate Python3.11runtime with pinned TensorFlow2.20/tf-keras2.20.1/OpenCV4.12, official YAMNet architecture/class map from a recorded TensorFlow source commit, preserved Apache license and SHA256verified weights. Dedicated setup script verifies cached music/person/face-presentation models. Normal processing does not download weights. Audio is decoded completely before overlapping classification. Music scores>=0.20reject;0.05–0.20block as uncertain. Thresholds are conservative initial policy choices, not calibrated guarantees.

Actual original nutrition sourcec806bbdb (211.0926s) yields439audio windows,24rejected and18uncertain, maxmusic0.93373. Opening windows score0.8788/0.9337. This changes the acceptance interpretation: earlier successful clipping proves processing, but that source is prohibited under the user's new restriction. Actual normal queue test with a newly created source/project snapshot rejects at screening before cleaning/transcription; persisted hash/coverage/findings and zero descendant jobs verified. The existing real synthetic female narration1.608s passes music detection with maximum0.001232. No paid provider call was required.

Visual inference decodes every frame and checks individual YOLOX person boxes, requiring one separately assessable face for each detected person. No-face, crowded, small and ambiguous presentations block. Exact repeated frame bytes may reuse inference; no temporal samples are skipped. Real SafeChoice promo87a4532a completed1080/1080decoded and inferred frames with no prohibited figure detected. This is a visual positive control, not a complete source-gate/clipping acceptance. Original nutrition footage's first frame was visually uncertain; the audio rejection independently suffices. Two visual and three audio policy regressions pass. Script-side file/model failures return uncertain; uncertain results are not permanently cached.

Pipeline gate runs on originalStorageKey before cleaning, and again at transcription/cut/enrichment entry to prevent later-job retries bypassing it. Report cache requires original content hash and policy version; allowed reports require complete audio and complete frame coverage. Source list shows checked/pending/blocked state and links back to topic search. Main worker89792 restarted with current gates; QA web uses latest production build.89pipeline tests,typechecks,lint/build pass. New isolated virtualenv is excluded from Git and ESLint.

Outstanding: validated full permitted-source clipping, actual restricted-figure fixtures across challenging scenes, cancellation/cache/missing-model queue fault tests, more calibrated classifier performance, long-video processing throughput, final enriched-output screening, publication gating of legacy clips, and automatically qualified alternatives. These remain incomplete. Automated classifiers cannot guarantee absence; this is not religious certification.

## Screening version2 and publication boundary (2026-09-22)

Independent review found real false-pass risks: downmixing opposite-phase stereo can cancel music, only the first audio track was read, rotated media could be reshaped using wrong dimensions, and the same face could satisfy multiple person boxes. Policyv2 independently checks every stream/channel, explicitly applies metadata rotation after decoding encoded dimensions, and requires unique face-to-person assignment. All previous-policy passes are invalidated. Source list marks old versions as needing current checks.

Real regressions use existing media: a container with clean female narration first and music-containing nutrition audio second is rejected(score0.963); anti-phase stereo made from the original music is rejected on both channels(score0.843). A rotation-tagged, nonuniform frame taken from the actual SafeChoice promo reaches inference with the same display orientation, differing by at most2RGBlevels due to chroma conversion order. The original211.09s nutrition source now checks878windows across two channels and has56music-positive windows. Actual queue rejection still creates no descendants. The real female narration passes v2 too.

A source pass is now validated against exact root/subpolicy versions, pinned model hashes, original content hash, every-frame count and per-channel coverage, not an allowed label alone. An actual publish-worker regression blocks a previously approved but unscreened real clip before any provider request, upload or create; the schedule fails with zero submission attempts. This guards legacy source-based clips. It does not yet screen newly added enrichment content in the final output.

Production SIGTERM/SIGINT handlers allow cleanup of decoder children. Actual tests observe a running FFmpeg child during audio extraction and during visual inference, cancel the parent, and verify both parent and observed children terminate. CPU benchmark measured approximately0.089sperframe at2/4/8threads vs0.272sat1thread on one representative1080pframe. Full actual18sSafeChoice promo v2 repeat inferred all1080frames in134.19seconds. Default is2threads. Long sources can take hours; fixed12hour inference timeout and14hour affected-job expiry are now aligned, verified against a real queued pg-boss row and cancelled without execution. This does not prove arbitrary long-podcast/deployment throughput.

All239workspace tests,typechecks,lint pass. Final production web rebuild including the stale-screening-label change passes; QA web restarted on port3002. Main worker94514 runs v2. Still required: full permitted-source clipping under these gates, qualified alternative discovery, final enriched-output policy, browser acceptance, persistent deployment and broader classifier calibration.

## Finished output and publishing repair (2026-09-22)

Original screening did not cover footage/audio added by enrichment. Both cut and enrichment now screen the fully decoded final file before saving it as a usable asset; enrichment writes a new report instead of inheriting its parent's proof. Publication hashes the finished bytes and requires complete current evidence as well as the original-source pass. Real historical SafeChoice enriched media rejects for music; missing output-specific proof blocks. Evidence: storage/tmp/finished-clip-screening-regression.json.

The publication worker also previously fetched explicit copy IDs without checking their asset/platform. It now scopes that lookup. Updated local transport regression uses a real rendered promo and an associated copy row; mismatched asset/platform attempts both fail before upload. Upload rejection, lost-create response and cancelled polling regressions pass. Main worker99589 is running current code.

Additional genuine SafeChoice assets in Downloads were checked, not manufactured into passing controls: 28.07s ad passes audio but blocks on a small face at8.467s; 29.37s app preview rejects music. Both remain unsuitable for positive acceptance. No public post, external deployment, or new permitted-source complete clip is claimed.

Final-output independent review follow-up: historical unscreened project5b433aab cannot be reconciled to completed; failed/rejected assets also cannot satisfy completion. Upload validation compares the immutable multipart body's hash with final-file evidence, and screens any compressed transport derivative. Actual local transport race test rejects changed bytes before a request. Existing remotely scheduled legacy clips are checked during polling: a confirmed pending job is deleted remotely; already-published or uncertain/cancellation-failed cases persist an actionable failure instead of reporting successful acceptance. A real QA queue against a local Postiz fixture verified GET+DELETE and cancelled status. Main database had zero pending remote schedules; no public remote mutation occurred.92pipeline,8publishing and5jobs tests plus actual transport regressions pass.

Manual inspection of the ad's blocked frame shows small illustrated figures inside the app screenshot, supporting the conservative block; this was not treated as a permissible source.

## Automatic qualification, 2026-09-22

Search now atomically queues license probes and at most three permitted full-source checks per batch. Five concurrent real-source QA probes enforce3admissions/1deferred/1unknown-rights block. Screening-only ingestion performs no cleaning or paid generation. Source rows show background jobs, permission/deferred states and verified matches first; current stored bytes must match the evidence before showing a pass. Parent/child queue cancellation is transactional, verified with real PostgreSQL lock contention.

Authenticated live nutrition search found19candidates and one verified Creative Commons match: Podcast: The Hazards of Ultra-Processed Foods, https://www.youtube.com/watch?v=kaozBsvg2_Y. A real separate qualification job downloaded it, inspected3154.62seconds across both audio channels(13144windows) and rejected328music-positive windows. No transcription, clipping or provider generation followed. Source31c86ff9-415a-43cb-a105-4d3cd1227fd1 and full evidence storage/tmp/youtube-qualification-31c86ff9-415a-43cb-a105-4d3cd1227fd1.json persist in QA. Thus automatic qualification is implemented and negative-path verified; a suitable accepted long-form source and full branded clip remain unverified. No production-readiness claim.

A new audit observation remains to resolve before licensed clip publication acceptance: copy generation accepts optional attribution metadata, but the cut job does not currently populate that field from the source. License credit propagation must be verified/fixed when completing the licensed positive workflow.

### Thumbnail handoff and branded promo covers (2026-09-22)
Independent thumbnail review found enrichment/thumbnail completion-order corruption, missing platform variants and missing publisher cover transport. Fixed the concrete race by serializing derivative registration and thumbnail propagation on the parent asset row. The real QA DB regression passes thumbnail-first, derivative-first, concurrent registration and stale-null replay. Repaired6existing main enriched clips with their actual parent thumbnails. Project completion now requires the enriched thumbnail too.

Promo posters now use the actual orientation frame plus saved palette, logo and tagline through the existing creative compositor. Actual SafeChoice output in `storage/tmp/branded-promo-covers` covers1080x1920,1920x1080,886x1920,1920x886; exact pixel dimensions/RGB-no-alpha checked and images inspected. This validates the shared rendering helper; a full fresh promo queue run with the newly composed covers still needs acceptance. Shorts frame-free dark-editorial choice removed because the thumbnail contract requires a relevant frame. Shorts platform variants, cover selection and Postiz cover transport remain open.

Real licensed2039slecture _BYekW77N1g and318sSnqVN56EjrM both rejected original music. Licensed549sK1G0ODkspWE completed actual download and audio check; its full visual scan is still active. No positive clipping claim made. Read-only provider-hold report added; main SafeChoice has zero outstanding reservations. Actual provider billing reconciliation cannot be inferred from that fact. No public post or external deployment occurred.
