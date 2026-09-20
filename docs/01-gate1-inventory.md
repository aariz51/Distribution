# Gate 1 — Inventory

Date: 2026-09-20. Sources read in full: `~/Promo-Video-` (91 files), `~/autoshorts` (20 Rust files / 9,173 lines, 14 Python sidecars / 5,600 lines, 2,944-line React frontend, 5 shell scripts, SETUP.md), the `watch` and `b-rolls` skills they depend on, and the GitHub repository `aariz51/Distribution`. Detailed per-file inventories with `path:line` references live in [`inventory/`](inventory/):

- [`inventory/autoshorts-rust.md`](inventory/autoshorts-rust.md) — Tauri command surface, orchestration, SQLite schema, provider matrix, ffmpeg graphs, sidecar contracts, hazards, classification.
- [`inventory/autoshorts-python-frontend.md`](inventory/autoshorts-python-frontend.md) — every sidecar's CLI contract and deep dive, frontend features, batch scripts, Python environments, assets.
- [`inventory/promo-video.md`](inventory/promo-video.md) — skill step table, Remotion template contract, audio builder, render cost, `watch` internals, classification.
- [`inventory/distribution-repo-and-environment.md`](inventory/distribution-repo-and-environment.md) — the (empty) GitHub repo, local toolchain, reachable services, test data, third-party dependencies.

## Decision / Recommendation

1. **The Distribution repo is empty**, so the workspace defines every convention. Created `~/Distribution` on `main` with `origin` set; nothing to preserve.
2. **Do not keep a Rust runtime.** All Tauri coupling sits in `lib.rs`; the other 19 modules are Tauri-free, but they are thin subprocess/HTTP glue (~80 % of lines) around Python sidecars and ffmpeg. The substantive, tested pure logic is ~600 lines (`llm.rs:556-865` JSON repair/fit/overlap suppression, `youtube.rs:129-281` URL validation, `captions.rs:102-182` chunker, `media.rs:249-320` render-command builder) and ships with test vectors that port 1:1 to TypeScript. A Rust CLI would force two LLM provider layers (Rust for ranking, TS for everything else), defeating the unified provider/cost requirement. Classification: **Python sidecars REUSE VERBATIM; pure algorithms ADAPT (port with the original test vectors as equivalence tests); orchestration REWRITE as queue jobs.**
3. **Promo-Video's value is in four agent-reasoning steps that have no schema or tests today.** They become three LLM job steps producing schema-validated JSON (reference analysis → product analysis → storyboard), rendered by a **prop-driven Remotion kit** (`inputProps` + `calculateMetadata`) refactored from the existing template. Generated-TSX-per-film is deferred to a gated "custom device" stage.
4. **Postgres is the only infrastructure available locally** (no Redis, no Docker), which makes a Postgres-backed queue (pg-boss) the boring choice. Confirmed in Gate 3.
5. **Two legal blockers to resolve before commercial output**: the promo SFX pack (`vendor/promo-video/NOTICE`) and `sfx_lib/` (undocumented provenance) must be replaced; Remotion needs a company licence check. The synthesised `make_sfx.py` kit and OFL fonts are safe.
6. **One product-behaviour item needs Aariz's decision**: the gender-classifier content policy (`BROLL_PEOPLE_POLICY=no-women`, `blur_women.py`, female-voice preference). It is implemented as an explicit per-product "content preferences" setting collected at intake, with no silent default. See Open Questions.

## Findings

### Feature inventory — AutoShorts (what exists, where, state)

| Capability | Where (file:line) | Inputs → outputs | External deps | State |
|---|---|---|---|---|
| Import local media | `lib.rs:299-322`, `media.rs:86-149` | path → `Project` (probe via ffprobe) | ffprobe | works; extension allowlist only |
| YouTube import + licence gate | `youtube.rs:129-421`, `lib.rs:1267-1325` | URL → mp4 in `~/Downloads/AutoShorts` | yt-dlp (5 player clients) | works; no cookies; CC-only unless acknowledged |
| Source clean (caption-band blur/crop, Demucs vocal isolation) | `clean.rs:36-84`, `clean_source.py` | mp4 → `_clean.mp4` | cv2, demucs/torch, ffmpeg | works, soft-fail; Demucs is 1 h timeout, heavy |
| Audio extract | `media.rs:151-173` | mp4 → 16 kHz mono wav | ffmpeg | works |
| Transcribe (Deepgram nova-2 / local Whisper base) | `transcription.rs:8-355` | wav → `NormalizedTranscript{words,segments,speakers}` | Deepgram API or whisper CLI | works; Whisper ≈ 0.8× realtime CPU; no Deepgram key present |
| Viral-moment ranking (7 providers) | `llm.rs:33-540`, `openrouter.rs:542-618`, `lib.rs:465-569` | transcript → `CandidateDraft[]` | DeepSeek, Gemini, OpenAI, Groq, Anthropic, Ollama, OpenRouter | works; **no product context in prompts**; no timeouts except OpenRouter |
| JSON repair, min-duration fit, overlap suppression | `llm.rs:556-865` (tests `:867-996`) | model text → drafts | — | pure, tested |
| Hook | `candidates.hook` (LLM opening line) | — | — | no separate step |
| Speaker-aware 9:16 crop | `facetrack.py`, `facetrack.rs:105-178` | clip window → crop plan (static / time-varying expr) | cv2 + YuNet ONNX | works, soft-fail, single speaker |
| Caption chunking | `captions.rs:102-182` (tests `:263-376`) | words → 3–4-word chunks | — | pure, tested |
| Caption rendering (PNG overlay, 7 legacy + 36 studio presets) | `captions.py`, `caption_styles.py/.json` | chunks + style → PNG sequence + concat list | Pillow | works; studio presets fully colour-parameterised; UI exposes only 7 |
| drawtext fallback / SRT | `lib.rs:1449-1641` | words → filter string / SRT | ffmpeg w/ libfreetype | works where ffmpeg has drawtext |
| Vertical render | `media.rs:175-320` (tests `:322-388`) | src + window + crop + captions → mp4 | ffmpeg | works; `-t`-after-inputs regression guarded; retry once without captions |
| Title banner (LLM headline + face-avoiding overlay) | `title.rs:48-157`, `title_bar.py` | clip + hook → `_titled.mp4` | Anthropic Haiku, Pillow, cv2 | works; colours hardcoded white/black; Anthropic-only prompt |
| B-roll enrichment | `broll.rs:115-186`, `broll_pipeline.py`, `vendor/b-rolls`, `vendor/video-use` | clip + words + topic → `_broll.mp4` | Anthropic (direct), Pexels, Wikimedia, ONNX from GitHub | works; ~40 s render per 15 s clip; external repo pin; fail-closed people screening |
| SFX | `sfx.rs:50-130`, `sfx_mix.py`, `make_sfx.py` | clip → `_sfx.mp4` | ffmpeg | works; `--scenes` parsed but unused; `sfx_lib` licence unknown |
| Branded end card + cloned-voice outro | `outro.rs:62-128`, `outro.py`, `voice_pick.py`, `tts_clone.py` | clip + brand → `_final.mp4` | Pillow, numpy, Chatterbox in Python 3.11 venv, macOS `say` fallback | works on macOS; card colours/CTA hardcoded; not in batch by default |
| Post creative / thumbnail (4 layouts, best-frame pick) | `creative.rs`, `creative.py` | clip + brand → 1080×1350 PNG | OpenRouter copy, Pillow, cv2 | works; brand palette/fonts parameterised |
| Brand profiles CRUD | `db.rs:122-142,205-281`, `main.tsx:1329-1517` | — | — | works; `projects.brand_id` never used |
| Postiz publish (draft / now / schedule) | `postiz.rs`, `postiz_post.py` | mp4 + caption + channel ids → post | Postiz public API | works; schedule unexposed in UI; only `posted|draft` stored, no post id |
| Batch rendering, resume, concurrency, deadline | `lib.rs:1992-2514` (`#[ignore]` tests), `*.sh`, `progress.rs` | — | cargo test, caffeinate, pgrep, log file | works as a hack; not product code |
| Persistence | `db.rs` (SQLite; 6 tables + brands) | — | — | works; `clip_copy`, `schedule_entries` unused |
| Onboarding / settings / status lamps | `main.tsx` | — | — | Tauri-bound; keys in localStorage plaintext |

### Feature inventory — Promo-Video

| Step | Performed by | Headless today? | Where |
|---|---|---|---|
| Preflight, gather inputs | agent | trivially | `SKILL.md:45-80` |
| Watch reference (frames + transcript) | `watch` scripts | yes (library) | `vendor/watch/{download,frames,transcribe,whisper}.py` |
| Reference breakdown, product study, creative direction, storyboard | **agent reasoning** guided by `prompt/creative-director-prompt.md`, `docs/*.md` | **no** | `SKILL.md:82-155` |
| Scaffold + build film (edit `theme.ts`, scenes, `Film.tsx`) | **agent writes code** | **no**; template has zero `inputProps` | `template/src/**` |
| Audio (SFX mix over pad) | `build_audio.py` | yes; cue list is Python source | `template/scripts/build_audio.py:62-94` |
| Render 4 compositions | Remotion CLI | yes; ≈ 5–8 min local, 40–80 min CPU-only Linux | `template/package.json:19-27` |
| App Store ≤30 s / 30 fps cut | ffmpeg recipe in docs | yes; `SEG` hand-tuned | `docs/appstore-cut.md` |

### Dependency inventory

| Runtime | Version proven | Needed by |
|---|---|---|
| Node ≥ 18 (26 here) | Remotion 4.0.481 (template) / 4.0.526 (latest) | promo render, worker, web |
| Python ≥ 3.12 (3.14 here) | opencv-headless 5.0, numpy 2.5, pillow 12.3, whisper, demucs/torch 2.13, yt-dlp | sidecars, watch library |
| Python 3.11 | chatterbox-tts 0.1.7, torch 2.6 | voice clone only |
| ffmpeg/ffprobe | 8.1.2 (no drawtext) | everything |
| yt-dlp | 2026.07.04 | source download, reference download |
| PostgreSQL | 16 running | new DB + queue |
| Chromium headless shell | downloaded by Remotion | promo render |

### Integration map (today)

```
YouTube ──yt-dlp──▶ mp4 ──clean_source.py──▶ mp4 ──ffmpeg──▶ wav ──Deepgram|whisper──▶ transcript
transcript ──LLM (7 providers)──▶ candidates ──facetrack.py + captions.py + ffmpeg──▶ clip_flat.mp4
clip ──broll_pipeline.py (Anthropic, Pexels, b-rolls, video-use)──▶ _broll ──title_bar.py (Anthropic)──▶ _titled ──sfx_mix.py──▶ _sfx ──outro.py (+Chatterbox)──▶ _final
clip ──creative.py (+OpenRouter copy)──▶ post.png
_final/_sfx ──postiz_post.py──▶ Postiz ──▶ X / IG / FB / LinkedIn / YouTube / TikTok

reference URL ──watch (yt-dlp+ffmpeg)──▶ frames ──[agent]──▶ CREATIVE_DIRECTION.md ──[agent edits TSX]──▶ Remotion ──▶ 9:16 / 16:9 / 886×1920 / 1920×886 mp4
```

### Fragile areas

- Interactive commands have no progress events; batch progress scrapes a log file with `pgrep` (`progress.rs`).
- SQLite single `Mutex<Connection>`; `replace_candidates` deletes+inserts without a transaction; batch processes open the same file (`db.rs:404-456`, `lib.rs:2050-2054`).
- No timeouts on DeepSeek/Gemini/OpenAI/Groq/Anthropic/Ollama/Deepgram calls or any Rust `Command::output()`.
- `std::env::set_var("OPENROUTER_API_KEY")` from a request parameter (`lib.rs:495`); Gemini key in URL (`llm.rs:135`); vendor error bodies returned unredacted except OpenRouter.
- `PhoneFrame` renders a "missing screen" tile instead of failing (`PhoneFrame.tsx:49-72`).
- `T ↔ DURATION ↔ FX` sync unchecked in the promo template; 60 fps-coupled constants.
- yt-dlp from datacentre IPs (bot checks) — no cookies/proxy support anywhere.
- Runtime downloads of ONNX models and HF weights inside jobs (`broll_pipeline.py:306-333`, `blur_women.py:47-76`, `tts_clone.py:44`).
- macOS-only calls: `say`, `caffeinate`, `pgrep`, `open -a`, `brew`, Swift OCR; macOS font paths listed first everywhere.

### Unfinished areas

- `clip_copy` (per-platform copy) has a reader and no writer; `schedule_entries` never used; `projects.brand_id`, `clips.face_track_json`, `creative_path/creative_headline` written but never read.
- Postiz scheduling (`--when`) exists in the sidecar but the UI always sends `scheduleAt: null`; no Postiz post id is stored.
- `Task::Image`/`generate_image` and `Task::Utility` in `openrouter.rs` unused; `blur_women.py` orphaned; `sfx_mix.py --scenes` unused; `conform_frame_count` never called.
- No preview player, no manual candidate editing, 36 caption presets not exposed in UI.
- Promo: no fixtures, no eval set, no schema for storyboards.

## What I Would Reuse

**Verbatim (vendored under `vendor/`):**
- All 14 Python sidecars + `caption_styles.json` + YuNet model (`vendor/autoshorts-py/assets`). Same argv/stdin/stdout contracts, invoked by the Node worker exactly as `*.rs` invoke them today.
- `watch` library modules (`download.py`, `frames.py`, `transcribe.py`, `whisper.py`, `config.py`) — called via a thin JSON entry point.
- b-rolls skill scripts + pinned video-use.
- Promo template animations (`springs.ts`, `easings.ts`, `motion.ts`), fonts (OFL), `make_placeholders.py`, `build_audio.py` mixing engine, the creative-director prompt text, `docs/motion-language.md`, `example-breakdown.md`, `scene-kit.md` as prompt context.
- Prompts: candidate-detection prompt (`llm.rs:40-51`), OpenRouter editorial prompt (`openrouter.rs:548-587`), title prompt (`title.rs:76-90`), creative copy prompt (`creative.rs:314-350`), B-roll plan prompt (`broll_pipeline.py:63-94`) — copied as strings, then extended with product-profile context.
- Data semantics: `NormalizedTranscript`, `CandidateDraft`, `BrandProfile`, `Clip` statuses, Postiz provider-settings table (`postiz_post.py:230-261`), 45 MB re-encode ladder.

**Ported 1:1 with original test vectors (ADAPT):** `extract_json_span`, `parse_candidate_json`, `fit_to_min_duration`, `suppress_overlaps`, `compact_segments`; `parse_video_id`/`canonical_url`/`classify`; `chunk_words`; `build_render_command`; `normalize_deepgram`/`normalize_whisper_raw_json`/`build_segments`; OpenRouter `redact`/`is_retryable`/`backoff_secs`; `fallback_title`; `parse_copy`.

## What Must Change

| Component | Class | Change |
|---|---|---|
| `lib.rs` commands, batch tests, `progress.rs`, shell scripts | REWRITE | become queue jobs with DB-backed state, progress events, resumability by state not filenames |
| `db.rs` SQLite | REWRITE | Postgres schema (Gate 3); transactions; drop dead tables; store Postiz post/media ids |
| `postiz.rs` + `postiz_post.py` | REWRITE (TS) | streaming upload, scheduling, status polling, per-platform results; keep provider-settings table |
| `pyenv.rs`, asset materialisation | REWRITE | pinned `PYTHON_BIN`; sidecars run from `vendor/` |
| LLM prompts | ADAPT | inject product name, description, features, audience, category; provider-agnostic |
| `captions.py` legacy 7 styles | ADAPT | express as JSON presets; override `textColor/highlightColor/strokeColor/backgroundColor` from brand palette |
| `title_bar.py`, `outro.py`, `creative.py` fonts/colours | ADAPT | brand colours/CTA/fonts from profile; Linux font bundle; drop `say`, drop `eval` |
| `broll_pipeline.py` | ADAPT | configurable skill/cache dirs; pre-baked models; planning call through the provider layer |
| `sfx_mix.py` | ADAPT | remove `~/autoshorts/sfx_lib` hardcode; kits only from `--kit` |
| `tts_clone.py` | WRAP | isolated Python 3.11 env, optional step |
| Promo `Root.tsx`/`Film.tsx`/`theme.ts`/scenes/components | ADAPT → prop-driven kit | zod schema + `calculateMetadata`; scenes accept copy/screens/colours; legacy colour literals → theme |
| Promo agent steps 2–4, 6 | REWRITE as LLM jobs | schema-validated JSON; validation rules from `SKILL.md` Step 4 |
| `build_audio.py` | ADAPT | `--fx cues.json`, duration from storyboard |
| `main.tsx` | REWRITE | Next.js app; reuse provider registry shape, brand form fields, channel picker UX |

Every rewrite above is justified by one of: Tauri/desktop coupling, a second language runtime for glue code, missing scheduling/state, or a hard requirement (product-profile injection, brand colours) that the original never had. Equivalence for ported algorithms is tested by porting the Rust `#[test]` vectors to vitest.

## Implementation Impact

- The unified product is a **Node/TypeScript monorepo** with a web app, a worker, and shared packages, plus a Python environment for the sidecars. No Rust.
- The **product profile** must flow into: ranking prompt, title prompt, copy prompt, B-roll topic, caption/title/end-card colours, creative brand spec, promo theme + storyboard. Today none of those take product context, so every prompt gets an explicit "product context" block and every renderer gets palette inputs.
- The **content library** replaces the file-name conventions (`_flat`, `_broll_titled_sfx`, `_final`) with asset rows whose `derived_from` chain is explicit.
- **Publishing** needs a real Postiz client with stored post ids and status polling; scheduling is new behaviour the desktop app never exposed.
- **Promo** is the largest new engineering: three LLM steps with schemas plus the kit refactor. It ships in its own phase after shorts + publishing are usable.
- **Heavy optional steps** (Demucs clean, B-roll, voice clone) become opt-in job stages with their own resource limits, because each is minutes-to-tens-of-minutes and GB-scale in dependencies.

## Open Questions

Only items that change product behaviour, cost, or compliance:

1. **Content policy defaults.** The current pipeline defaults to `BROLL_PEOPLE_POLICY=no-women` and a female-voice preference for the outro, and ships an unused `blur_women.py`. I am implementing these as explicit per-product "content preferences" (people policy: `off | no-people | no-women`; voice preference) asked once at intake, with the intake form requiring an answer rather than assuming one. Is that acceptable, or do you want the existing `no-women` default carried over silently for your own products?
2. **Sound-effect packs.** `sfx_lib/` (17 WAVs) and the promo template's 24 mp3s have unverified provenance. I will ship only the synthesised `make_sfx.py` kit by default and keep the others behind a `SFX_EXTRA_KIT_DIR` env var. Do you have licence records for either pack?
3. **Remotion company licence.** Required for commercial use of rendered output by a company above Remotion's threshold. Confirm whether Distribution is a company product so the licence can be obtained before public launch. Does not block development.
4. **Transcription provider.** No Deepgram key exists; local Whisper `base` runs at ≈ 0.8× realtime on this Mac (a 1 h source ≈ 50 min). The worker will support Deepgram, Groq/OpenAI Whisper API, and local Whisper. Which do you want as the default for your own runs? (Cost: Deepgram ≈ $0.26/h; Groq whisper-large-v3 ≈ $0.11/h; local = time.)
