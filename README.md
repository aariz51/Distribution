# Distribution

**One product profile in. A launch film, a stream of short clips, thumbnails, per-platform copy and a publishing schedule out.**

Making a promo video and cutting short-form clips are two separate jobs, with two separate intakes, and nothing ties either of them to a posting schedule. Distribution makes them one job: a founder describes their product once, and every generator downstream reads that same profile.

The application requires a persistent Node worker, Postgres and shared durable media storage. A marketing-site deployment does not provide those services.

---

## What it does

| Output | What arrives | How |
|---|---|---|
| **Launch film** | 4 cuts — 9:16, 16:9, and both App Store preview sizes trimmed to Apple's 30-second rule | Remotion, 60fps, rendered locally |
| **Short clips** | Vertical clips cut from long-form video, cropped to follow the speaker, captioned in your brand colours | ffmpeg + a YuNet face tracker |
| **Thumbnails** | The cleanest frame of each clip, composed with your logo, palette and a headline from what was actually said | Pillow, 1080x1350 |
| **Platform copy** | Hook, title, caption, hashtags and CTA per platform, against that platform's real character limits | Provider-agnostic LLM layer |
| **A schedule** | Approved work on a calendar, published through Postiz with per-platform status and retries | Postiz public API |

Nothing publishes itself. Every asset lands in `review` and waits for a yes.

---

## Validation status

The ongoing [production video audit](docs/production-video-audit-2026-09-21.md) records observed failures, fixes and test evidence. Local tests generated actual SafeChoice promos from its logo/screenshots, including four orientations and two store-preview cuts. Clipping tests used the nutrition documentary attached to SafeChoice; that source is not original SafeChoice product footage. Resulting promo and clip files passed full FFmpeg decoding.

Queue failure, cancellation, ownership, concurrent scheduling, atomic storage, retry identity and provider-budget regressions are covered by executable tests in `scripts/`. Tests using injected faults are labelled separately from real provider/media runs. Authenticated browser acceptance and deployment verification remain open; this is not a production-readiness signoff.

---

## Architecture

```
apps/web        Next.js 16 - landing page, intake wizard, library, calendar
apps/worker     pg-boss consumers: ffmpeg, Python sidecars, Remotion
packages/
  core          domain schemas, asset state machine, redacting logger
  db            Postgres schema, migrations and provider-budget reservations (Drizzle)
  jobs          job registry, retry policy, idempotent enqueue, progress events
  media         subprocess runner, ffmpeg builders, brand-palette k-means
  providers     LLM router (7 providers) + STT (Deepgram / Whisper API / local)
  pipelines     the shorts, promo, enrich and publish job graphs
  promo-kit     the prop-driven Remotion film kit
  publishing    Postiz client
vendor/         the two source systems, vendored with provenance
```

Heavy work never runs inside a request. Every stage reports progress, retries what is safe to retry, and records which step failed and why.

### Preserving what already worked

The clip pipeline and the film pipeline are not rewrites. The AutoShorts desktop app's tested Rust algorithms — candidate JSON repair, minimum-duration fitting, overlap suppression, YouTube URL validation, the caption chunker, the ffmpeg render-command builder — were ported to TypeScript **with their original test vectors**, 73 of them, one to one. The Python sidecars that do the real media work are vendored and called through their original contracts.

The promo skill's creative work used to live as instructions to a coding agent that hand-edited nine scene files. It is now a prop contract: a storyboard JSON drives twelve scene kinds, so a new film is a new document rather than new code.

---

## Running it

See [runtime requirements and deployment checks](docs/runtime.md) for the web/worker/storage contract.

```bash
createdb distribution
cp .env.example .env          # DATABASE_URL, APP_SECRET, APP_PASSWORD at minimum
pnpm install
pnpm --filter @distribution/db migrate
pnpm --filter @distribution/web dev       # http://localhost:3000
pnpm --filter @distribution/worker start  # second terminal
```

Needs Node 22.12 or newer, `ffmpeg`, `yt-dlp` and Python 3.12+ with `vendor/autoshorts-py/requirements.txt`. Provider keys are optional: the promo path and palette sampling run without any.

Produce a promo with no API key at all:

```bash
pnpm exec tsx scripts/run-promo.ts <productId> 24
```

---

## Testing

```
pnpm test
pnpm lint
pnpm typecheck
pnpm --filter @distribution/web build
```

The ported algorithms carry the original Rust test vectors. The promo director is tested for determinism, for filling its duration exactly, for never reproducing the template's running order, and for never referencing a screen that does not exist.

---

## Credits

Source systems: [promo-video-skill](https://github.com/aariz51/promo-video-skill) and a fork of [AutoShorts](https://github.com/JayWebtech/autoshorts). Rendering by [Remotion](https://remotion.dev) (commercial use may require a company licence). Fonts under SIL OFL. Full provenance in `vendor/README.md`.

Built by [Aariz Rasheed](https://github.com/aariz51).
