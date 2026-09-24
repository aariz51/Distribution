#!/usr/bin/env python3
"""Verify that captions and the title bar are really burned into a rendered clip.

A file that decodes proves an encode happened; it does not prove anything was
drawn on it. Comparing two frames directly does not work either: the frames move,
and the title renderer shifts the whole picture down, so every band differs.

So this detects the overlay *structurally* instead. Burned-in captions and title
bars are near-white glyphs carrying a hard dark stroke, which produces a very
specific signature: bright pixels sitting next to dark pixels within a few px.
Ordinary footage almost never does that at the same density.

  stroked-text density in a band, averaged over several frames:
    captions  speech frames  vs  silent-gap frames, in the caption band
    title     titled.mp4     vs  flat.mp4,          in the top band

Exits non-zero if an overlay that should exist is not detectable.

  python3 scripts/verify-burnin.py <clip dir>
"""
import json
import re
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("needs Pillow: run with the sidecar interpreter (PYTHON_BIN)")

FF = "ffmpeg"
BRIGHT = 225   # glyph fill
DARK = 90      # stroke / shadow
MIN_DENSITY = 0.0015  # fraction of band pixels that must look like stroked text


def frame(video: Path, t: float, out: Path) -> Image.Image:
    subprocess.run([FF, "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1", str(out)], check=True)
    return Image.open(out).convert("L")


def stroked_text_density(img: Image.Image, top: float, bottom: float) -> float:
    """Fraction of band pixels that are bright and adjacent to something dark.

    MinFilter takes the darkest neighbour in a 5px window, so a bright pixel whose
    local minimum is dark is a glyph edge against its own stroke.
    """
    w, h = img.size
    band = img.crop((0, int(h * top), w, int(h * bottom)))
    darkest_near = band.filter(ImageFilter.MinFilter(5))
    bright = band.point(lambda p: 255 if p >= BRIGHT else 0)
    has_dark = darkest_near.point(lambda p: 255 if p <= DARK else 0)
    px_b, px_d = list(bright.tobytes()), list(has_dark.tobytes())
    hits = sum(1 for a, b in zip(px_b, px_d) if a and b)
    return hits / max(1, band.size[0] * band.size[1])


def cue_windows(srt: Path):
    text = srt.read_text()
    cues = re.findall(r"(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)", text)
    if not cues:
        return [], []
    def secs(h, m, s, ms):
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000
    spans = sorted((secs(*c[:4]), secs(*c[4:])) for c in cues)
    on = [(a + b) / 2 for a, b in spans if b - a > 0.25][:6]
    gaps = []
    for (_, a_end), (b_start, _) in zip(spans, spans[1:]):
        if b_start - a_end > 0.5:
            gaps.append((a_end + b_start) / 2)
    return on, gaps[:6]


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def main() -> int:
    clip_dir = Path(sys.argv[1]).expanduser().resolve()
    flat, titled, srt = clip_dir / "flat.mp4", clip_dir / "titled.mp4", clip_dir / "captions.srt"
    if not flat.exists():
        print(f"no flat.mp4 in {clip_dir}")
        return 1
    tmp = clip_dir / ".qa"
    tmp.mkdir(exist_ok=True)
    results, failures = {}, []

    # ── captions ────────────────────────────────────────────────────────────
    on, gaps = cue_windows(srt) if srt.exists() else ([], [])
    if on:
        speech = [stroked_text_density(frame(flat, t, tmp / f"c_on_{i}.png"), 0.58, 0.82) for i, t in enumerate(on)]
        quiet = [stroked_text_density(frame(flat, t, tmp / f"c_off_{i}.png"), 0.58, 0.82) for i, t in enumerate(gaps)] if gaps else []
        results["captions"] = {
            "speech_density": round(mean(speech), 5),
            "silent_density": round(mean(quiet), 5) if quiet else None,
            "frames": {"speech": len(speech), "silent": len(quiet)},
        }
        if mean(speech) < MIN_DENSITY:
            failures.append(f"captions: density {mean(speech):.5f} below {MIN_DENSITY} — nothing drawn in the caption band")
        elif quiet and mean(speech) < mean(quiet) * 1.5:
            failures.append(f"captions: speech {mean(speech):.5f} not above silence {mean(quiet):.5f} — band looks the same with and without words")
    else:
        results["captions"] = {"skipped": "no cues in captions.srt"}

    # ── title bar ───────────────────────────────────────────────────────────
    if titled.exists():
        ts = [1.5, 5.0, 9.0]
        with_title = [stroked_text_density(frame(titled, t, tmp / f"t_on_{i}.png"), 0.07, 0.26) for i, t in enumerate(ts)]
        without = [stroked_text_density(frame(flat, t, tmp / f"t_off_{i}.png"), 0.07, 0.26) for i, t in enumerate(ts)]
        results["title"] = {"titled_density": round(mean(with_title), 5), "flat_density": round(mean(without), 5), "frames": len(ts)}
        if mean(with_title) < MIN_DENSITY:
            failures.append(f"title: density {mean(with_title):.5f} below {MIN_DENSITY} — no title drawn")
        elif mean(with_title) < mean(without) * 1.5:
            failures.append(f"title: titled {mean(with_title):.5f} not above flat {mean(without):.5f} — title bar absent")
    else:
        results["title"] = {"skipped": "no titled.mp4"}

    print(json.dumps({"clip": clip_dir.name, "results": results, "failures": failures}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
