# GATE 1 Engineering Inventory — Promo-Video skill + `watch` dependency

Path abbreviations used below (all absolute):
- `REPO` = `/Users/aarizazizrasheed/Promo-Video-`
- `SK` = `REPO/skills/promo-video`
- `TPL` = `SK/template`
- `WATCH` = `/Users/aarizazizrasheed/.claude/skills/watch`
- `AGW` = `/Users/aarizazizrasheed/.agents/skills`

No files were modified. One 60-frame probe render was written to `/tmp` and deleted.

---

## 0. Install-location findings (symlink vs copy, drift)

| Location | Kind | State |
|---|---|---|
| `REPO` (git HEAD `0627dd0`, clean tree) | canonical | SKILL.md v2.0.0, keyless (`SK/SKILL.md:20,53`) |
| `AGW/promo-video` | **plain copy, not a symlink**, dated Jul 22 | **Stale v1.0.0** (`AGW/promo-video/SKILL.md:12`). Differs from repo in SKILL.md, theme.ts, all 9 scenes, PhoneFrame/ScoreRing/FontLoader, build_audio.py. Has `ScanButton.tsx` instead of `ActionButton.tsx`; lacks `docs/scene-kit.md`, `docs/voiceover.md`, `make_placeholders.py`, placeholder PNGs, logo. Its `build_audio.py` **requires `OPENROUTER_API_KEY`** and calls `https://openrouter.ai/api/v1/chat/completions` for `openai/gpt-audio` TTS (`AGW/promo-video/template/scripts/build_audio.py:19-20,40-44,201-202`). `T`/`dur` timings are identical to the repo (diff empty). If an agent resolves `promo-video` from `~/.agents/skills`, it gets the v1 key-dependent pipeline. |
| `AGW/remotion` | **symlink** → `/Users/aarizazizrasheed/ai-workflow-kit/wrappers/remotion` | Wrapper SKILL.md says promo-video "adds AI voiceover" (`wrappers/remotion/SKILL.md:12-15`) — stale relative to v2. Notes Remotion Lambda is configured (AWS `rashiq`, `ap-south-1`, creds in `remotion-render/.env`) (`:34-37`). The `~/remotion-render` directory does not exist on this machine. |
| `WATCH` (`~/.claude/skills/watch`) | plain copy, Sep 17 | v0.2.0; scripts byte-identical to `AGW/watch/scripts` (only `__pycache__` differs). |
| `AGW/watch` | plain copy, Aug 22 | SKILL.md differs from `WATCH/SKILL.md` only by a mechanical `Claude→Codex` string substitution (lines 4, 7-8, 23, 28, 205, 256) — including a broken URL `bradautomates/Codex-video`. |
| `~/.claude/skills/promo-video` | **does not exist** | `~/.claude/skills/` contains only agent-reach, flick, last30days, watch. `SK/SKILL.md:222` and `README.md:96` assume it is installed there. |

Local toolchain observed: Node v26.3.0, npx 11.16.0, Python 3.14.7, ffmpeg 8.1.2, yt-dlp 2026.07.04 (all Homebrew), numpy 2.5.3 and Pillow 12.3.0 present. `~/.config/watch/.env` exists (mode 0600) with `OPENAI_API_KEY` set, `GROQ_API_KEY` not set, `WATCH_DETAIL` and `SETUP_COMPLETE` set.

---

## 1. Pipeline step table (SKILL.md Step 0 → Step 9)

| Step (`SK/SKILL.md`) | What performs it today | Inputs | Outputs | Tooling | Headless without coding agent? | Needed to make it programmatic |
|---|---|---|---|---|---|---|
| **0 Preflight** (`:45-55`) | Agent runs shell checks; `watch/scripts/setup.py` exists but is a separate skill | — | go/no-go | node, npx, python3, ffmpeg, ffprobe, yt-dlp | **Yes** | Dockerfile with pinned binaries; skip `setup.py` (brew-only auto-install, `WATCH/scripts/setup.py:304-326`). |
| **1 Gather inputs** (`:57-80`) | Agent asks user (AskUserQuestion / prose); optionally reads codebase | reference URL, product name, description, features (priority), assets folder, orientations, duration | a "product profile" in agent context | — | **Yes (replace with a form/API payload)** | Define a `ProductProfile` JSON schema (name, description, features[], screenshots[], logo, brand colours?, targets[], duration). Codebase-mining (`:74-77`) becomes an optional LLM step. |
| **2 Watch & reverse-engineer** (`:82-108`) | **Agent reasoning.** `watch.py` produces frame JPEGs + a markdown report; the agent `Read`s 30–40 frames itself and writes section 1 (breakdown + signature devices) | reference URL/file | frames dir, transcript, prose breakdown | yt-dlp, ffmpeg, (Whisper API optional) | Frame extraction **yes**; the *breakdown* **no** — it is an LLM vision task | (a) Wrap `download.py`/`frames.py` as a library call returning JSON (see §9); (b) one vision LLM call: frames + transcript + `docs/example-breakdown.md` as exemplar + `docs/motion-language.md` vocabulary → **structured `ReferenceAnalysis` JSON** (acts, grounds, beat rate, transitions, camera, type, palette, `signature_devices[]`). Token cost ≈ 25–40k image tokens for 40 frames at 512px (`WATCH/SKILL.md:243`). |
| **3 Study the product** (`:110-121`) | **Agent reasoning.** Reads each screenshot + logo, samples brand colours "from the pixels", maps features→screens, writes sections 2–3 | screenshots, logo, profile | product analysis + creative direction prose | Read (vision) | **No** today | Vision LLM call → `ProductAnalysis` JSON (money_shot, feature→screen map, type personality). **Palette sampling should be deterministic** (Pillow k-means/quantize on the screenshots) rather than LLM-estimated. |
| **4 Derive scene list from reference** (`:123-155`) | **Agent reasoning**, guided by `prompt/creative-director-prompt.md` and `docs/scene-kit.md`; writes sections 4–5 and saves `CREATIVE_DIRECTION.md` | outputs of 2+3, duration | storyboard (purpose, duration, on-screen text, animations, camera, transition, SFX per scene) + production plan + self-check (`:147`) | — | **No** today | LLM call with `creative-director-prompt.md` (placeholders `:35,54,56`) + ReferenceAnalysis + ProductAnalysis → **`Storyboard` JSON** validated against a schema (scene kind, start/duration frames, copy, screens, colours, transitions, SFX cues) + the five markdown sections. The prompt currently ends with "THEN BUILD EVERYTHING" (`creative-director-prompt.md:96-100`) — must be split so the LLM emits data, not code. |
| **5 Scaffold** (`:157-165`) | Agent `cp -r template/` + `npm install` | template | project dir with node_modules | npm | **Yes** | Pre-bake the image with `npm ci` from the tracked `TPL/package-lock.json` and the Chromium download (`node_modules/.remotion/chrome-headless-shell`, 193 MB locally). |
| **6 Build the film** (`:167-182`) | **Agent writes code**: edits `theme.ts` (COLORS, screens, LOGO, T/dur), `fonts.ts`, copies assets, rewrites/deletes/adds `src/scenes/*.tsx`, rewires `Film.tsx` | storyboard, assets | a customised Remotion project | TypeScript | **No** today — nothing is prop-driven (see §2) | Either (a) LLM codegen of `theme.ts` + scene TSX + `Film.tsx` with a `tsc --noEmit` + `remotion still` validation loop, or (b) refactor to a fixed scene kit driven by `inputProps` + `calculateMetadata` and render the storyboard JSON directly. See §10 for trade-offs. |
| **7 Build audio** (`:184-194`) | Agent edits the `FX` Python literal, runs `python3 scripts/build_audio.py [--duration]`, sets `AUDIO_SRC` | storyboard SFX cues | `public/audio/master.wav` | python3 + ffmpeg/ffprobe | **Yes** (script) — but the cue list is Python source (`TPL/scripts/build_audio.py:62-94`) | Add `--fx cues.json --duration N` input so the storyboard's `sfx_cues[]` feed it without editing code. |
| **8 Verify, then render** (`:196-202`) | Agent renders stills (`npx remotion still <Comp> out/f.png --frame=N`), `Read`s them, fixes, then `npm run render:*` | project | 4 MP4s | Remotion CLI + Chromium | Rendering **yes**; the *visual QA* is an LLM vision judgement | Render via `@remotion/renderer` Node API (bundle once, `renderMedia` ×4). Optional QA loop: render N stills at beat starts → vision LLM checks collisions/overflow/contradictions → patch storyboard → re-render. |
| **9 App Store cut** (`:204-209`) | Agent adapts the Python/ffmpeg recipe in `docs/appstore-cut.md` | 60fps 886×1920 mp4 | ≤30s 30fps mp4 | ffmpeg | **Yes** | Turn the recipe into a script that derives `SEG` from storyboard cue gaps (currently hand-typed for the example film, `appstore-cut.md:30-31`). |

**Honest assessment.** Steps 2, 3, 4 and 6 are the entire creative value of the skill and today exist only as *instructions to a coding agent* — there is no schema, no fixture, no evaluator, no test. Steps 0, 5, 7, 8 (render) and 9 are small deterministic shells around ffmpeg/Remotion. Converting to a headless job means: three LLM calls (reference analysis, product analysis, storyboard) producing schema-validated JSON, then either code generation or a parameterised kit. The main risk is quality variance and silent failure (e.g. a missing screenshot renders as a "missing screen" placeholder rather than failing — `TPL/src/components/PhoneFrame.tsx:49-72`), not infrastructure.

---

## 2. Remotion template inventory

### Compositions — `TPL/src/Root.tsx`
| id | size | fps | duration | lines |
|---|---|---|---|---|
| `PromoVertical` | 1080×1920 (from `WIDTH`/`HEIGHT`) | `FPS`=60 | `DURATION`=1980 (33 s) | `:12-19` |
| `PromoLandscape` | 1920×1080 | 60 | 1980 | `:21-28` |
| `PromoStorePortrait` | 886×1920 | 60 | 1980 | `:30-37` |
| `PromoStoreLandscape` | 1920×886 | 60 | 1980 | `:39-46` |

All four render the same `Film` component. **No `defaultProps`, no `schema`, no `calculateMetadata`, no `inputProps` anywhere** — every value is a module constant.

### `TPL/src/theme.ts` contract
- `COLORS` (`:14-36`): `cream, creamDeep, blush, purple, purpleSoft, purpleDeep, pink, pinkSoft, gold, goldSoft, safe, safeSoft, caution, avoid, ink, inkSoft, white` (`as const`).
- `FPS=60` (`:39`), `WIDTH=1080` (`:40`), `HEIGHT=1920` (`:41`), `DURATION=1980` (`:42`, comment: keep in sync with `DUR` in build_audio.py).
- `SCREEN_W=1080`, `SCREEN_H=2340`, `SCREEN_RATIO≈0.4615` (`:45-47`).
- `screens` (`:54-62`): `dashboard→app-screens/01-home.png, detail→02-detail, search→03-search, library→04-library, profile→05-profile, settings→06-settings, result→07-result`.
- `LOGO="logo/app-logo.png"` (`:64`).
- `AUDIO_SRC: string|null = null` (`:70`) — ships null; `Film.tsx:54` renders `<Audio>` only if set.
- `T` (`:73-84`): `hook 0, oneTap 210, press 360, verdict 480, more 720, orbit 900, dashboard 1200, tagline 1500, logo 1680, end 1980`. `dur` derived (`:86-96`).
- `BG_RADIAL` (`:100`).
- Re-exports `FONT_HEAD`, `FONT_BODY` from fonts.ts (`:10-12`).

### `TPL/src/fonts.ts`
`FONT_HEAD='"Baloo 2", system-ui, …'` (`:4`), `FONT_BODY='InterVar, system-ui, …'` (`:6`), `FONT_FACE_CSS` with two `@font-face` rules pointing at `staticFile("fonts/Baloo2.ttf")` (weights 400–800) and `staticFile("fonts/Inter.ttf")` (100–900) (`:9-24`).

### `TPL/src/Film.tsx`
`AbsoluteFill` bg `COLORS.cream` (`:21`), `<FontLoader/>` (`:22`), nine `<Sequence from={T.x} durationInFrames={dur.x}>` hardwired to the nine scene components (`:23-49`), conditional `<Audio src={staticFile(AUDIO_SRC)}/>` (`:54`). No props.

### Scenes — `TPL/src/scenes/`
| Scene | What it shows | Theme/screens used | Orientation (`wide = width>height`) | Hardcoded copy / constants |
|---|---|---|---|---|
| `S1_Hook.tsx` | Floating "?" glyph + `KineticWords` value line; slow push-in 1.06→1.14 (`:15`); `Particles`(18) | `COLORS.purple`, `BG_RADIAL`, `FONT_HEAD`, `dur.hook` | sizes only (`:39,44,53-54`) | words `"Every day, the same question."` (`:56-60`); hardcoded `rgba(122,31,162,…)` glow (`:43`) |
| `S2_OneTap.tsx` | Two-line headline, `ActionButton`(300) bobbing, `Cursor` drifting in from bottom-right (`:29-36`), opening `Bloom` | `COLORS.ink/purple`, `dur.oneTap` | paddingTop/btnY/fontSize (`:19,43,48`) | `"One tap."` `"Zero doubt."` (`:62,73`) |
| `S3_Press.tsx` | Cursor presses button at `PRESS=22` (`:10`), shockwave ring (`:58-69`), dive scale 1→3.4 (`:34-38`), blow-out `Bloom` at end (`:76`) | `COLORS.purple`, `dur.press` | **no `wide` branch** — centre-based only (`:16-18`); fixed 900px shockwave (`:62-63`) | none (no text) |
| `S4_Verdict.tsx` | Eyebrow pill, product name, `ScoreRing` sweeping to 92 (`:74-83`), verdict pill, `Confetti`(110) at `REWARD` (`:12,111`), white recover from S3 (`:23,114`) | `COLORS.safe/ink`, `FONT_HEAD/BODY`, `dur.verdict` | ring size/stroke, font sizes (`:21,64,78,94,96`) | `"ANSWER READY"` (`:53`), `"Organic Oat Cereal"` (`:70`), score `92` (`:76`), `"ALL CLEAR"` (`:107`); hardcoded `rgba(47,181,106,…)` (`:45,80,98`) |
| `S5_MoreThanScan.tsx` | Title + three `GlassCard` feature chips with inline SVG icons; opening `Whoosh` (`:145`) | `COLORS.pink/purple/gold/ink`, `dur.more` | wide = fanned row of 320×380 cards (`:77-103`); portrait = stacked `width*0.82×200` rows (`:104-143`) | `FEATS` (`:32-36`), `Icon` SVGs (`:12-30`), title `"More than an answer."` (`:63-67`) |
| `S6_DeviceOrbit.tsx` | Six `PhoneFrame`s (width 230) orbit an ellipse, depth-sorted; headline on a cream halo | `screens.detail/search/library/profile/settings/result` (`:13-20`), `COLORS.purple/ink`, `dur.orbit` | rx/ry caps (`:34-35`), cy (`:32`), headline centre vs top (`:85-86,93-96`) | `"Everything built around you."` (`:117-119`); orbit speed `frame*0.0045` (`:36`); hardcoded glows (`:75`, `:99,114`) |
| `S7_Dashboard.tsx` | Hero `PhoneFrame(screens.dashboard)` rising from rotateX 20→3 (`:25`), `Cursor` taps at `TAP=96` (`:13,37-48`), `GlassCard` callout, opening `Bloom` | `screens.dashboard` (`:102`), `COLORS.pink/purple/ink`, `dur.dashboard` | wide: phone at 0.32W, headline at 0.72W (`:33,59`); portrait: centred, headline top (`:74-89`) | `"One calm place."` twice (`:71,87`), `"On track"/"this week"` (`:122-124`); heart SVG (`:118-120`) |
| `S8_Tagline.tsx` | Three period-rhythm words popping on a 16-frame beat (`:20`) | `COLORS.purple/pink/gold`, `dur.tagline` | row vs column (`:28-30`), sizes (`:41-42`) | `"Ask." "Know." "Move."` (`:15-19`) |
| `S9_Logo.tsx` | Logo tile with heartbeat pulse (`:10-15,49-51`), tagline, two `StoreBadge`s (`:17-40`), `Bloom` | `LOGO` via `staticFile` (`:94`), `COLORS.pinkSoft/inkSoft/ink`, no `dur` (no tailFade) | `LOGO_SIZE` 500/680 (`:55`), halo (`:72-74`) | `"Your one-line product tagline"` (`:111`), store badge copy (`:116-117`); hardcoded shadows (`:89`) |

**Parameterisation verdict:** every scene hardcodes its copy, feature list, score value, screens selection and several colours; timing enters only via `dur.<scene>` from `theme.ts`. Not one scene accepts props. The template **cannot be driven by `inputProps` today** without a refactor of `Root.tsx` (add `schema`/`defaultProps`/`calculateMetadata`), `Film.tsx` (map storyboard→Sequences), every scene (accept copy/screens/colours), and the components that embed legacy colours.

### Components — `TPL/src/components/`
| Component | Props (defaults) | Notes |
|---|---|---|
| `ActionButton` (`:6-10`) | `size=230, glowStrength=0.6, press=0` | Label `"SCAN"` hardcoded (`:55`); shadow `rgba(122,31,162,…)` hardcoded (`:19`) |
| `Bloom` (`:6-12`) | `frame, peak=8, rise=8, fall=14, color="#FFFFFF"` | returns null outside window (`:19`) |
| `Confetti` (`:8-13`) | `frame, start=0, count=80, life=130` | palette from `COLORS` (`:18`); deterministic via `seed` |
| `Cursor` (`:5-11`) | `x, y, scale=1, pressed=0, rotation=-8` | stroke `#2B2D42` (`:30`), ripple `rgba(122,31,162,…)` (`:47`) hardcoded |
| `FontLoader` (`:8`) | none | `delayRender` in `useState` (`:9`); **hardcodes font family names/weights** (`:14-19`) |
| `GlassCard` (`:6-22`) | `width, height, tint=COLORS.purple, radius=34, glow?, children, style` | one hardcoded `rgba(43,45,66,0.12)` (`:31`) |
| `KineticWords` (`:11-31`) | `words: {text,color?}[], fontSize=96, weight=700, startAt=0, stagger=6, lineHeight=1.1, gap=0.28, maxWidth="78%", letterSpacing=-1` | fully prop-driven; the best-shaped component in the kit |
| `Particles` (`:8-11`) | `count=22, opacity=1` | colours from `COLORS` (`:26`); `filter: blur(6px)` per dot (`:47`) — CPU-heavy |
| `PhoneFrame` (`:7-14`) | `src, width, glow?, radius?, bezel?, shadow=true` | height from `SCREEN_RATIO`; `onError` → labelled "missing screen" placeholder instead of failing (`:49-72`) |
| `ScoreRing` (`:8-28`) | `frame, score=92, size=300, stroke=22, color=COLORS.safe, trackColor, start=0, span=45, label?` | `"/100"` hardcoded (`:71`) |
| `Whoosh` (`:8-12`) | `frame, start=0, span=26` | gradient endpoints hardcoded (`:32`) |

### Animations — `TPL/src/animations/`
- `springs.ts`: `enter {damping 16, stiffness 140, mass 1}`, `pop {12, 220, 0.8}`, `settle {20, 110, 1.1}`, `bounce {9, 200, 0.9}` (`:8-17`); exported as `sEnter/sPop/sSettle/sBounce({frame, fps, delay})` → 0..1 (`:19-27`).
- `easings.ts`: `EASE.out bezier(0.22,1,0.36,1)`, `.inOut (0.45,0,0.55,1)`, `.in (0.5,0,0.75,0)`, `.soft (0.4,0,0.6,1)` (`:4-13`).
- `motion.ts`: `bob`, `sway`, `pulse`, `ramp`, `pushIn`, `tailFade`, `seed(i)` deterministic PRNG (`:7-54`). No `Math.random`/`Date` anywhere.

All frame-count constants (`T`, `delay: 40`, `PRESS=22`, `TAP=96`, `beat=16`, bob periods) are **60 fps-specific**; springs alone are fps-aware.

### Build config
- `TPL/package.json`: deps `@remotion/cli 4.0.481`, `remotion 4.0.481`, `react 19.2.3`, `react-dom 19.2.3`; dev `typescript 5.9.3`, `@types/react 19.2.7`, `@types/web 0.0.166`, `prettier 3.8.1`. `package-lock.json` is tracked.
- `TPL/tsconfig.json`: ES2018/commonjs/react-jsx/strict/noEmit, `lib: ["es2015"]`, excludes `remotion.config.ts`.
- `TPL/remotion.config.ts`: `setVideoImageFormat("jpeg")`, `setOverwriteOutput(true)`, `setConcurrency(null)`, `setChromiumOpenGlRenderer("angle")`.

---

## 3. `TPL/scripts/build_audio.py` — exact behaviour

- **Dependencies:** Python stdlib only + `ffmpeg`/`ffprobe` on PATH (`:23`, preflight `:130-138`). No numpy, no network, no key. Runs in a Linux container with stock ffmpeg (`anullsrc`, `anoisesrc`, `volumedetect`, `adelay`, `amix`, `alimiter`, `tremolo`, `lowpass/highpass`, `afade`, MP3 decoder).
- **Constants:** `DUR = 33.0` s, must equal `DURATION/FPS` (`:40-41`); paths `public/sfx`, `public/audio/master.wav` (`:35-38`).
- **SFX library `SND`** (`:45-54`): 8 names → files: `click, pop, pop2, whoosh, chime, type, drag, sparkle`. 16 other bundled mp3s are unused by the script.
- **Levels** (`:58-59`): `CLICK 1.00, TYPE 0.92, POP 0.80, WHOOSH 0.60, CHIME 0.90, SPARKLE 0.78, FAN 0.72`.
- **FX timeline format** (`:62-94`): a Python list of `(effect_name, start_sec, volume)` tuples, ~38 cues.
- **Normalisation** (`:109-127`): `volumedetect` → `volume={target - max}dB` to reach −3 dBFS, 48 kHz stereo WAV, cached per run.
- **Pad synthesis** (`:179-193`): pink noise `anoisesrc` → lowpass 520 / highpass 90 / tremolo / volume 0.09 / 2 s fades.
- **Mix** (`:174-215`): silent `anullsrc` base + pad + one `adelay|volume` input per cue → `amix normalize=0`, `alimiter=limit=0.89` → `-t DUR -ar 48000 -ac 2 public/audio/master.wav`.
- **Args** (`:154-160`): `--duration FLOAT` (default 33.0), `--no-pad`.
- **Output:** `public/audio/master.wav` 48 kHz stereo (gitignored).
- **Programmatic gap:** the cue list is source code, not data; nothing validates `DUR`↔`theme.ts DURATION` or cue times↔`T`.

## 4. `TPL/scripts/make_placeholders.py`

Generates the seven 1080×2340 placeholder screens and a 1024×1024 logo tile with Pillow. Dev-only; Linux-safe. Useful as a fallback when a product profile has fewer than 7 screenshots.

## 5. Render commands, versions, Chromium, cost

- npm scripts (`TPL/package.json:19-27`): `render:vertical|landscape|store|store-wide` → `remotion render <Comp> out/<file>.mp4 --crf 18`. Stills: `npx remotion still <Comp> out/f.png --frame=N`.
- Remotion **4.0.481** pinned. Chromium: `chrome-headless-shell` downloaded on first use (193 MB). Linux worker needs `npx remotion browser ensure` at build plus headless-Chrome shared libs; re-validate `setChromiumOpenGlRenderer("angle")` (Remotion recommends `angle-egl` with GPU or `swangle` CPU-only).
- **Measured probe:** 60 frames of `PromoVertical` rendered in **5 s wall-clock including bundle + browser start** on this Apple Silicon machine.
- **Estimate for 60 fps × 33 s × 4 compositions = 7,920 frames**: Apple Silicon ≈ 5–8 min total; CPU-only Linux (2–4 vCPU, swangle) ≈ 40–80 min for four. Options: parallel render jobs, 30 fps store comps once timing is fps-agnostic, or Remotion Lambda.
- Headless preference: `@remotion/bundler` `bundle()` once + `@remotion/renderer` `selectComposition`/`renderMedia` with `inputProps`.

## 6. `SK/docs/appstore-cut.md` — the ffmpeg recipe

Rules: 15–30 s, 30 fps, exact 886×1920 / 1920×886, H.264, first frame = poster. Recipe: per segment `trim/setpts` and `atrim/asetpts/atempo` (1.06 gentle; `atempo=1.581139,atempo=1.581139` for 2.5×), `concat=n=K:v=1:a=1`, `fps=30`, encode `libx264 -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 256k -movflags +faststart`. `SEG` is hand-tuned for the example film (`:30-31`). Stale wording about VO.

## 7. `SK/docs/voiceover.md` — optional VO path

No built-in TTS; deliberate. Options: manual recording, macOS `say`, Linux `espeak-ng`/`piper`, hosted TTS. Mix recipe (`:46-50`) with `adelay`, ducking 0.55, `alimiter`. The stale v1 copy's OpenRouter `openai/gpt-audio` TTS is the only concrete hosted implementation on disk.

## 8. Bundled assets + licensing

- **Fonts** Inter.ttf, Baloo2.ttf — SIL OFL 1.1. OK to redistribute.
- **SFX** 24 mp3s — `NOTICE:14-21`: provenance not verified for commercial redistribution. **Blocker for a commercial product unless replaced.** Only 8 are wired into `SND`.
- **Placeholder screens/logo** — generated, brand-neutral, MIT.
- **Remotion** — `NOTICE:23-27`: may require a company licence for commercial use.
- Project code — MIT © 2026 Aariz Rasheed.

## 9. Hazards

No `TODO`/`FIXME` markers anywhere. Structural hazards:

1. Stale v1 copy at `AGW/promo-video` with key-gated audio; skill resolution ambiguity.
2. Zero prop-driving in the template.
3. 25 legacy colour literals outside `COLORS` across components and scenes.
4. `FontLoader.tsx:14-19` hardcodes font names.
5. `ActionButton.tsx:55` `"SCAN"` and `ScoreRing.tsx:71` `"/100"` hardcoded.
6. `T` ↔ `DUR` ↔ `FX` sync unchecked.
7. 60 fps-coupled frame constants.
8. `python3` on PATH assumed.
9. macOS-centric preflight/install hints.
10. Chromium/GL on Linux unverified.
11. Remotion company licence and SFX provenance.
12. yt-dlp from a datacentre IP: bot checks/403; no cookies/proxy option in `download.py`.
13. `watch.py` has no machine-readable output; the library functions are cleanly importable.
14. Whisper key: `GROQ_API_KEY` then `OPENAI_API_KEY`; promo analysis can run `--no-whisper`.
15. Silent asset failure in `PhoneFrame.tsx:49-72`.
16. CPU-heavy effects (`Particles`, `Confetti`, `Whoosh`).
17. `watch` local install is a hand copy.
18. `appstore-cut.md` references VO; `SEG` hand-tuned.
19. Adding/removing scenes requires editing three places.
20. `tsconfig.json` `lib: ["es2015"]` with `target ES2018`.
21. `__pycache__` present in working trees.

### `watch` skill — exactly what it runs (`WATCH/scripts/`)
- **Captions first** (`download.py:65-95`): `yt-dlp --skip-download --write-info-json --write-subs --write-auto-subs --sub-langs en.* --sub-format vtt --convert-subs vtt --no-playlist --ignore-errors`.
- **Video download** (`download.py:115-162`): `yt-dlp -N 8 -f "bv*[height<=720]+ba/b[height<=720]/bv+ba/b" --merge-output-format mp4`.
- **Metadata** (`frames.py:86-119`): `ffprobe -print_format json -show_format -show_streams`.
- **Frame budget** (`frames.py:122-138`): ≤30 s → `max(12, round(d))`; 30–60 s → 40; 1–3 min → 60; 3–10 min → 80. `MAX_FPS=2.0`.
- **Scene-aware extraction** (`frames.py:217-280,510-573`): `select='eq(n\,0)+gt(scene\,0.20)'` + `scale=min(512,iw)` + `showinfo`; <8 shots → uniform fallback; perceptual dedup via 16×16 grayscale thumbnails; even-sample to cap.
- **Transcript**: VTT parse + rolling-duplicate collapse (`transcribe.py`).
- **Whisper fallback** (`whisper.py`): mp3 16 kHz mono → Groq `whisper-large-v3` or OpenAI `whisper-1`, 24 MB chunking, stdlib multipart, 429 retries.
- **Orchestrator** `watch.py`: markdown report to stdout; work dir under `tempfile.mkdtemp(prefix="watch-")` or `--out-dir`.

---

## 10. Classification for a headless web worker

| Component | Verdict | Justification |
|---|---|---|
| `WATCH/scripts/download.py`, `frames.py`, `transcribe.py`, `whisper.py`, `config.py` | **REUSE VERBATIM (as library) + WRAP** | Clean, stdlib-only, importable functions. Write a ~40-line entry that returns JSON (frames[], transcript[], meta). Add cookies/proxy passthrough. |
| `WATCH/scripts/watch.py`, `setup.py`, `WATCH/SKILL.md` | **Drop** | Agent-facing orchestration/UX. |
| `SK/prompt/creative-director-prompt.md` | **ADAPT** | Keep ROLE/TASK/IMPORTANT/QUALITY BAR verbatim as system prompt; fill placeholders; **remove "THEN BUILD EVERYTHING"** and replace with a JSON output schema. |
| `SK/docs/motion-language.md`, `example-breakdown.md`, `scene-kit.md` | **REUSE VERBATIM** as prompt context | Vocabulary, depth exemplar, kit catalogue. |
| `SK/SKILL.md` | **REWRITE** as a job DAG | Step 4 rules become validation rules on the storyboard JSON. |
| `TPL/src/animations/*` | **REUSE VERBATIM** | Pure, deterministic. |
| `TPL/src/components/*` | **REUSE + ADAPT** | Keep APIs; derive hardcoded colours from theme props; add `label`, suffix, font-list, `ratio` props. |
| `TPL/src/theme.ts`, `fonts.ts`, `Root.tsx`, `Film.tsx` | **ADAPT** | `Theme` + `Storyboard` props contract: `schema` (zod) + `calculateMetadata`; `Film.tsx` maps `storyboard.scenes[]` → `<Sequence>`. |
| `TPL/src/scenes/*` | **REWRITE into a parameterised kit** (option b) or keep as few-shot exemplars (option a) | One product's worked example with copy baked in. |
| `TPL/scripts/build_audio.py` | **WRAP + ADAPT** | Keep normalisation/pad/mix engine verbatim; add `--fx cues.json`; derive `DUR` from storyboard. |
| `TPL/scripts/make_placeholders.py` | **REUSE VERBATIM** | Fallback for <7 screenshots. |
| `SK/docs/appstore-cut.md` | **ADAPT into a script** | Compute `SEG` from storyboard cue gaps. |
| `SK/docs/voiceover.md` | **Optional / ADAPT** | Only the mix recipe is code. |
| Fonts | **REUSE** (OFL) | — |
| SFX | **REPLACE before commercial use** | `NOTICE:14-21`. |
| Remotion | **REUSE, licence check required** | `NOTICE:23-27`. |

### Recommended implementation of the "agent reasoning" steps as LLM job steps

1. **`analyze_reference`** — 30–40 JPEG frames + optional transcript + `example-breakdown.md` + `motion-language.md` → `ReferenceAnalysis` JSON `{duration, acts[], beat_rate_s, beats[], transitions[], camera[], typography, palette, signature_devices[≥2]}` + section-1 markdown. One vision call.
2. **`analyze_product`** — deterministic Pillow palette quantisation first, then a vision call → `ProductAnalysis` JSON `{money_shot, feature_to_screen[], type_personality, story_order[]}` + sections 2–3.
3. **`storyboard`** — creative-director prompt + both analyses + `scene-kit.md` + duration/fps → `Storyboard` JSON `{fps, duration_frames, theme, scenes[], self_check}` + sections 4–5 → `CREATIVE_DIRECTION.md`. Validate with zod; reject template-order reproduction, unmapped signature devices, missing screens.
4. **`build`** → **`audio`** → **`render`** (Node API ×4) → **`store_cut`** → optional **`qa`** (bounded 2 iterations).

### (a) Generated TSX per project vs (b) fixed kit driven by `inputProps`

| | (a) LLM writes scene TSX | (b) Fixed kit + JSON `inputProps` |
|---|---|---|
| Fidelity to "structure from the reference" | High | Bounded by kit |
| Determinism / testability | Low | High |
| Security | Executes generated code | No code execution |
| Latency / cost | Extra tokens + compile loop | Storyboard call only |
| 886-px clipping, orientation | Re-implemented per scene | Solved once per component |
| Maintenance | Every output is a fork | Kit improvements lift all films |

**Recommendation:** ship **(b)** as the production path, seeded with the nine existing scene *jobs* refactored to props **plus the six named signature devices from `scene-kit.md:77-96`** (typewriter bookend, split screen, system-voice mono type, numbered step rows, card scatter, light↔dark inversion). Keep **(a)** as a later, gated "custom device" stage admitted only after typecheck + still-render validation.

Key risk: the *quality* of the three LLM steps is what customers pay for, and the repo contains no evaluation data. Budget a small eval set of references with human-approved storyboards before trusting the headless loop.
