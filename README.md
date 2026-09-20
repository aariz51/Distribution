# Distribution

**One product profile in. A launch film, short clips, thumbnails, per-platform copy and a publishing schedule out.**

Live: **https://distribution-app.vercel.app** · Source: **https://github.com/aariz51/Distribution**

---

## The problem

A founder shipping a product has two separate content jobs. Making a launch film is one workflow with its own intake. Cutting short clips out of a podcast or interview is a different workflow with a different intake. Neither is connected to a posting schedule, so the same facts get retyped three times and the output still has to be moved by hand.

Distribution collapses that into one profile and one library.

## What it does

Describe the product once: name, one-line description, features in priority order, audience, logo, screenshots. If you do not know your brand colours, they are sampled from your own assets and marked as inferred until you confirm them. Everything downstream reads that profile.

| Output | What arrives |
|---|---|
| **Launch film** | Four cuts from one storyboard: 1080×1920, 1920×1080, and both App Store preview sizes trimmed to Apple's ≤30s / 30fps rule |
| **Short clips** | Long-form video cut into vertical clips, cropped to follow the speaker, captioned in your brand colours, with a title banner |
| **Thumbnails** | The cleanest frame of each clip, composed with your logo, palette and a headline drawn from what was actually said |
| **Platform copy** | Hook, title, caption, hashtags and CTA written per platform against that platform's real character limits |
| **Schedule** | Approved work lands on a calendar and publishes through Postiz, with per-platform status and retries |

Nothing publishes itself. Every asset arrives in `review` and waits for a yes.

## Verified, not claimed

Both pipelines were run end to end on a real product ([SafeChoice](https://apps.apple.com/app/id6748953724), a product-label scanner) with its real logo and app screens:

- **Shorts:** a 203-second source became 8 vertical clips (1080×1920, 30–59s each) with face-tracked crops, brand-coloured captions, title banners, 8 thumbnails and 40 copy rows across 5 platforms.
- **Promo:** 4 renders plus 2 App Store cuts, a poster frame per deliverable, `CREATIVE_DIRECTION.md` and `storyboard.json` — **134 seconds, zero API calls.**
- **Tests:** 168 across 6 packages. Lint and typecheck clean.

## How it is built

```
apps/web       Next.js 16 — intake wizard, content library, sources, jobs, publishing
apps/worker    pg-boss consumers: ffmpeg, Python sidecars, Remotion
packages/
  core         product profile + asset schemas, asset state machine, redacting logger
  db           21-table Postgres schema (Drizzle)
  jobs         job registry, singleton-key idempotency, retries, progress events
  media        ffmpeg/yt-dlp wrappers + algorithms ported from the Rust original
  providers    OpenRouter · DeepSeek · OpenAI · Groq · Gemini · Anthropic · Ollama, with fallback
  pipelines    the shorts graph, the promo director, copy generation, publishing
  promo-kit    prop-driven Remotion kit — 12 scene kinds driven by a storyboard JSON
  publishing   Postiz client
vendor/        the original pipelines, vendored verbatim with provenance
```

### Two decisions worth knowing

**The working pipelines were preserved, not rewritten.** The clip pipeline came from a Tauri desktop app in Rust with Python sidecars. The Python sidecars are vendored and called with their original argv contracts. The substantive Rust algorithms — candidate JSON repair, overlap suppression, the caption chunker, the ffmpeg render-command builder, YouTube URL validation — were ported to TypeScript with **every one of their original unit tests ported alongside**, so equivalence is enforced rather than assumed.

**The promo director does not need a model.** The original skill required an agent to watch a reference video and hand-write scene code. Here, the structure and every line of copy are derived from the product profile by rule: four named act structures chosen from the product's category, asset count and pain points. It is deterministic, testable, free to run, and it cannot invent a claim about your product. The reference-analysis path that uses an LLM is opt-in and is not registered by default.

---

## Built with Claude Fable 5.1

This project was designed and built end to end with **Claude Fable 5.1** in Claude Code.

Fable 5.1 did the work that actually mattered here, not just the typing:

- **Read two unfamiliar production codebases in full** — 9,173 lines of Rust across 20 files, 14 Python sidecars, a 2,944-line React frontend — and produced a file-level inventory with `path:line` references, separating what to reuse verbatim from what had to be rewritten and why.
- **Made the architectural call** to drop the Rust runtime after measuring that the substantive logic was ~600 tested lines, then ported those lines with their test vectors intact.
- **Caught its own bugs by looking at rendered output.** A cursor covering a button label, a poster frame landing on a sparse beat, a duplicated App Store cut from two racing jobs, and an ungrammatical line of generated copy were all found by rendering frames and reading them, then fixed.
- **Ran multiple agents in parallel** across separate lanes of the monorepo and coordinated the boundaries between them.

Model: `claude-fable-5-1` · Harness: [Claude Code](https://claude.com/claude-code)

---

## Running it

Needs PostgreSQL 16, Node 22+, ffmpeg, yt-dlp and a Python environment for the sidecars.

```bash
pnpm install
createdb distribution
pnpm --filter @distribution/db migrate
cp .env.example .env          # fill in what you have; every provider is optional
pnpm --filter @distribution/web dev     # http://localhost:3000
pnpm --filter @distribution/worker start
```

Generate a promo with no API key at all:

```bash
pnpm exec tsx scripts/run-promo.ts <productId> 24
```

## Licence and provenance

The vendored pipelines keep their original licences; see [`vendor/README.md`](vendor/README.md) for the source, revision and licence of each. Remotion requires a company licence for commercial use above its threshold. The promo template's bundled sound effects have unverified provenance and are replaced by a locally synthesised kit by default.
