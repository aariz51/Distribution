# vendor/

Source systems reused verbatim (or nearly so) by the Distribution platform. Nothing here is
edited casually: each folder records where it came from and at what revision, so drift is
visible and upstream fixes can be re-applied.

| Folder | Origin | Revision | Licence | Used by |
|---|---|---|---|---|
| `autoshorts-py/` | `~/autoshorts/src-tauri/assets/*.py` + `caption_styles.json` + YuNet ONNX (fork of JayWebtech/autoshorts with local changes; see `docs/inventory/`) | working tree 2026-09-20 (HEAD `7612eb5` + uncommitted) | upstream MIT; YuNet Apache-2.0 | shorts pipeline sidecars |
| `promo-video/` | `~/Promo-Video-/skills/promo-video` (aariz51/promo-video-skill) | `0627dd0` | MIT; fonts OFL; SFX provenance unverified (see NOTICE) | promo pipeline: Remotion kit, docs, prompt, audio builder |
| `watch/` | `~/.claude/skills/watch/scripts` (bradautomates/claude-video v0.2.0) | copy dated 2026-09-17 | MIT | reference-video frame extraction (library use only) |
| `b-rolls/` | `~/b-rolls-ref` (aariz51/b-rolls) | `912c3a3` 2026-08-13 | Aariz's repo (no LICENSE file) | B-roll enrichment scripts |
| `video-use/` | browser-use/video-use pinned by b-rolls | `92c2b34e` | MIT | render helpers used by b-rolls |

Adapted files (small, marked `Distribution adaptation` in the source; everything else is byte-identical to the origin):

| File | Change | Why |
|---|---|---|
| `autoshorts-py/assets/captions.py` | accepts `style_overrides` in the stdin spec (textColor/highlightColor/strokeColor/backgroundColor) | brand colours drive captions (brief §3) |
| `autoshorts-py/assets/title_bar.py` | `--fill` / `--stroke` hex flags | brand colours drive title bars |

Rules:
- Do not import from `vendor/` into app code directly; go through the wrappers in `packages/pipelines`.
- The `vendor/promo-video/template` folder is the *starting point* for the prop-driven kit in
  `packages/promo-kit`; the copy here stays pristine for diffing.
- `.py` files are executed by the worker with the interpreter configured in `PYTHON_BIN`.
