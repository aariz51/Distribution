# Distribution repository and local environment — inventory (2026-09-20)

## The GitHub repository `aariz51/Distribution`

Inspected with `gh repo view`, `gh api .../branches`, `.../git/trees`, `.../commits` before any local work.

| Property | Value |
|---|---|
| Visibility | private |
| Created / last push | 2026-09-20T07:33:44Z / 2026-09-20T07:33:45Z (creation only) |
| Default branch | none (repository is empty) |
| Branches | none |
| Commits | none (`409 Git Repository is empty`) |
| Files, docs, CI, framework, package manager, DB, deploy config | none |

Conclusion: there is nothing to preserve, reuse or replace. The repository imposes no framework, folder, or branching convention. The workspace defines them.

Local workspace created at `~/Distribution`: `git init -b main`, `origin` = `https://github.com/aariz51/Distribution.git`, `git ls-remote origin` succeeds (authenticated as `aariz51`). Git identity is the user's configured identity.

## Local toolchain (the machine the first worker will run on)

| Tool | Present | Notes |
|---|---|---|
| Node | v26.3.0 | Remotion needs >= 18 |
| pnpm | 10.33.0 | chosen package manager |
| Python | 3.14.7 (Homebrew) | externally managed; sidecar venv at `~/autoshorts/.venv` |
| Python 3.11 | `~/tts-venv` | Chatterbox voice clone only |
| ffmpeg / ffprobe | 8.1.2 Homebrew | **no `drawtext`, no libass**; captions are PNG overlays (already handled by `captions.py`) |
| yt-dlp | 2026.07.04 | also inside the venv |
| Rust | cargo 1.95.0 | only needed if the Rust engine is kept (it is not, see Gate 1 decision) |
| PostgreSQL | 16.13, running via brew services | databases: postgres, intelliforge, vadis_*, vms_* (unrelated) |
| Redis | not installed | rules out BullMQ without new infra |
| Docker | not installed | worker runs natively first; containerisation is a later phase |
| psql | present | |

## External services already reachable from this machine

| Service | State |
|---|---|
| Postiz cloud (`api.postiz.com/public/v1`) | key present in `~/autoshorts/.env`; `GET /integrations` returned 6 enabled channels on 2026-09-20 (Instagram ×2, Facebook, LinkedIn, X, YouTube) |
| OpenRouter | key in `~/.zshrc` as `OPENROUTER_KEY` and in autoshorts `.env` as `OPENROUTER_API_KEY` |
| OpenAI | `OPENAI_KEY` in `~/.zshrc`; `OPENAI_API_KEY` in `~/.config/watch/.env` (Whisper fallback for the watch skill) |
| Anthropic | OAuth token in autoshorts `.env` (subscription token, expires; console key rejected) |
| Pexels | `PEXELS_API_KEY` in autoshorts `.env` |
| Deepgram | no key on this machine; transcription has been running on local Whisper |

No secret values were read or copied. Names only.

## Representative test data available locally

- Long-form sources (AutoShorts): `~/Downloads/AutoShorts_eKQWFJmCWZE.mp4` (22 MB, 203 s), `AutoShorts_J_03EXyhYS8.mp4` (36 MB, 554 s), plus larger ones up to 1.8 GB.
- Live AutoShorts SQLite: `~/Library/Application Support/com.autoshorts.desktop/autoshorts.sqlite` — 14 projects, 186 candidates/clips, 5 clips with `postiz_state=posted`. Rendered clip files under `~/Documents/AutoShorts/*/clips/` have been deleted; only `.srt` and `transcription_audio.wav` remain under the app data dir.
- Real promo runs with `CREATIVE_DIRECTION.md` + rendered MP4s: `~/civia-promo` (assets in `~/civia-promo-assets`: 5 screens + logo), `~/halal-scanner-film-a51` (12 assets), plus a dozen others under `~/*/promo*`.

## Dependencies outside both repos that the pipelines rely on

| Dependency | Location | Licence | Container-portable? |
|---|---|---|---|
| `watch` skill (bradautomates/claude-video) | `~/.claude/skills/watch`, `~/.agents/skills/watch` | MIT | yes: Python scripts around yt-dlp + ffmpeg + Whisper API |
| `b-rolls` skill (aariz51/b-rolls) | `~/b-rolls-ref` | Aariz's own repo | mostly; the OCR step shells out to `swift` and is skipped off macOS |
| `video-use` (browser-use) pinned `92c2b34e` | `~/.cache/b-rolls/video-use-92c2b34e44c2` | see LICENSE in that dir | Python: requests, librosa, matplotlib, pillow, numpy |
| YuNet face model | vendored `vendor/autoshorts-py/assets/face_detection_yunet_2023mar.onnx` | Apache-2.0 (OpenCV Zoo) | yes |
| GoogleNet gender + YOLOX ONNX | `~/.cache/autoshorts/` (downloaded at runtime by `broll_pipeline.py`) | onnx/models, OpenCV Zoo | must be pre-baked |
| Whisper `base` weights | `~/.cache/whisper/base.pt` | MIT | yes |
| Chatterbox weights | HF hub on first run | see chatterbox-tts | GB-scale, optional |
| `sfx_lib/` 17 WAVs | `~/autoshorts/sfx_lib` (untracked) | **undocumented provenance** | do not ship by default; synthesised kit from `make_sfx.py` is safe |
