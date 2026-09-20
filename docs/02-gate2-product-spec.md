# Gate 2 — Product Spec

Builds on [Gate 1](01-gate1-inventory.md). Everything below is written against what the two source systems actually do today, not against the brief's summary.

## Decision / Recommendation

1. **One Product Profile, collected once in a five-step intake, is the root of everything.** Every generator (ranking, hooks, titles, captions, end cards, thumbnails, copy, promo theme and storyboard) reads from it. No downstream screen asks for product facts again; it may only ask for *choices* (pick a reference, approve a clip, pick a slot).
2. **Automatic third-party sourcing is not the default.** The recommendation is **Option C + D**: connect sources the founder owns or has rights to (own YouTube channel, podcast RSS, uploads), let the system watch those automatically, and put any *discovered* third-party candidate (Option A, YouTube Data API) into an approval queue that requires an explicit rights attestation before a byte is downloaded. yt-dlp keyword search (Option B) is not used for discovery. Reasoning in §6.
3. **Promo fallback is a curated, scored reference library** seeded from the ~15 reference films already used in prior `CREATIVE_DIRECTION.md` runs on this machine, with each reference's analysis cached so it is paid for once. The system proposes the top three for the product; the founder confirms one (this is a STOP gate: visual direction is Aariz's call).
4. **The content library is the single state machine** for every asset, with nine statuses and an explicit derivation chain, replacing today's file-name suffix conventions.

## Findings

### 1. Journeys

#### First run (founder, ~10 minutes of input, then hours of background work)

1. Sign in (single-tenant password in phase 1).
2. **Intake step 1 — Product**: name, one-liner, long description (optional), category (picklist + free text), features in priority order (drag to reorder), competitors, target audience, target platforms. Optional "read it from my store listing / website URL" prefill via an LLM extraction job (mirrors `SKILL.md:74-77` codebase-mining). Everything prefilled is marked *inferred* until confirmed.
3. **Intake step 2 — Brand**: logo upload, screenshot uploads (ordered; each can be tagged with the feature it evidences), brand colours (optional), fonts (optional), other assets. If colours are absent the palette job samples them (Pillow quantisation, the deterministic method recommended in the promo inventory) and shows swatches labelled *inferred from assets*; the founder can edit.
4. **Intake step 3 — Sources**: optional reference/inspiration video URL for the promo; optional long-form URLs or uploads for shorts; optional connected sources (own YouTube channel URL, podcast RSS). Each URL is probed immediately (`yt-dlp --dump-json`, ported `probe()`) to show title, duration, uploader, licence, and a **rights classification** (owned / licensed-CC / third-party). Third-party requires an attestation checkbox with the text stored on the source row.
5. **Intake step 4 — Publishing**: Postiz API key (stored server-side, never sent to the browser again), channel selection from `GET /integrations`, cadence (posts per week per platform), preferred time windows, timezone, content preferences (caption preset, title style, B-roll on/off, outro on/off, voice preference, people policy — see Gate 1 Open Question 1).
6. **Intake step 5 — Review & generate**: a summary card of the profile; buttons "Generate promo", "Generate shorts", or both. Jobs are enqueued; the founder lands in the Library where progress rows appear immediately (`Downloading source → 12 %`, `Transcribing → 42 %`, `Finding moments → 68 %`, `Rendering clip 4/8 → 75 %`).
7. When the promo pipeline reaches the reference gate without a reference, it pauses at **status `review`** with three proposed references; the founder picks one and the job resumes.
8. Finished assets land in `review`. The founder watches, approves or rejects (with reason), edits copy inline, and schedules.

#### Returning user (weekly, ~15 minutes)

1. Dashboard: what published, what failed (with reason and a retry button), what is waiting for review, next 7 days of the calendar, cost this month.
2. New source detected from a connected channel → approval queue card → one click "Process" (owned content) or the rights attestation for third-party.
3. Review queue: approve/reject clips and thumbnails; regenerate copy per platform; adjust caption preset for a single asset without touching the profile.
4. Schedule: drag assets onto the calendar or click "Auto-fill" which applies the cadence rules to approved assets.
5. Profile edits (new screenshot, new feature) are versioned; assets record the profile version they were generated with so a re-run is explainable.

#### Publish day (mostly unattended)

1. At `scheduled_for − lead_time` the publisher job uploads media to Postiz and creates the post as `type: "schedule"` with the platform-specific copy and settings; stores the Postiz post id per platform.
2. Status moves `scheduled → publishing → published` per platform as `GET /posts/{id}` reports; failures move to `failed` with the Postiz error text, and a retry policy (3 attempts with backoff, then dead-letter) applies to transient errors only. 4xx validation errors are not retried; they surface in the UI with the offending field.
3. A digest (in-app; email later) lists published items with links, failures with reasons, and tomorrow's queue.

### 2. Unified intake schema (the Product Profile)

Zod schemas live in `packages/core`. Field-level summary:

```
ProductProfile {
  id, slug, version, createdAt, updatedAt
  product: {
    name, tagline, description?, category: { primary, tags[] },
    features: [{ id, title, detail?, priority, evidenceScreenshotIds[] }],
    competitors: [{ name, url? }], audience: { summary, segments[], painPoints[] },
    platforms: ("ios"|"android"|"web"|"desktop")[], urls: { website?, appStore?, playStore? }
  }
  brand: {
    logoAssetId, screenshotAssetIds[], otherAssetIds[],
    palette: { ink, accent, canvas, ground, extra[]; source: "provided"|"inferred"; inferredFrom? },
    typography: { display?, body?, heavy?; source },
    cta: string
  }
  sources: {
    promoReference?: { url, rights: RightsClass, attestation? } | { referenceLibraryId }
    longForm: [{ sourceId }]        // rows in source_videos
    connected: [{ kind: "youtube_channel"|"podcast_rss"|"upload_folder", url, rights: "owned" }]
  }
  publishing: {
    postizConnectionId, channelIds[], timezone,
    cadence: [{ channelId, perWeek, windows: [{ dow, startHHMM, endHHMM }] }],
    leadTimeMinutes
  }
  contentPreferences: {
    captionPresetId, captionUseBrandColors: bool, titleBanner: bool, broll: bool, sfx: bool,
    outro: bool, voice: "clone"|"none", peoplePolicy: "off"|"no-people"|"no-women",
    cleanSource: bool, clipLengthSec: { min, max }, clipsPerSource: number,
    copyTone: string, hashtagStrategy: "none"|"few"|"many", languages[]
  }
}
RightsClass = "owned" | "licensed" | "third_party_attested" | "unknown"
```

Rules: `peoplePolicy`, `voice` and rights fields have **no default**; the form requires an answer. Inferred values carry `source: "inferred"` until the founder confirms. Profile edits bump `version`; assets reference `profileVersion`.

### 3. Promo fallback: the reference library

When `sources.promoReference` is absent:

| Field on `reference_videos` | Purpose |
|---|---|
| `url`, `title`, `durationSec`, `platformOfOrigin` | identity |
| `categoryTags[]` (e.g. fintech, health, productivity, education, devtools, marketplace, consumer-social) | match `product.category` |
| `productType` (mobile-app, saas-web, hardware, game, agency) | match `platforms` |
| `style` (minimal, editorial, kinetic-type, cinematic, playful, ui-fragment) | taste vector |
| `pacingBeatsPerSec`, `beatCount` | match desired duration and energy |
| `visualLanguage[]` (light-ground, dark-ground, inversion, device-frames, split-screen, typewriter, mono-system-voice, extreme-crop) | maps to kit components |
| `groundPreference` (light/dark/mixed) | compatibility with brand palette luminance |
| `curatorScore` 1–5, `notes` | human quality signal |
| `analysis` JSON (cached `ReferenceAnalysis`), `analyzedAt`, `frameSetStorageKey` | analysed once, reused; cost control |
| `usageCount`, `lastUsedForProductId` | avoid producing near-identical films for the same founder twice |

Selection: `score = 3·categoryMatch + 2·productTypeMatch + 2·groundCompatibility(palette) + 1·durationFit + 1·curatorScore/5 − 2·recentlyUsedForThisProduct`. Top three are shown with a poster frame and the two-line "signature devices" summary from the cached analysis. The founder picks; the pick and the alternatives are recorded on the promo job. There is no random default. Seed data: the reference URLs in the fifteen existing `CREATIVE_DIRECTION.md` files on this machine (harvested in Phase 4), plus their already-written breakdowns as the first cached analyses.

### 4. Short-form source behaviour

- Provided URL or upload → probe → rights classification → (attestation if third-party) → `source_videos.status = queued` → shorts pipeline.
- Connected owned source → a poller (daily by default) lists new items (`yt-dlp --flat-playlist` for a channel, RSS for podcasts) and creates `source_videos` rows in `discovered` status; owned sources auto-advance to `queued` if the profile says so, otherwise wait for one click.
- Discovered third-party candidates (Option A) → `discovered` with `rights: unknown` → never downloaded until attested.

### 5. Rights / approval flow

| Rights class | How set | What the system does |
|---|---|---|
| `owned` | connected source, or upload with "I made this" | process automatically |
| `licensed` | yt-dlp licence string contains "Creative Commons" (the existing `reuse_allowed` check, `youtube.rs:309-315`) | process; attribution line auto-added to copy |
| `third_party_attested` | founder ticks "I have permission from the rights holder" and optionally uploads/links proof | process; attestation text, user, time stored on the source row |
| `unknown` | anything else | blocked; UI explains why |

Every asset inherits the rights class of its source and displays it. Published copy for `licensed` sources includes the attribution.

### 6. The automatic-sourcing question

| Option | Feasibility | Reliability | Limits / cost | Legal & policy | Effort | UX |
|---|---|---|---|---|---|---|
| **A. YouTube Data API v3 search** | High. `search.list` by product/competitor/founder/channel terms. | High (official) | 10,000 units/day per project; `search.list` = 100 units → ~100 searches/day; `videos.list` = 1 unit. Free; quota increases on request. | Search + metadata is fine. **Downloading** the found videos is still governed by YouTube ToS (no downloading except via provided features) and by copyright. | Low (1–2 days) | Good for a weekly "candidates found" card |
| **B. yt-dlp search (`ytsearchN:`)** | Works today | Fragile: scraping, bot checks from datacentre IPs, breaks with site changes | No quota but no SLA | Same download concerns; scraping search adds a ToS violation for discovery itself | Low | Same as A but unreliable |
| **C. Connected creator/channel sources** | High (`--flat-playlist`, RSS) | High | none material | **Clean**: the founder owns or licenses the content | Low–medium | Best long-term: content keeps flowing without prompts |
| **D. Manual approval queue** | High | High | none | Puts the rights decision on the human, recorded | Low | Adds one click per source |

Legal and compliance summary (not legal advice; confirm with counsel before scaling):
- Clipping third-party footage for a company's own promotion is commercial, derivative use. Fair use / fair dealing defences are narrow and unreliable for promotional content; the safe posture is permission or a licence.
- YouTube's Terms prohibit downloading content except where YouTube provides a download button or has permission from the rights holder. Creative-Commons-licensed videos still require attribution (CC BY).
- TikTok, Instagram and YouTube Shorts down-rank or reject re-uploaded third-party content, so the distribution value of unlicensed clips is also poor.
- The existing AutoShorts already gates YouTube imports on a CC licence unless the user acknowledges (`lib.rs:1300-1309`). The new product keeps that gate and makes the acknowledgement an auditable attestation.

**Recommendation:** default to **C + D**. Offer **A** as an opt-in "Discover candidates" feature that fills the approval queue with metadata only (title, channel, duration, licence, view count, a link) and never downloads without attestation. Do not build **B**. This is the most reliable, the cheapest (zero API cost for C/D, negligible for A), the least engineering, and the only compliant default. For the founder's own launch the highest-value sources are their own podcast appearances and channel, which C covers.

### 7. Content library behaviour

Every asset row carries: `productId`, `projectId` (a generation run), `type` (promo_vertical, promo_landscape, promo_store_portrait, promo_store_landscape, clip, clip_enriched, thumbnail, creative_image, caption_track, transcript, storyboard, creative_direction_md, audio_master), `sourceId?`, `derivedFromAssetId?`, `storageKey`, `mimeType`, `width/height`, `durationSec`, `thumbnailAssetId`, `status`, `approvalState` (pending, approved, rejected + reason), `profileVersion`, `jobId`, `platforms[]`, `scheduledFor`, `publishedAt`, `publishResult` JSON per platform, `failureReason`, `metadata` JSON (hook, score, rank, transcript window, caption preset, palette used).

Statuses and transitions:

```
draft ──▶ processing ──▶ review ──▶ approved ──▶ scheduled ──▶ publishing ──▶ published
             │              │           │                          │
             └─▶ failed ◀───┘           └──────── archived ◀───────┴─(failed → retry → publishing)
```

`archived` is terminal and is also used for rejected assets (with `approvalState = rejected`). Library views: filter by product, type, status, platform, date; grid with thumbnails and a player; detail drawer with derivation chain (source → clip → enriched → thumbnail), job timeline, logs, cost.

### 8. Approval workflow

- Assets enter `review` when their job completes; enrichment (B-roll, outro) creates a *new* asset derived from the approved one, so approval is per rendered file.
- Approve → `approved`; reject → `archived` with reason. Bulk approve/reject supported.
- Copy per platform is generated on demand or when entering `review` (profile setting); each copy version is stored and editable; approval of the asset does not lock copy.
- A profile change never mutates existing assets; "Regenerate with current profile" creates new ones.

### 9. Scheduling workflow

- **Manual**: pick asset → pick channels → pick datetime (in profile timezone) → `scheduled`.
- **Auto-fill**: applies `cadence` windows to `approved` assets in priority order (promo cuts first around a launch date, then clips by score), avoiding two posts on one channel within `minGapHours`, and never scheduling the same source clip on the same channel twice.
- `leadTimeMinutes` before the slot, the publisher job runs (§ Publish day). Rescheduling before that point is a row update; after Postiz creation it is a `DELETE /posts/{id}` + re-create.
- Per-platform status is independent: one asset scheduled to X and LinkedIn has two `publish_schedule` rows.

## What I Would Reuse

- The CC-licence gate and `acknowledgedLicense` semantics from `youtube.rs` / `lib.rs:1300-1309` → rights classes.
- `BrandProfile` fields (name, tagline, urls, logo, screenshot dir, 4 colours, 3 fonts, CTA) from `creative.rs:37-95` → `brand` section.
- Caption preset ids from `caption_styles.json` → `contentPreferences.captionPresetId`.
- Postiz provider defaults table (`postiz_post.py:230-261`) → per-platform settings on schedule rows.
- The intake ordering from `SKILL.md:57-80` (reference, name, description, features, assets) extended with brand, sources, publishing.

## What Must Change

- Product context is new input for every prompt and renderer (Gate 1 "Implementation Impact").
- Scheduling, rights attestation, discovery queue, approval states, per-platform status, copy versions: none exist today.
- The frontend is a new Next.js app; the desktop UI is a reference for feature parity only.

## Implementation Impact

Phase ordering follows value: profile + library + queue first (usable as an asset manager), shorts second (real clips), publishing third (the distribution promise), promo fourth (largest new build), enrichment/discovery fifth.

## Open Questions

1. **Discovery (Option A)**: build it in the first release, or defer until C + D are proven with your own channel? My default is to defer to Phase 5.
2. **Cadence defaults**: do you want a suggested default cadence (e.g. 3 shorts/week per channel, promo cuts on launch day ±1) or should the form require explicit numbers?
3. **Multi-product**: the schema supports many products per account. Is the first release single-founder/multi-product (my assumption) or should it be multi-user from day one? Multi-user adds auth/tenancy work to Phase 1.
