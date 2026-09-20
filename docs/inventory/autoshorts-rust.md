# AutoShorts Rust backend — GATE 1 engineering inventory

Scope: `/Users/aarizazizrasheed/autoshorts/src-tauri/` — all 20 `.rs` files (9,173 lines), `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, plus the Python sidecars under `src-tauri/assets/` and the batch shell scripts in the repo root, read for contract purposes. Nothing was modified. `.env` was not read; only variable *names* were listed from it (present: `ANTHROPIC_MODEL`, `ANTHROPIC_OAUTH_TOKEN`, `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `PEXELS_API_KEY`, `POSTIZ_API_KEY`). A loose file named `OPEN ROUTER API KEY ` also sits in the repo root (`.gitignore` excludes it) — treat as a credential to rotate/remove.

Build facts: `Cargo.toml` — crate `autoshorts_lib` (staticlib/cdylib/rlib) + bin `autoshorts` (`src-tauri/Cargo.toml:8-14`); deps anyhow, chrono, dirs 6, dotenvy, reqwest 0.12 (json, multipart, rustls), rusqlite 0.32 bundled, serde/serde_json, tauri 2.2.5 with `protocol-asset`, tauri-plugin-dialog, thiserror (unused in src), tokio (macros, rt-multi-thread), uuid v4 (`:19-34`). `tauri.conf.json` — identifier `com.autoshorts.desktop`, dev URL `127.0.0.1:1420`, CSP null, asset protocol scope `$DOCUMENT/AutoShorts/**`, `$APPLOCALDATA/**`, `$DOWNLOAD/AutoShorts/**` (`:22-32`). Capabilities: `core:default`, `dialog:default` only (`capabilities/default.json:8-11`). Frontend is a single `src/main.tsx` (React 19, `@tauri-apps/api`, `plugin-dialog`, `convertFileSrc` for the creative PNG preview at `src/main.tsx:2195-2199`).

---

## 1. Tauri command surface (`src-tauri/src/lib.rs`)

26 commands registered at `lib.rs:1223-1250`. The frontend invokes 23 of them; `probe_project`, `extract_project_audio`, `save_demo_transcript` are registered but never called from `src/main.tsx`.

| # | Command | Line | async/sync | Params (camelCase over IPC) | Returns | Calls into |
|---|---|---|---|---|---|---|
| 1 | `environment_status` | `lib.rs:45-84` | async | `state` | `EnvironmentStatus` (`models.rs:5-24`) | `transcription::whisper_cli_exists/whisper_python_exists`, reqwest GET `http://localhost:11434` (1s timeout, `:53-58`), `media::command_exists("ffmpeg"/"ffprobe"/"yt-dlp")`, `anthropic_credential()` (`:457-463`), `openrouter::configured`, `facetrack::available`, `media::supports_captions || captions::available`, `outro::available`, `outro::can_clone_voice`. Reads `LLM_PROVIDER` (default `"deepseek"`), `DEEPGRAM_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`. |
| 2 | `pull_ollama_model` | `lib.rs:86-173` | async | `app: AppHandle`, `modelName` | `()` | POST `http://localhost:11434/api/pull` streaming NDJSON; emits `ollama-pull-progress` with `PullProgressPayload{status,completed,total,percentage}` (`:31-37`, `:167`). |
| 3 | `install_ollama` | `lib.rs:175-297` | async | `app` | `()` | `open -a Ollama`; `/opt/homebrew/bin/brew` or `/usr/local/bin/brew install --cask ollama`; else downloads `https://ollama.com/download/Ollama-darwin.zip`, `unzip`, `mv` to `/Applications/` or `~/Applications`; polls `:11434` 12×500ms; emits `ollama-install-status` (string) 12 times. macOS-only. |
| 4 | `create_project_from_path` | `lib.rs:299-322` | sync | `path`, `transcriptionMode`, `captionStyle`, `brandName?`, `brandLogoPath?` | `Project` | `validate_media_extension` (`:1387-1402`, mp4/mov/mp3/wav/m4a), `media::probe_media`, `db.create_project`. |
| 5 | `list_projects` | `lib.rs:324-327` | sync | — | `Vec<Project>` | `db.list_projects` |
| 6 | `get_project_detail` | `lib.rs:329-338` | sync | `projectId` | `ProjectDetail` (`models.rs:114-120`) | `db.project_detail` |
| 7 | `probe_project` | `lib.rs:340-355` | sync | `projectId` | `MediaProbe` | `media::probe_media`, `db.update_project_status(.., "ingest", duration)` |
| 8 | `extract_project_audio` | `lib.rs:357-369` | sync | `projectId` | `String` path | `media::extract_audio` → `<app_data>/projects/<id>/transcription_audio.wav` |
| 9 | `transcribe_project` | `lib.rs:371-430` | async | `projectId`, `provider` (`"deepgram"`\|`"local"`), `apiKey?` | `Transcript` | status→`transcribing`; `media::extract_audio` (blocking, in async fn); `transcription::transcribe_deepgram` or `transcribe_local(audio, data_dir)`; `db.save_transcript(engine=provider)`; status→`analyzing`. Reads `DEEPGRAM_API_KEY`. |
| 10 | `save_demo_transcript` | `lib.rs:432-448` | sync | `projectId` | `Transcript` | `demo_transcript()` (`:1404-1443`), engine `"demo"`. |
| 11 | `generate_candidates` | `lib.rs:465-569` | async | `projectId`, `apiKey?`, `provider?`, `modelName?`, `_allowDemo: bool` | `Vec<Candidate>` | Provider dispatch (`:487-557`): `"openrouter"`→`openrouter::detect_candidates` (and `std::env::set_var("OPENROUTER_API_KEY", k)` at `:495`), `"claude"`→`llm::detect_candidates_with_claude`, `"local"|"ollama"`→`llm::detect_candidates_with_local_llm` (model from `modelName`/`OLLAMA_MODEL`/`"llama3.2"`), `"gemini"`, `"openai"`, `"groq"`, `_`→DeepSeek. Default provider `LLM_PROVIDER` else `"claude"` (`:482-485`). Then `db.replace_candidates`, status→`ready`. |
| 12 | `list_brands` | `lib.rs:571-574` | sync | — | `Vec<creative::BrandProfile>` | `db.list_brands` |
| 13 | `save_brand` | `lib.rs:576-585` | sync | `brand: BrandProfile` | `BrandProfile` | `db.save_brand` (upsert) |
| 14 | `delete_brand` | `lib.rs:587-590` | sync | `brandId` | `()` | `db.delete_brand` |
| 15 | `generate_clip_creative` | `lib.rs:597-677` | async | `candidateId`, `brandId`, `headline?`, `kicker?`, `layout?: Layout` | `String` PNG path | `db.list_brands`, `db.clip_for_candidate`, `db.get_candidate_with_project`, `db.transcript_text_between`, `creative::write_copy` (OpenRouter Copy tier) unless headline given, `creative::render` (**blocking ffmpeg+python called directly in async fn, no spawn_blocking**, `:658-671`), `db.set_clip_creative`. Output `<clip dir>/<stem>_post.png`, 1080×1350. |
| 16 | `set_selected_clip_count` | `lib.rs:686-696` | sync | `projectId`, `count` (clamped 0..10) | `Vec<Candidate>` | `db.set_selected_clip_count` |
| 17 | `add_broll_to_clip` | `lib.rs:698-822` | async | `candidateId` | `String` final path | spawn_blocking #1 (`:706-760`): db lookups, `broll::enrich` → `<stem>_broll.mp4`; then `title::write_title` (async Anthropic call, `:773`); spawn_blocking #2 (`:777-821`): `title::apply` → `_titled.mp4` (soft-fail), `sfx::apply` → `_sfx.mp4` (soft-fail), `db.set_broll_path`. |
| 18 | `add_outro_to_clip` | `lib.rs:929-939` | async | `candidateId`, `videoPath` | `String` | `spawn_blocking(add_outro_blocking)` (`:862-927`): requires `project.brand_name`; writes `<video>.outro_words.json`; `outro::append` → `<stem>_final.mp4`. |
| 19 | `batch_progress` | `lib.rs:941-946` | async | — | `progress::BatchProgress` | `spawn_blocking(progress::read)` |
| 20 | `postiz_channels` | `lib.rs:948-953` | async | — | `Vec<postiz::Channel>` | `spawn_blocking(postiz::channels)` |
| 21 | `publish_clip_to_postiz` | `lib.rs:955-1000` | async | `videoPath`, `caption`, `channelIds: Vec<String>`, `scheduleAt?`, `dryRun: bool`, `publishNow?: bool`, `candidateId?` | `String` (sidecar stdout JSON) | `postiz::publish`; if not dry run, `db.set_postiz_state(cid, "posted"\|"draft", unix_epoch_secs)` (`:984-995`). |
| 22 | `render_flat_clip_for_candidate` | `lib.rs:1138-1148` | async | `candidateId` | `String` path | `spawn_blocking(cut_candidate_blocking)` (`:1004-1136`) — the core cut. |
| 23 | `delete_project` | `lib.rs:1150-1153` | sync | `projectId` | `()` | `db.delete_project` (FK cascade) |
| 24 | `rename_project` | `lib.rs:1155-1162` | sync | `projectId`, `name` | `()` | `db.rename_project` |
| 25 | `check_youtube_copyright` | `lib.rs:1267-1282` | async | `url` | `CopyrightCheckResult{isSafe,license,title,uploader,duration}` (`:1255-1263`) | `spawn_blocking`: `youtube::parse_video_id`, `youtube::probe`. |
| 26 | `download_youtube_video` | `lib.rs:1292-1325` | async | `url`, `acknowledgedLicense?: bool` | `String` local path | `spawn_blocking`: `parse_video_id`; if not acknowledged, `probe` and refuse non-CC (`:1300-1309`); `youtube::download` into `~/Downloads/AutoShorts`; `clean::clean` (soft). |

Events emitted (only two, both Ollama): `ollama-pull-progress` (`lib.rs:167`), `ollama-install-status` (`lib.rs:177,184,188,204,218,228,236,247,257,281,290`). Frontend listens only to `ollama-install-status` (`src/main.tsx`). **There are no progress events for transcription, ranking, cutting, B-roll, or publishing** — the UI awaits the `invoke` promise; the only "progress" is `batch_progress` polling a log file (section 2).

Error convention: every command returns `Result<T, String>` via `to_command_error` (`lib.rs:1445-1447`); OpenRouter errors are additionally passed through `openrouter::redact` (`lib.rs:506, 648`).

State: `AppState{db: Database, data_dir: PathBuf}` (`lib.rs:39-43`), created in `.setup` (`lib.rs:1212-1222`) from `app.path().app_data_dir()` (= `~/Library/Application Support/com.autoshorts.desktop` on macOS), SQLite at `<data_dir>/autoshorts.sqlite`, plus a `models/` subdir.

---

## 2. Pipeline orchestration

### Interactive flow (button-driven, one clip at a time)

1. **Import** — `create_project_from_path` (`lib.rs:299`) or `download_youtube_video` (`lib.rs:1292`) → `youtube::download` → `clean::clean` (`clean.rs:36-84`, soft-fails to original) → `create_project_from_path`. Status `ingest`.
2. **Audio extract** — inside `transcribe_project` (`lib.rs:392-396, 406-410`) via `media::extract_audio` (`media.rs:151-173`): mono 16 kHz WAV at `<app_data>/projects/<pid>/transcription_audio.wav`. Sync `Command::output()` inside an async command (blocks a tokio worker).
3. **Transcribe** — `transcription::transcribe_deepgram` (`transcription.rs:8-30`, async reqwest) or `transcribe_local` (`transcription.rs:214-355`, uses `spawn_blocking` around whisper CLI / python). Result `NormalizedTranscript{language,duration,speakers,words[],segments[]}` (`models.rs:124-148`), stored as pretty JSON in `transcripts.raw_json`. Status `transcribing` → `analyzing`.
4. **LLM rank** — `generate_candidates` (`lib.rs:465`) → provider fn → `llm::parse_candidate_json` (`llm.rs:646-829`) → `db.replace_candidates` (`db.rs:404-456`: deletes old candidates, inserts new + one `clips` row per candidate with status `pending`, marks first 3–6 `selected`). Status `ready`.
5. **Hooks** — there is no separate hook step; `hook` is the LLM's verbatim opening line stored on `candidates.hook` and reused as the B-roll `topic` (`lib.rs:743-747`), title-prompt seed (`title.rs:61`), and creative-copy seed (`lib.rs:646`).
6. **Render (cut)** — `render_flat_clip_for_candidate` → `cut_candidate_blocking` (`lib.rs:1004-1136`), all synchronous inside `spawn_blocking`:
   - clip status `cutting`; output `~/Documents/AutoShorts/<slug>/clips/clip-NN_flat.mp4` via `documents_project_dir` (`lib.rs:1331-1360`, `.project-id` marker to avoid slug collisions);
   - `media::probe_media` for crop size (`:1024-1033`);
   - `generate_srt` (`:1449-1484`, 3-word chunks) written to `<app_data>/projects/<pid>/clip-<cid>.srt`, path stored in `clips.caption_ass_path` (misnamed);
   - `captions::render_track` (`captions.rs:188-261`) → Pillow PNG sequence + concat list in `std::env::temp_dir()/captions-<uuid>/` (deleted on `Drop`, `captions.rs:52-56`); fallback `build_drawtext_filters` (`lib.rs:1497-1641`) if Pillow unavailable;
   - `media::render_flat_clip` (`media.rs:175-229`) → `facetrack::plan_crop` (`facetrack.rs:105-178`, soft) → `build_render_command` (`media.rs:249-320`) → ffmpeg;
   - on any ffmpeg failure, **retry once without captions** (`lib.rs:1097-1134`), record warning in `clips.render_log`; status `done` or `error`.
7. **Enrich** — `add_broll_to_clip` (`lib.rs:698-822`): `broll::enrich` → `title::write_title` (Anthropic Haiku, `title.rs:61-114`) → `title::apply` → `sfx::apply` → `db.set_broll_path`. Artefact chain: `clip-NN_flat.mp4` → `_broll.mp4` → `_broll_titled.mp4` → `_broll_titled_sfx.mp4`.
8. **Outro** — `add_outro_to_clip` → `outro::append` → `<stem>_final.mp4`. Not applied by batch unless `OUTRO_IN_BATCH=1` (`lib.rs:856-858`).
9. **Creative + publish** — `generate_clip_creative` (`lib.rs:597`), `publish_clip_to_postiz` (`lib.rs:955`).

### Batch flow (the real bulk orchestrator lives in `#[cfg(test)] #[ignore]` tests)

`batch_render_all` (`lib.rs:2004-2169`, serial), `render_parallel` (`lib.rs:2352-2514`, `tokio::sync::Semaphore(BATCH_CONCURRENCY default 3)`, `worker_threads = 8`, `STOP_AT_EPOCH` deadline), `retitle_all` (`lib.rs:2253-2333`). They are launched by shell scripts: `finish_all.sh` (`cargo test --lib --release -- --ignored --nocapture render_parallel`, 6 passes, log `~/broll-work/finish_all.log`), `run_batch.sh`, `run_until_reset.sh` (reads Anthropic `anthropic-ratelimit-unified-5h-reset` header to set the deadline), `resume_work.sh`. They open the same SQLite file the running app holds open (`lib.rs:2050-2054` comment acknowledges this). Resume logic checks for finished artefact names on disk (`lib.rs:2089-2109`, `2379-2390`).

### Progress (`progress.rs`)

`progress::read` (`progress.rs:56-110`) parses `~/broll-work/finish_all.log` for `DONE `/`SKIP `/`FAIL `/`PROJECT `/`=== batch pass `/`[broll]`/`[title]`/`[outro]`/`[sfx]`/`TITLE ` lines and decides liveness with `pgrep -f render_parallel|batch_render_all|retitle_all` (`progress.rs:38-53`). Returned as `BatchProgress{running,done,skipped,failed,currentProject,currentTotal,currentStep,lastDone,pass,logPath}` (`progress.rs:12-29`). This is entirely coupled to the cargo-test batch hack and to `pgrep`.

### Sync vs blocking summary

- `spawn_blocking` used: `transcribe_local` (`transcription.rs:229, 328`), `add_broll_to_clip` (×2), `add_outro_to_clip`, `batch_progress`, `postiz_channels`, `publish_clip_to_postiz`, `render_flat_clip_for_candidate`, `check_youtube_copyright`, `download_youtube_video`.
- Blocking subprocess work inside `async fn` without `spawn_blocking`: `environment_status` (many `Command::output()` probes incl. repeated `python -c "import X"`), `transcribe_project` (`media::extract_audio`), `generate_clip_creative` (`creative::render`: ffmpeg + 2 python runs).
- Sync commands that shell out (Tauri runs them on its own pool): `create_project_from_path`, `probe_project`, `extract_project_audio`.

---

## 3. SQLite schema (`src-tauri/src/db.rs`)

`Database{conn: Arc<Mutex<Connection>>}` (`db.rs:16-19`), single connection, no WAL, every method `lock().expect("database mutex poisoned")`. Migration runs in `open` (`db.rs:22-33`) → `migrate` (`db.rs:35-156`).

### Tables (`db.rs:37-100`, `121-143`) and post-hoc `ALTER`s (errors ignored)

**projects** (`:41-50`): `id TEXT PK`, `name TEXT`, `source_path TEXT NOT NULL`, `source_duration REAL`, `status TEXT NOT NULL`, `transcription_mode TEXT NOT NULL`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`. ALTERs: `name TEXT` (`:101`, redundant), `caption_style TEXT` (`:102`), `brand_name TEXT` (`:104`), `brand_logo_path TEXT` (`:105`), `brand_id TEXT` (`:145`, **never read or written anywhere**).

**transcripts** (`:52-59`): `id TEXT PK`, `project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE`, `engine TEXT NOT NULL`, `raw_json TEXT NOT NULL`, `language TEXT`, `created_at TEXT NOT NULL`.

**candidates** (`:61-71`): `id TEXT PK`, `project_id` FK cascade, `start_sec REAL NOT NULL`, `end_sec REAL NOT NULL`, `score REAL NOT NULL`, `hook TEXT NOT NULL`, `rationale TEXT NOT NULL`, `rank INTEGER NOT NULL`, `selected INTEGER NOT NULL DEFAULT 0`.

**clips** (`:73-81`): `id TEXT PK`, `candidate_id` FK cascade, `status TEXT NOT NULL`, `output_path TEXT`, `face_track_json TEXT` (never written), `caption_ass_path TEXT` (holds an .srt path), `render_log TEXT`. ALTERs: `broll_path TEXT` (`:109`), `postiz_state TEXT` (`:113`), `postiz_at TEXT` (`:114`), `creative_path TEXT` (`:153`), `creative_headline TEXT` (`:154`) — the last two are written by `set_clip_creative` but **never selected back** (not in `Clip` model `models.rs:81-99`).

**clip_copy** (`:83-90`): `id`, `clip_id` FK cascade, `platform TEXT NOT NULL`, `hook_text`, `caption_text`, `hashtags`. Read by `list_copy_for_project` only; **no writer exists**.

**schedule_entries** (`:92-98`): `id`, `clip_id` FK cascade, `platform`, `scheduled_for`, `status`. **Never read or written.**

**brands** (`:122-142`): `id TEXT PK`, `name TEXT NOT NULL`, `tagline`, `description`, `website_url`, `app_store_url`, `play_store_url`, `logo_path`, `screenshot_dir`, `color_ink`, `color_accent`, `color_canvas`, `color_ground`, `font_display`, `font_body`, `font_heavy`, `cta_text`, `created_at NOT NULL`, `updated_at NOT NULL`. ALTERs `color_ground`, `font_heavy` (`:149-150`) for installs predating them.

`PRAGMA foreign_keys = ON` (`:39`) is set on this connection only.

### Query functions

| Function | Line | Returns / effect |
|---|---|---|
| `create_project(source_path, transcription_mode, caption_style, source_duration, brand_name, brand_logo_path)` | `db.rs:158-202` | inserts, status `"ingest"`, blank brand strings → NULL; returns `Project` |
| `list_brands()` | `:205-236` | `Vec<BrandProfile>` newest first |
| `save_brand(BrandProfile)` | `:243-275` | upsert `ON CONFLICT(id)`; generates uuid if id blank; note odd param order `?17,?18,?16,?16` (`:258`) |
| `delete_brand(id)` | `:277-281` | |
| `set_clip_creative(clip_id, path, headline)` | `:284-291` | |
| `list_projects()` | `:293-303` | `Vec<Project>` by `updated_at DESC` |
| `get_project(id)` | `:305-314` | `Project` (errors "no rows" if missing) |
| `project_detail(id)` | `:316-330` | `ProjectDetail{project, transcript, candidates, clips, copy}` |
| `update_project_status(id, status, source_duration?)` | `:332-345` | `COALESCE` duration, bumps `updated_at` |
| `save_transcript(project_id, engine, raw_json, language)` | `:347-381` | **deletes** prior transcripts for project, inserts one |
| `latest_transcript(project_id)` | `:383-402` | `Option<Transcript>` |
| `replace_candidates(project_id, &[CandidateDraft])` | `:404-456` | deletes candidates (cascades clips), inserts with `rank=i+1`, `selected = index < min(max(min(n,6),3),n)`, plus a `clips` row `status='pending'` each; returns `Vec<Candidate>`. Not wrapped in a transaction. |
| `set_postiz_state(candidate_id, state, at)` | `:462-469` | update clips by candidate_id |
| `set_broll_path(candidate_id, path)` | `:472-479` | |
| `list_candidates(project_id)` | `:481-490` | by `rank ASC` |
| `get_candidate_with_project(candidate_id)` | `:492-534` | `(Candidate, Project)` join |
| `clip_for_candidate(candidate_id)` | `:537-562` | `Option<Clip>` |
| `transcript_text_between(project_id, start, end)` | `:570-591` | joined segment text overlapping window |
| `update_clip_for_candidate(candidate_id, status, output_path?, caption_ass_path?, render_log?)` | `:593-612` | `COALESCE` updates |
| `set_selected_clip_count(project_id, count)` | `:614-626` | `selected = rank <= count`; returns list |
| `list_clips_for_project` (private) | `:628-653` | join via candidates, `rank ASC` |
| `list_copy_for_project` (private) | `:655-676` | |
| `delete_project(id)` | `:678-682` | cascade |
| `rename_project(id, name)` | `:684-692` | |

Row mappers: `project_from_row` (`:695-709`), `candidate_from_row` (`:711-724`). Timestamps are RFC 3339 strings via `chrono::Utc`, except `postiz_at`, which `lib.rs:986-989` writes as **unix epoch seconds** despite `models.rs:97` documenting ISO-8601.

---

## 4. Per-module capability table

| Capability | file:line | Function | Inputs | Outputs | External deps | Env vars read | Fails | Pure logic reusable? | Fragile / unfinished |
|---|---|---|---|---|---|---|---|---|---|
| Probe media | `media.rs:86-149` | `probe_media(path)` | path | `MediaProbe{duration,has_video,w,h,vcodec,acodec}` | `ffprobe` | `AUTOSHORTS_FFPROBE` | hard (Err) | yes (JSON mapping) | parses `format.duration` as string only |
| Extract audio | `media.rs:151-173` | `extract_audio(src, dir)` | src, project dir | `transcription_audio.wav` 16k mono | `ffmpeg` | `AUTOSHORTS_FFMPEG` | hard | trivial | overwrites fixed filename per project |
| Filter probe cache | `media.rs:50-84` | `ffmpeg_has_filter`, `supports_captions` | filter name | bool (OnceLock cache) | `ffmpeg -filters` | — | soft (false) | yes | — |
| Vertical render | `media.rs:175-320` | `render_flat_clip`, `build_render_command` | src, start/end, out, drawtext?, overlay list? | mp4 | `ffmpeg`, `facetrack` | `AUTOSHORTS_FFMPEG` | hard | `build_render_command` is pure (tested `:322-388`) | crop of 9:16 always; face-track summary only `eprintln` |
| Face-tracked crop | `facetrack.rs:105-178` | `plan_crop(src,start,end)` | src, window | `Option<CropPlan{x,y,summary}>` (ffmpeg exprs) | python + `cv2` + YuNet ONNX (232 KB embedded `:19`) | `AUTOSHORTS_PYTHON` (via pyenv) | soft (None) | no, sidecar wrapper | OnceLock caches python path + assets for process lifetime |
| Caption chunking | `captions.rs:102-182` | `chunk_words(words,start,end)` | words | `Vec<Chunk{text,start,end}>` uppercase, 3–4 words, break on punctuation or ≥0.34 s pause | — | — | n/a | **yes, pure, well tested** (`:263-376`) | — |
| Caption raster track | `captions.rs:188-261` | `render_track(words,start,end,w,h,style,work_root)` | chunks + style id | `Option<CaptionTrack{concat_list}>`, PNG dir auto-deleted on Drop | python + Pillow, `captions.py`, `caption_styles.py/.json` (36 presets) | — | soft (None) | no | writes to `temp_dir()`; `CaptionTrack` must outlive ffmpeg (RAII) |
| drawtext fallback | `lib.rs:1497-1641` | `build_drawtext_filters` | words, crop width, style | filter string | ffmpeg w/ libfreetype | `WINDIR`,`SystemRoot` | soft | pure but OS-font-path bound | 7 styles; strips punctuation |
| SRT | `lib.rs:1449-1495` | `generate_srt`, `format_srt_time` | words | SRT text (3-word cues) | — | — | n/a | yes | ms rounding via `as u32` |
| Deepgram | `transcription.rs:8-96` | `transcribe_deepgram(audio,key)`, `normalize_deepgram` | wav path | `NormalizedTranscript` (speakers `S1..`) | `api.deepgram.com/v1/listen?model=nova-2&smart_format&diarize&punctuate&filler_words` | key passed in (`DEEPGRAM_API_KEY` resolved in lib) | hard | `normalize_deepgram` + `build_segments` (`:98-138`) pure | whole file read into memory; no timeout |
| Local Whisper | `transcription.rs:214-355` | `transcribe_local(audio, model_dir)` | wav, dir | `NormalizedTranscript` | `whisper` CLI (`--model base --output_format json --word_timestamps True`) or generated `transcribe.py` + python `whisper` | via pyenv | hard | `normalize_whisper_raw_json` (`:160-212`) pure | model size hardcoded `base` (`:232,334`); `model_path` arg is really data_dir; inline Python heredoc; deletes CLI side-outputs |
| LLM detection (vendor) | `llm.rs:33-94,116-176,193-248,250-308,359-456,468-540` | `detect_candidates_with_{deepseek,gemini,openai,groq,claude,local_llm}` | transcript, key/model | `Vec<CandidateDraft>` | HTTPS vendor APIs / Ollama `localhost:11434` | `DEEPSEEK_MODEL`,`GEMINI_MODEL`,`OPENAI_MODEL`,`GROQ_MODEL`,`ANTHROPIC_MODEL` | hard | prompt strings are portable | no timeouts; retry only on Claude |
| Claude short text | `llm.rs:318-353` | `ask_claude_text(prompt,key)` | prompt | text | `api.anthropic.com/v1/messages`, `max_tokens 64` | `ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`) | hard | — | swallows body on non-2xx |
| Candidate JSON repair | `llm.rs:556-865` | `extract_json_span`, `parse_candidate_json`, `fit_to_min_duration`, `suppress_overlaps`, `compact_segments` | model text + transcript | drafts | — | `MAX_CANDIDATES` | hard on unparseable | **yes, pure, tested** (`:867-996`) | error text says "Ollama output" for all providers (`:714`) |
| OpenRouter client | `openrouter.rs:263-442` | `post_chat`, `chat(task,system,user,json_mode,max_tokens)`, `extract_text` | body | `Completion{text,usage}` | `openrouter.ai/api/v1/chat/completions` | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_{REASONING,COPY,UTILITY,IMAGE}` | hard after 5 attempts | `redact`, `is_retryable`, `backoff_secs`, `extract_text`, `base64_decode` pure & tested | `generate_image` (`:449-501`) refuses remote URLs, effectively data-URI only; `Task::Image`, `Task::Utility` unused in app |
| OpenRouter detection | `openrouter.rs:542-618` | `detect_candidates(transcript, model_override)` | transcript | drafts via `llm::parse_candidate_json` | as above | as above | hard | prompt portable | — |
| Brand model | `creative.rs:37-95` | `BrandProfile`, `to_spec` | — | JSON for creative.py | — | — | — | yes | — |
| Frame sampling | `creative.rs:184-240` | `sample_frames(video,dir,16)` | clip | jpgs | `ffmpeg` | — | hard→caught soft in `render` | — | skips first/last 8 % |
| Frame pick | `creative.rs:259-301` | `pick_frame(frames)` | jpg list | `Option<FrameScore>`; None if textiness > 0.45 | python `creative.py --pick-frame` (cv2 optional) | — | hard→soft | — | — |
| Creative copy | `creative.rs:309-400` | `write_copy(brand,clip_text,hook)`, `parse_copy` | brand, transcript excerpt | `CreativeCopy{headline,kicker}` | OpenRouter `Task::Copy`, `max_tokens 300`, json_mode | via openrouter | hard | `parse_copy` pure, tested | — |
| Creative render | `creative.rs:416-490` | `render(CreativeRequest)` | video, brand, headline, layout, size | PNG path | python + Pillow `creative.py` (stdin JSON) | — | hard | — | 4 layouts (`:100-136`) |
| YouTube id/URL | `youtube.rs:129-226` | `parse_video_id`, `is_video_id`, `canonical_url` | user string | `VideoId` | — | — | `InvalidUrl` | **yes, pure, tested** (`:423-581`) | — |
| YouTube probe/download | `youtube.rs:293-421` | `probe`, `download`, `run_ytdlp`, `classify` | id, dest | `VideoMeta`, path | `yt-dlp` | — | typed `DownloadError` | `classify` pure | no cookies; CC check by license string |
| Source clean | `clean.rs:36-84` | `clean(video)` | path | `<stem>_clean.mp4` or original | python (`cv2` preferred), `clean_source.py`, ffmpeg | — | **soft** | — | silently uses original on any failure |
| B-roll | `broll.rs:115-186` | `enrich(clip,words,start,end,topic,out)`, `write_transcript` | cut clip + words | `_broll.mp4` | python + Pillow, `broll_pipeline.py`, `~/b-rolls-ref` skill checkout, Anthropic API (direct from Python), Pexels/Wikimedia, cv2 + models downloaded from GitHub | `BROLLS_SKILL_DIR`; in .py: `ANTHROPIC_API_KEY/OAUTH_TOKEN`, `ANTHROPIC_MODEL`, `PEXELS_API_KEY`, `BROLL_PEOPLE_POLICY` | hard | `write_transcript` trivial | depends on an external repo pinned by path; own LLM retry (8 attempts) |
| Title | `title.rs:48-157` | `fallback_title`, `write_title` (async), `apply` | excerpt, hook | headline; `_titled.mp4` | Anthropic via `llm::ask_claude_text`; python + Pillow + cv2 `title_bar.py` + YuNet | `ANTHROPIC_API_KEY`,`ANTHROPIC_OAUTH_TOKEN` | `write_title` soft (fallback), `apply` hard (caller softens) | `fallback_title` pure, tested | prompt hard-wired to Anthropic only |
| SFX | `sfx.rs:50-130` | `ensure_kit`, `apply(video,scene_plan?,transcript?,out)` | video, plan JSON | `_sfx.mp4` | python `make_sfx.py`/`sfx_mix.py`, ffmpeg | `SFX_KIT_DIR` (default `~/autoshorts/sfx`) | hard (callers soften) | — | kit synthesised locally |
| Outro | `outro.rs:62-128` | `available`, `can_clone_voice`, `append(clip,app_name,logo?,transcript?,out)` | branded clip | `_final.mp4` | python + Pillow `outro.py`, `voice_pick.py` (numpy), `tts_clone.py` in separate `~/tts-venv/bin/python` (torch/torchaudio), macOS `say` fallback, ffmpeg | `AUTOSHORTS_TTS_PYTHON` | hard | — | Py 3.11 venv assumption; `say` is macOS-only |
| Postiz | `postiz.rs:28-120` | `configured`, `channels`, `publish` | video, caption, ids, when, flags | JSON strings | python `postiz_post.py` | `POSTIZ_API_KEY` (py: `POSTIZ_API_URL`, `TIKTOK_POSTING_METHOD`) | hard | — | all logic in Python |
| Batch progress | `progress.rs:56-110` | `read()` | log file | `BatchProgress` | `pgrep`, `~/broll-work/finish_all.log` | — | soft | log parser is pure-ish | coupled to cargo-test batch |
| Python discovery | `pyenv.rs:16-110` | `candidates`, `find_with_module`, `find_any`, `find_venv_script` | module name | interpreter path | spawns python per candidate | `AUTOSHORTS_PYTHON` | soft (None) | — | uncached except in facetrack; walks up 6 dirs from exe |
| Env loading | `lib.rs:1171-1205` | `load_env` | — | process env | dotenvy | `AUTOSHORTS_ENV` | soft | — | searches exe ancestors, `~/autoshorts/.env`, `~/.autoshorts/.env` |
| Branding gate | `lib.rs:832-858` | `has_real_branding`, `batch_should_add_outro` | Project | bool | fs exists | `OUTRO_IN_BATCH` | n/a | yes, tested | placeholder list `my app/app name/your app/test` |

---

## 5. Provider abstraction

There is **no trait**; selection is a `match` on a string in `generate_candidates` (`lib.rs:487-557`). Provider default: `provider` param → `LLM_PROVIDER` → `"claude"` (`lib.rs:482-485`); note `environment_status` reports default `"deepseek"` (`lib.rs:47-49`) — inconsistent. Per-call `apiKey` from the UI overrides env for every provider; for OpenRouter it is written into the process env with `set_var` (`lib.rs:495`).

| Provider | Function | Endpoint | Auth | Model env / default | Temp / tokens | JSON mode | Retry | Timeout |
|---|---|---|---|---|---|---|---|---|
| DeepSeek | `llm.rs:33-94` | `https://api.deepseek.com/chat/completions` | `Authorization: Bearer` | `modelName` → `DEEPSEEK_MODEL` → `deepseek-chat` (`:53-58`) | 0.2 / default | `response_format json_object` | none | none |
| Gemini | `llm.rs:116-176` | `https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key=` (**key in URL**, `:135-138`) | query param | `GEMINI_MODEL` → `gemini-2.5-flash` | 0.2 | `responseMimeType application/json` | none | none |
| OpenAI | `llm.rs:193-248` | `https://api.openai.com/v1/chat/completions` | Bearer | `OPENAI_MODEL` → `gpt-4o-mini` | 0.2 | json_object | none | none |
| Groq | `llm.rs:250-308` | `https://api.groq.com/openai/v1/chat/completions` | Bearer | `GROQ_MODEL` → `llama-3.3-70b-versatile` | 0.2 | json_object | none | none |
| Anthropic (detect) | `llm.rs:359-456` | `https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01` | `x-api-key` for `sk-ant-api…`; `authorization: Bearer` + `anthropic-beta: oauth-2025-04-20` for `sk-ant-oat…` (`:385-395`) | `ANTHROPIC_MODEL` → `claude-3-5-sonnet-latest` (`:378`) | 0.2 / `max_tokens 8000` | none (relies on repair) | 6 attempts on 429/5xx, `retry-after` or `2^(attempt+1)` capped 60 s (`:412-446`); attempt counter is a `thread_local!` (`:355-357`) reset only in the DeepSeek fn (`:38`) | none |
| Anthropic (title) | `llm.rs:318-353` | same | same | `ANTHROPIC_MODEL` → `claude-haiku-4-5-20251001` (`:320`) | default / `max_tokens 64` | none | none | none |
| Ollama | `llm.rs:468-540` | `http://localhost:11434/api/chat` | none | `modelName` → `OLLAMA_MODEL` → `llama3.2` (`lib.rs:518-520`) | 0.2 | full JSON schema in `format` (`:504-523`) | none | none |
| OpenRouter | `openrouter.rs:542-618` via `post_chat` (`:263-345`) | `https://openrouter.ai/api/v1/chat/completions`, headers `HTTP-Referer: https://github.com/JayWebtech/autoshorts`, `X-Title: AutoShorts` (`:39-40`) | Bearer `OPENROUTER_API_KEY` | `modelName` → `OPENROUTER_MODEL_REASONING` → `google/gemini-2.5-flash`; Copy/Utility → `…-flash-lite`; Image → `google/gemini-2.5-flash-image` (`:60-99`) | 0.2 / 8000 (detect); 0.3 / caller (chat) | json_object; `usage.include=true` | 5 attempts, retry on 408/409/429/5xx, transport errors and HTTP-200-with-error; `Retry-After` capped 120 s else `2^(attempt+1)` capped 60 (`:241-260`) | connect 20 s, total 300 s (`:146-158`), shared client |
| Deepgram (STT) | `transcription.rs:8-30` | `https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&punctuate=true&filler_words=true` | `Authorization: Token` | fixed nova-2 | — | — | none | none |
| Whisper (STT) | `transcription.rs:214-355` | local CLI or python module | — | `base` hardcoded | — | — | none | none |

**Credential resolution**: `anthropic_credential()` (`lib.rs:457-463`) = `ANTHROPIC_API_KEY` else `ANTHROPIC_OAUTH_TOKEN`; the B-roll Python sidecar re-implements the same (`broll_pipeline.py:157-158`, `100-111`). `openrouter::api_key()` reads env fresh every call (`openrouter.rs:106-111`).

**Prompt locations and product context**:
- Candidate detection (DeepSeek/Gemini/OpenAI/Groq/Claude): identical "elite, world-class social media strategist … viral … 30-90 seconds … up to 25 candidates" prompt at `llm.rs:40-51`, `121-132`, `198-209`, `255-266`, `364-375`. Ollama system prompt variant `llm.rs:474-482` (3–10 candidates, hard 30–90 s). OpenRouter editorial prompt `openrouter.rs:548-587` (sentence-boundary, self-contained, 20–90 s, "be harsh"). **None of these accept any product/brand/niche context** — input is only `compact_segments` (`llm.rs:542-554`, `[start-end] Speaker: text` lines).
- Title: `title.rs:76-90` — inputs hook + spoken text; no brand context.
- Creative copy: `creative.rs:314-350` — system + user prompt; product context = `brand.name` and `brand.tagline` only ("The app is {name}, {tagline}."), plus clip transcript excerpt and hook.
- B-roll scene plan: `broll_pipeline.py:63` `plan_prompt(lines, topic)` where topic = candidate hook (Python-side, Anthropic only).

**JSON repair** (`llm.rs:646-829`): strip ``` fences → `serde_json::from_str` → else `extract_json_span` brace-matcher that skips string literals (`:561-594`) → accept array, or object with key in `candidates|Candidates|moments|clips|segments|results`, or first array-valued key, or a single `{start,end}` object (`:674-717`) → coerce `start/end/score` from f64/str/i64 (`:721-764`) → normalise score `/10`, `/100`, clamp (`:766-774`) → `fit_to_min_duration` grows clips forward then backward along segment edges to 30 s (or half-duration ≥5 s for <60 s sources, `:650-654`) → filter ≥min & non-empty hook, fallback ≥5 s → sort by score → `suppress_overlaps(0.5)` measured against the shorter clip → truncate `MAX_CANDIDATES` (default 25). `creative::parse_copy` (`creative.rs:364-400`) does fence-strip + first `{`…last `}` carve.

---

## 6. FFmpeg / ffprobe usage

Rust-side (binary from `AUTOSHORTS_FFMPEG`/`AUTOSHORTS_FFPROBE` else PATH, `media.rs:21-33`):

1. Probe — `ffprobe -v error -print_format json -show_format -show_streams <path>` (`media.rs:91-100`).
2. Filter capability — `ffmpeg -hide_banner -filters`, second whitespace column == name (`media.rs:63-73`).
3. Audio extract — `ffmpeg -y -i <src> -vn -ac 1 -ar 16000 <dir>/transcription_audio.wav` (`media.rs:159-162`).
4. Clip render (`build_render_command`, `media.rs:249-320`):
   ```
   ffmpeg -y -ss {start:.3} -i {source}
          [-f concat -safe 0 -i {captions.txt}]          # only if overlay && has_video
          -t {max(end-start,0.1):.3}                     # after all inputs (regression-tested :345-362)
     video:  crop=w='2*trunc(min(iw,ih*9/16)/2)':h='2*trunc(min(ih,iw*16/9)/2)'[:x='{fx}':y='{fy}'],
             scale=1080:1920:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,setsar=1[,drawtext=...]
       no overlay:  -vf "<filter>"
       overlay:     -filter_complex "[0:v]<filter>[base];[base][1:v]overlay=0:0:format=auto:shortest=0[v]" -map [v] -map 0:a?
             -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p
     audio-only source: -vn
     -c:a aac -b:a 192k {out}
   ```
   Crop offsets come from `facetrack::plan_crop` as literal ints or time-varying expressions (`facetrack.rs:154-167`), default centred `(in_w-out_w)/2`.
5. drawtext fallback (`lib.rs:1583-1636`): per 2-word chunk `drawtext=[fontfile='…':]text='…':x=(w-text_w)/2:y=h*0.65|0.7|0.72:fontsize={w*0.075 clamp 16..80}:…:enable='between(t,{s:.3},{e:.3})'` with styles `classic-outline` (yellow, `borderw`), `minimal-shadow`, `vibrant-cyan` (`0x00FFFF`), `vibrant-yellow-box` (`box=1:boxcolor=0xffff00e0`), `vibrant-green` (`0x39FF14`), `vibrant-red` (`0xFF3B30`), default `modern-box` (`boxcolor=0x000000b0`). Font path searched in hardcoded macOS/Windows/Linux lists (`lib.rs:1514-1538`).
6. Creative frame sampling — `ffmpeg -v error -y -ss {dur*0.08:.3} -t {dur*0.84:.3} -i <clip> -vf fps=1/{step:.3} -q:v 2 <dir>/frame_%03d.jpg` (`creative.rs:202-218`).

Python-side (all use bare `ffmpeg`/`ffprobe` on PATH, not the Rust override):
- `title_bar.py:308-316` — `[0:v]{vf}[base];[base][1:v]overlay=0:0:format=auto[v] -map [v] -map 0:a?` (banner PNG over full clip; optional sharpen).
- `sfx_mix.py:233-243` — `amix=inputs={n+1}:duration=first:normalize=0[aout]`, `-map 0:v -map [aout]` (video stream copied).
- `outro.py:153-154, 175-176` — end card `[0:v]{zoom}[v];[1:a]apad[a]`, then `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`; system TTS via macOS `say -v <voice> -o x.aiff` + ffmpeg convert (`:201-203`).
- `clean_source.py:263-265` — `[0:v]split[main][cap];[cap]crop=w:bh:0:band_top,boxblur=luma_radius=24:luma_power=2[blur];[main][blur]overlay=0:band_top[v]` (blurs detected caption band); audio clean step with a subprocess timeout (`:194-202`).
- `broll_pipeline.py:874-886` — re-composites the original caption band over B-roll: `[1:v]{GRADE},split=2…crop=1080:{h}:0:{y},format=rgba…alphaextract,negate…alphamerge…overlay=x=0:y={y}{enable}[v]`, `-map [v] -map 1:a:0?`.

---

## 7. Python sidecar contract

**Interpreter discovery** (`pyenv.rs:16-66`): ordered candidates = `AUTOSHORTS_PYTHON` → `.venv/bin/python`, `venv/bin/python` (Windows `Scripts/python.exe`) under each of: exe dir and 6 ancestors, cwd, `~/autoshorts` → `python3`, `python`. `find_with_module(m)` spawns `<py> -c "import m"` for each candidate until success (`:69-78`); `find_any` uses `--version` (`:81-85`); `find_venv_script("whisper")` looks in the candidate's bin dir then `--help` on PATH (`:89-110`). Only `facetrack.rs:53-58` caches the result (`OnceLock`); every other module re-probes on each call.

**Asset materialisation**: each module `include_str!`s its script(s) and `include_bytes!`s the YuNet ONNX (`facetrack.rs:18-19`, `title.rs:11-12`, `broll.rs:16-19`, `captions.rs:19-23`, `clean.rs:12`, `creative.rs:27`, `outro.rs:14-16`, `sfx.rs:15-16`, `postiz.rs:11`), then writes them to `dirs::data_local_dir()/autoshorts/<module>/` (macOS `~/Library/Application Support/autoshorts/<module>/` — **not** the Tauri `com.autoshorts.desktop` dir), rewriting whenever content differs (byte compare for scripts, length compare for the model). Pattern identical in `facetrack.rs:62-94`, `title.rs:19-41`, `broll.rs:40-63`, `captions.rs:58-83`, `clean.rs:14-29`, `creative.rs:150-165`, `outro.rs:36-58`, `sfx.rs:32-47`, `postiz.rs:34-49`. `transcription.rs:264-322` instead writes an inline `transcribe.py` heredoc into `data_dir` on first use.

**Per-sidecar contracts** (Rust caller → argv/stdin → stdout/exit):

| Sidecar | Rust caller | argv / stdin | stdout | Deps |
|---|---|---|---|---|
| `facetrack.py` | `facetrack.rs:113-124` | `--video <src> --model <onnx> --start {s:.3} --end {s:.3}` (`--sample-fps` default 4) | last `{…}` line: `{"mode": "none"\|"fixed"\|…, "x","y","x_expr","y_expr","reason","coverage","cuts"}` (`facetrack.rs:21-38`); exit 0 even on `none` | `cv2.FaceDetectorYN` |
| `captions.py` | `captions.rs:226-255` | **stdin JSON** `{width,height,duration,style,assets,out_dir,chunks:[{text,start,end}]}` (`captions.rs:32-42`) | path to `captions.txt` concat list; PNG frames `cap_NNNN.png` in `out_dir`; exit 1 on bad spec/no Pillow | Pillow; `caption_styles.py` + `caption_styles.json` beside it (36 studio presets, falls back to built-in `STYLES`) |
| `title_bar.py` | `title.rs:122-132` | `--video --text --output --assets <dir>` (`--png-only` unused) | output path; stderr `[title]` | Pillow, optional cv2 + YuNet to place banner above face, ffprobe/ffmpeg |
| `broll_pipeline.py` | `broll.rs:141-156` | `--clip --topic --skill-dir --output --assets <dir> [--transcript broll_transcript_<stem>.json]`; transcript file `{"words":[{text,start,end}]}` clip-relative (`broll.rs:81-109`) | final path; stderr `[broll]` | `~/b-rolls-ref/scripts/{prepare_project,render_project,verify_output}.py`, Anthropic direct (`ANTHROPIC_MODEL` default `claude-sonnet-4-5-20250929`, `max_tokens 8000`, 8 attempts, 300 s timeout), Pexels (`PEXELS_API_KEY`) or Wikimedia Commons, cv2 + gender/person ONNX downloaded from GitHub at runtime (`:306-333`), `BROLL_PEOPLE_POLICY` default `no-women`; working dir `edit_<stem>/` with `scene_plan.json` |
| `sfx_mix.py` | `sfx.rs:91-104` | `--video --kit <dir> --output [--scenes scene_plan.json] [--transcript json] [--dry-run]` | output path; stderr `[sfx]` | ffmpeg/ffprobe; kit WAVs |
| `make_sfx.py` | `sfx.rs:61-65` | `--out <dir>` | writes `attention,riser,whoosh,boom,stinger,pop.wav` | stdlib only |
| `outro.py` | `outro.rs:89-106` | `--clip --app-name --output --assets <dir> --tts-python <path> [--logo] [--transcript outro_words.json]` | output path; stderr `[outro]/[voice]/[tts]` | Pillow; calls `voice_pick.py --audio --out [--transcript]` → JSON `{gender,f0,speakers_found}` or `{error}` (numpy); `tts_clone.py --reference --text --out` under `~/tts-venv/bin/python` (torch/torchaudio), 900 s timeout, fallback macOS `say` |
| `clean_source.py` | `clean.rs:52-58` | `--video --output` (`--assets`, `--no-audio-clean`, `--report-only` unused) | output path; stderr `[clean]` | cv2 optional, ffmpeg |
| `postiz_post.py` | `postiz.rs:58-61, 77, 98-119` | `integrations` or `post --video --content [--integration <id>]* [--when ISO] [--dry-run] [--publish]` (also `selftest`) | JSON; stderr `[postiz]` | urllib only |
| `creative.py` | `creative.rs:263-278` / `456-489` | `--pick-frame <jpg>…` → stdout `{"best":{path,textiness,score},"all":[…]}`; else **stdin JSON** `{frame,headline,kicker,attribution,brand:{name,colorInk,colorAccent,colorCanvas,colorGround,fontDisplay,fontBody,fontHeavy,logoPath,ctaText},layout,size:[w,h],screenshot,out}` (`creative.rs:444-454`) → written path | Pillow (exit 2 if missing), cv2 optional for textiness |
| `blur_women.py` | — | not referenced from Rust (orphan asset) | | |

Common Rust pattern: `Command::output()` (fully buffered), filter stderr lines by `[tag]` prefix to `eprintln!`, on non-zero exit return last 3–6 stderr lines joined by ` | `, prefer the path printed on stdout over the requested `--output`, then check `exists()`.

---

## 8. Postiz integration (`postiz.rs` + `assets/postiz_post.py`)

- `configured()` = `POSTIZ_API_KEY` non-empty (`postiz.rs:28-32`); `run` refuses otherwise (`:51-54`), uses `pyenv::find_any`.
- `channels()` (`:76-81`) → `postiz_post.py integrations` → parses `Vec<Channel{id,name?,identifier?,profile?,disabled}>` (`:13-26`), drops `disabled`.
- `publish(video, caption, channel_ids, when, dry_run, publish_now)` (`:88-120`) → `post --video … --content … [--integration id]… [--when w] [--dry-run] [--publish]`; empty ids = all channels. Default is **draft** (`:85-87`).
- Python side: base `https://api.postiz.com/public/v1` or `POSTIZ_API_URL` (`postiz_post.py:32,40`); header `Authorization: <raw key>` (no Bearer) (`:85`); `request()` retries 5× on 5xx/OSError with `min(30, 2^attempt)` backoff, 600 s timeout, 4xx → `SystemExit` with grouped validation messages (`:79-108`). Flow: `GET /integrations` → `fit_for_upload` (re-encode under 45 MB cap, `:~150-190`) → `POST /upload` multipart field `file` (`:210-216`) → `POST /posts` body `{type: "draft"|"schedule"|"now", date: ISO, shortLink:false, tags:[], posts:[{integration:{id}, value:[{content, image:[<uploaded media>]}], settings}]}` (`:290-330`). Provider settings: `tiktok` `{__type, content_posting_method: TIKTOK_POSTING_METHOD default DIRECT_POST, privacy_level PUBLIC_TO_EVERYONE, …}`, `instagram`/`instagram-standalone` `{post_type:"post"}`, `youtube` `{type:"public", title}`; title = first caption line for providers that want one (`:230-290`).
- State stored: only `clips.postiz_state` ∈ {`draft`,`posted`} and `clips.postiz_at` = unix-epoch-seconds string, keyed by candidate (`lib.rs:984-995`, `db.rs:462-469`). No Postiz post id, media id, or channel ids are persisted; `schedule_entries` table is unused.

---

## 9. YouTube (`youtube.rs`)

- Validation (`:129-226`): accepts bare 11-char id, `youtube.com|www.|m.|music.youtube.com|youtu.be|www.youtu.be` with `/watch?v=`, `/shorts/`, `/embed/`, `/live/`, `/v/`, `youtu.be/<id>`; refuses other schemes, `@` in authority, other hosts. Canonical URL rebuilt (`:117-119`).
- `run_ytdlp` (`:340-371`): iterates `PLAYER_CLIENTS = [web_embedded, ios, mweb, android, tv]` (`:32`) with `--extractor-args youtube:player_client=<c>` prepended; `NotFound` → `ToolMissing`; only `Transient` advances to the next client.
- `probe` (`:293-332`): `yt-dlp --dump-json --no-warnings --skip-download -- <url>`; `reuse_allowed` iff license string contains "creative commons" or "reuse allowed" (`:309-315`).
- `download` (`:374-421`): `--format "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best" --merge-output-format mp4 --retries 10 --fragment-retries 10 --no-warnings -o <dest>/AutoShorts_%(id)s.%(ext)s --print after_move:filepath --no-simulate -- <url>`; last stdout line must exist on disk.
- `classify(stderr)` (`:233-268`) → `Private | AgeRestricted | GeoBlocked | Unavailable | Transient | Other`; `user_message()` (`:54-94`).
- **No cookies / `--cookies-from-browser` support**; age-restricted is a dead end. Bare `yt-dlp` on PATH, no override env. Download dir `~/Downloads/AutoShorts` (`lib.rs:1311-1313`). Copyright gate enforced only when `acknowledgedLicense` is falsy (`lib.rs:1300-1309`).

---

## 10. Desktop / OS coupling (migration seams)

- Tauri: `#[tauri::command]` ×26, `tauri::State<AppState>`, `tauri::AppHandle` + `Emitter::emit` (`lib.rs:88, 167, 176-290`), `Manager::path().app_data_dir()` (`lib.rs:1213-1216`), `tauri_plugin_dialog` (`lib.rs:1211`, used in frontend `src/main.tsx:621,741,776`), `protocol-asset`/`convertFileSrc` for previews (`Cargo.toml:28-30`, `tauri.conf.json:24-31`).
- `dirs` crate: `data_local_dir` for sidecars (9 modules, see §7); `home_dir` for `~/broll-work/finish_all.log` (`progress.rs:32-35`), `~/tts-venv/bin/python` (`outro.rs:28-31`), `~/autoshorts/sfx` (`sfx.rs:25-29`), `~/b-rolls-ref` (`broll.rs:28-31`), `.env` search (`lib.rs:1193-1196`), venv search (`pyenv.rs:45-47`); `download_dir` (`lib.rs:1311`); `document_dir` for clip output (`lib.rs:1332`).
- Hard file-system layout: clips in `~/Documents/AutoShorts/<slug>[-<id8>]/clips/` (`lib.rs:1331-1385`), SRTs and audio in `<app_data>/projects/<pid>/`, caption frames in `temp_dir()`, creative frames in `<app_data>/creative/<cid>/frames`.
- macOS-only binaries: `open -a Ollama`, `brew`, `unzip`, `mv` to `/Applications` (`lib.rs:178-279`), `pgrep` (`progress.rs:46`), `say` (`outro.py:201`), `caffeinate` (shell scripts).
- Process-global mutation: `std::env::set_var("OPENROUTER_API_KEY")` from a request parameter (`lib.rs:495`); `dotenvy` loads `.env` into process env at startup (`lib.rs:1171-1205`).
- Localhost assumptions: Ollama at `localhost:11434` (`lib.rs:54, 94, 187, 227, 289`; `llm.rs:487`).
- Blocking `std::process::Command` everywhere (no async process API, no streaming stdout, no cancellation, no timeouts on any subprocess in Rust).
- Batch orchestration and progress depend on running `cargo test --ignored` binaries and reading their log (§2).

---

## 11. Hazards list

**Markers / placeholders**: `lib.rs:833` `PLACEHOLDERS` brand names; no TODO/FIXME/HACK strings exist in src. Unused tables `clip_copy` writer, `schedule_entries`, `projects.brand_id`, `clips.face_track_json`, `clips.creative_path/creative_headline` never read (`db.rs:83-98, 145, 153-154`). `_allow_demo` param ignored (`lib.rs:472`). `Task::Image`/`generate_image` and `Task::Utility` unused (`openrouter.rs:57-58, 449-501`). `blur_women.py` orphan. `thiserror` dep unused.

**`unwrap()/expect()/panic!` in non-test code**: `db.rs:36,182,206,247,278,285,294,306,339,363,384,409,463,473,482,493,538,601,619,629,656,679,685` (`lock().expect("database mutex poisoned")` — a panic in any DB call poisons the mutex and every later call panics); `captions.rs:153-154` (guarded); `openrouter.rs:156` (client build); `lib.rs:1252` (Tauri run). All others are in `#[cfg(test)]`.

**Hardcoded paths**: `lib.rs:195-198` `/opt/homebrew/bin/brew`, `/usr/local/bin/brew`; `lib.rs:261-274` `/Applications`, `~/Applications`; `lib.rs:1516-1529` system font paths; `creative.rs:596-598` `/Users/aarizazizrasheed/safechoice`, `/private/tmp/claude-501/…` (ignored tests); `media.rs:397-407` `/private/tmp/claude-501/…` (ignored test); `progress.rs:33-35` `~/broll-work/finish_all.log`; `outro.rs:30` `~/tts-venv`; `broll.rs:30` `~/b-rolls-ref`; `sfx.rs:27-28` `~/autoshorts/sfx`; `openrouter.rs:39` referer `github.com/JayWebtech/autoshorts`.

**Sleep / timeout / retry**: Ollama probe 1 s (`lib.rs:55`), install polls 12×500 ms (`lib.rs:185-190, 225-231, 287-293`); Claude retry 6 attempts (`llm.rs:412-446`) with cross-call `thread_local` counter (`llm.rs:355-357`, reset only at `:38`); OpenRouter 5 attempts, 20 s/300 s timeouts (`openrouter.rs:146-158, 260-345`); yt-dlp `--retries 10 --fragment-retries 10` × 5 clients (`youtube.rs:32, 392-395`); Python: Anthropic 8 attempts (`broll_pipeline.py:141-142`), Postiz 5 attempts/600 s (`postiz_post.py:79-108`), TTS 900 s (`outro.py:270`). **No timeout** on DeepSeek/Gemini/OpenAI/Groq/Claude/Ollama/Deepgram reqwest calls or on any Rust `Command::output()`.

**Concurrency limits**: `BATCH_CONCURRENCY` default 3 via `tokio::sync::Semaphore` (`lib.rs:2358-2361, 2412`), `worker_threads = 8` (`lib.rs:2352`) — test code only. Interactive commands have no concurrency control; single SQLite `Mutex<Connection>` serialises all DB access and is shared with batch processes writing the same file. `replace_candidates` deletes+inserts without a transaction (`db.rs:409-455`).

**Security / multi-tenant blockers**: `set_var("OPENROUTER_API_KEY")` from request (`lib.rs:495`); Gemini key in URL query (`llm.rs:135-138`); vendor error bodies returned verbatim to UI for DeepSeek/Gemini/OpenAI/Groq/Claude (`llm.rs:83,164,236,294,434`) — only OpenRouter is redacted; `.env` loaded process-wide; user-supplied `path` for `create_project_from_path` only extension-checked (`lib.rs:1387-1402`); user-supplied `video_path` in `add_outro_to_clip`/`publish_clip_to_postiz` only existence-checked (`lib.rs:878, 969`); ONNX models downloaded from GitHub at runtime by `broll_pipeline.py:306-333`.

**Correctness nits**: default provider mismatch `"deepseek"` (`lib.rs:48`) vs `"claude"` (`lib.rs:484`); `postiz_at` epoch vs documented ISO (`lib.rs:986-989`, `models.rs:97`); `caption_ass_path` holds SRT (`lib.rs:1038-1041`); `has_local_whisper_model` really means CLI/module presence (`lib.rs:51`); `transcribe_local` second arg named `model_path` receives `data_dir` (`lib.rs:411`, `transcription.rs:214, 265`); parse error text hardcodes "Ollama" (`llm.rs:714`); Claude default model id `claude-3-5-sonnet-latest` (`llm.rs:378`) vs Haiku 4.5 for titles and Sonnet 4.5 in the Python planner — three different model pins for one vendor.

---

## 12. Classification per module (target: Node/TypeScript web worker)

Honest framing: nothing here can be dropped into a Node worker verbatim. "REUSE" below means "compile as a Rust CLI/library and call it"; everything else is a port. Category (a) = thin orchestration around ffmpeg/python, cheap to port; (b) = substantive logic worth keeping in Rust.

| Module | Class | Category | Justification |
|---|---|---|---|
| `lib.rs` command layer + `run()` | REWRITE | a | Pure Tauri glue: `State`, `AppHandle`, `emit`, `dirs`, Documents/Downloads paths, `spawn_blocking`. Becomes HTTP/queue handlers; only `cut_candidate_blocking` (`:1004-1136`), `add_outro_blocking`, `has_real_branding`, `generate_srt`, `documents_project_dir` slug logic carry over as specs. |
| `lib.rs` batch tests (`:1992-2514`) | REWRITE | a | A job queue disguised as `#[ignore]` tests launched by shell scripts; replace with real worker jobs, resumability by DB state not filenames. |
| `progress.rs` | REWRITE | a | Log-scraping + `pgrep`; replaced by job-status rows/events. |
| `db.rs` | REWRITE | a | Straightforward SQL; port schema to Postgres/Prisma/Drizzle, add transactions, drop dead tables, fix `postiz_at`. Keep column semantics. |
| `models.rs` | ADAPT | a | Direct translation to TS types / zod; already camelCase over serde. |
| `media.rs` | ADAPT | a | Small ffmpeg arg builders; port `build_render_command` and its `-t`-after-inputs regression test to TS (fluent-ffmpeg or spawn). |
| `facetrack.rs` | WRAP | a | 60 lines of subprocess + JSON; the value is `facetrack.py` + YuNet. Ship Python + model in the worker image, call from Node. |
| `captions.rs` | ADAPT (chunker) / WRAP (renderer) | a | `chunk_words` is pure, tested logic — port to TS with its tests. Renderer is `captions.py` + presets; wrap. |
| `transcription.rs` | ADAPT | a | Deepgram normaliser and `build_segments` are pure and trivial to port; Whisper CLI wrapper is spawn-and-parse. |
| `llm.rs` | ADAPT | b-ish | Vendor calls are trivial in TS; the value is `parse_candidate_json` + `fit_to_min_duration` + `suppress_overlaps` + `extract_json_span` with their tests — port faithfully or expose as a Rust CLI/wasm if you want zero drift. Prompts are portable strings. |
| `openrouter.rs` | ADAPT | a | Tiering enum, retry/backoff, `redact`, `extract_text` — all small and tested; port to TS. |
| `creative.rs` | WRAP (renderer) / ADAPT (copy) | a | `creative.py` does the work; `write_copy`/`parse_copy` are a prompt + parser to port. `BrandProfile` → TS type. |
| `youtube.rs` | ADAPT | b (small) | `parse_video_id`/`classify` are security-relevant, well-tested pure logic — port with the test table intact, or keep as a tiny Rust CLI. yt-dlp invocation is spawn. |
| `clean.rs`, `title.rs`, `sfx.rs`, `outro.rs`, `broll.rs`, `postiz.rs` | WRAP | a | Each is <200 lines of "materialise script, build argv, run, read stdout". The real behaviour lives in the Python sidecars (and, for B-roll, in `~/b-rolls-ref`). Package the sidecars as a Python service/container and call them from Node; `fallback_title` (`title.rs:48-58`) is a one-liner to port. |
| `pyenv.rs` | REWRITE | a | Desktop venv discovery is irrelevant in a container with a pinned interpreter. |
| `postiz.rs` + `postiz_post.py` | REWRITE (in TS) | a | Direct REST client; simpler to reimplement `GET /integrations`, `POST /upload`, `POST /posts` in Node than to shell out to Python. |
| `main.rs`, `Cargo.toml`, `tauri.conf.json` | DROP | — | Desktop packaging only. |

Net: there is no module that justifies keeping a Rust runtime in the web worker. The two places where Rust logic is non-trivial and tested — candidate JSON repair/fitting (`llm.rs:556-865`) and YouTube URL validation/classification (`youtube.rs:129-281`) — are each under 350 lines and port cleanly to TypeScript with their existing test vectors. The substantive media/design logic is already in Python (`facetrack.py`, `captions.py` + `caption_styles.*`, `title_bar.py`, `creative.py`, `outro.py`, `clean_source.py`, `sfx_mix.py`, `broll_pipeline.py`) and in the external `b-rolls-ref` checkout; those are the assets to containerise.