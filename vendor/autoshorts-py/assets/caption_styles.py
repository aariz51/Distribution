"""Render the caption presets from Aariz's caption studio.

The 36 presets are not re-described here -- they are read verbatim from
`caption_styles.json`, exported straight out of the studio's own
`caption-styles.ts`. Hand-copying them would drift the moment either side
changed, and there is no reason for two descriptions of the same design.

This module turns one of those presets into pixels with Pillow, which is what
the clipping pipeline uses (ffmpeg's drawtext is unavailable on many builds).
Animation is expressed per frame: `render` takes the caption's progress
through its own on-screen time, so word-level styles highlight the word being
spoken and entrance animations play out.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
from pathlib import Path

# Families named in the studio mapped to faces that exist on this machine.
# The studio runs in a browser with webfonts; here the nearest installed face
# is used, preferring a heavy weight because these captions are read at a
# glance on a phone.
FONT_FAMILIES = {
    "inter": ["Helvetica", "Arial Bold", "Arial"],
    "outfit": ["Avenir Next", "Helvetica", "Arial Bold"],
    "poppins": ["Avenir Next", "Futura", "Helvetica"],
    "montserrat": ["Avenir Next", "Helvetica", "Arial Bold"],
    "roboto": ["Helvetica", "Arial"],
    "bebas neue": ["Impact", "Helvetica"],
    "anton": ["Impact", "Helvetica"],
    "oswald": ["Impact", "Helvetica"],
    "archivo": ["Helvetica", "Arial Bold"],
    "courier": ["Courier New", "Menlo"],
    "georgia": ["Georgia", "Times New Roman"],
}
FONT_DIRS = [
    "/System/Library/Fonts", "/System/Library/Fonts/Supplemental",
    "/Library/Fonts", os.path.expanduser("~/Library/Fonts"),
    "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation",
]
FALLBACK_FACES = ["Arial Bold", "Helvetica", "Arial", "DejaVuSans-Bold", "LiberationSans-Bold"]


def log(msg: str) -> None:
    print(f"[captions] {msg}", file=sys.stderr, flush=True)


def load_presets(assets: Path) -> dict:
    """Every preset, keyed by id."""
    path = assets / "caption_styles.json"
    data = json.loads(path.read_text())
    return {p["id"]: p for p in data["presets"]}


def _find_face(names: list[str]):
    from PIL import ImageFont

    for name in names:
        for d in FONT_DIRS:
            for ext in (".ttf", ".ttc", ".otf"):
                candidate = Path(d) / f"{name}{ext}"
                if candidate.exists():
                    try:
                        ImageFont.truetype(str(candidate), 24)
                        return str(candidate)
                    except Exception:
                        continue
    return None


_FONT_CACHE: dict = {}


def pick_font(family: str, weight: int, size: int):
    """A real face for the preset's family, as close as this machine allows."""
    from PIL import ImageFont

    key = (family, weight, size)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]

    stem = re.sub(r"['\"]", "", (family or "")).split(",")[0].strip().lower()
    names = FONT_FAMILIES.get(stem, [])
    # A heavy weight reads better small; try the bold face first when asked.
    if weight >= 700:
        names = [f"{n} Bold" for n in names] + names
    path = _find_face(names + FALLBACK_FACES)
    font = ImageFont.truetype(path, size) if path else ImageFont.load_default()
    _FONT_CACHE[key] = font
    return font


def parse_color(value: str, default=(255, 255, 255, 255)):
    """CSS colour from the studio -> RGBA tuple."""
    if not value or value == "transparent":
        return (0, 0, 0, 0)
    v = value.strip()
    m = re.match(r"rgba?\(([^)]+)\)", v)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        try:
            r, g, b = (int(float(p)) for p in parts[:3])
            a = int(float(parts[3]) * 255) if len(parts) > 3 else 255
            return (r, g, b, a)
        except ValueError:
            return default
    if v.startswith("#"):
        h = v[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) == 6:
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
        if len(h) == 8:
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
    return default


def transform_text(text: str, how: str) -> str:
    if how == "uppercase":
        return text.upper()
    if how == "lowercase":
        return text.lower()
    if how == "capitalize":
        return text.title()
    return text


def ease_out(t: float) -> float:
    return 1 - (1 - t) ** 3


WORD_ANIMATIONS = {"word-pop", "word-bounce", "karaoke", "color-swap", "highlight"}


def animation_state(animation: str, progress: float) -> dict:
    """Scale, offset and opacity for the caption at `progress` (0..1).

    Entrance animations resolve within the first fifth of the caption's life so
    the text is settled and readable for most of the time it is on screen.
    Continuous ones (beat, floating) run for the whole duration.
    """
    p = max(0.0, min(1.0, progress))
    intro = min(1.0, p / 0.2) if p < 0.2 else 1.0
    e = ease_out(intro)
    state = {"scale": 1.0, "dx": 0.0, "dy": 0.0, "alpha": 1.0}

    if animation == "fade-in":
        state["alpha"] = e
    elif animation == "zoom-in":
        state["scale"] = 0.72 + 0.28 * e
        state["alpha"] = e
    elif animation == "slide-up":
        state["dy"] = (1 - e) * 0.06
        state["alpha"] = e
    elif animation == "slide-down":
        state["dy"] = -(1 - e) * 0.06
        state["alpha"] = e
    elif animation == "slide-left":
        state["dx"] = (1 - e) * 0.10
        state["alpha"] = e
    elif animation == "slide-right":
        state["dx"] = -(1 - e) * 0.10
        state["alpha"] = e
    elif animation == "shrink":
        state["scale"] = 1.25 - 0.25 * e
        state["alpha"] = e
    elif animation in ("bouncy", "word-bounce"):
        # Overshoot then settle.
        state["scale"] = 1 + 0.22 * math.sin(math.pi * intro) * (1 - intro * 0.4)
    elif animation == "beat":
        state["scale"] = 1 + 0.05 * math.sin(p * math.pi * 6)
    elif animation == "floating":
        state["dy"] = 0.012 * math.sin(p * math.pi * 3)
    elif animation == "glow":
        state["alpha"] = 0.75 + 0.25 * math.sin(p * math.pi * 4)
    elif animation == "flicker":
        state["alpha"] = 1.0 if int(p * 24) % 5 else 0.35
    elif animation == "glitch-pop":
        state["scale"] = 1 + 0.12 * (1 - e)
        state["dx"] = 0.004 * math.sin(p * math.pi * 18)
    return state


def render(text: str, width: int, height: int, style: dict, progress: float,
           scale_ref: int = 1920):
    """One transparent frame of a caption in `style` at `progress` (0..1)."""
    from PIL import Image, ImageDraw, ImageFilter

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    if not text.strip():
        return img

    # The studio designs against a ~640px-tall preview; scale to the real frame.
    k = height / 640.0
    size = max(12, int(style.get("fontSize", 22) * k))
    font = pick_font(style.get("fontFamily", ""), style.get("fontWeight", 600), size)

    body = transform_text(text, style.get("textTransform", "none"))
    words = body.split()
    anim = style.get("animation", "none")
    st = animation_state(anim, progress)

    text_color = parse_color(style.get("textColor"), (255, 255, 255, 255))
    highlight = parse_color(style.get("highlightColor"), (0, 0, 0, 0))
    stroke_color = parse_color(style.get("strokeColor"), (0, 0, 0, 0))
    stroke_w = int(style.get("strokeWidth", 0) * k * 1.4)
    bg = parse_color(style.get("backgroundColor"), (0, 0, 0, 0))
    effect = style.get("effect", "none")

    draw = ImageDraw.Draw(img)
    max_w = int(width * 0.86)
    spacing = style.get("letterSpacing", 0) * k

    def measure(s: str) -> int:
        w = draw.textlength(s, font=font)
        return int(w + spacing * max(0, len(s) - 1))

    # Wrap.
    lines, current = [], []
    for word in words:
        trial = current + [word]
        if measure(" ".join(trial)) > max_w and current:
            lines.append(current)
            current = [word]
        else:
            current = trial
    if current:
        lines.append(current)

    line_h = int(size * style.get("lineHeight", 1.3))
    total_h = line_h * len(lines)
    cx = width * (style.get("positionX", 50) / 100.0)
    cy = height * (style.get("positionY", 85) / 100.0)
    cx += st["dx"] * width
    cy += st["dy"] * height
    y = int(cy - total_h / 2)

    # Which word is being spoken, for word-level styles.
    active = -1
    if anim in WORD_ANIMATIONS and words:
        active = min(len(words) - 1, int(max(0.0, min(0.999, progress)) * len(words)))

    idx = 0
    for line in lines:
        line_text = " ".join(line)
        w = measure(line_text)
        x = int(cx - w / 2)

        if bg[3]:
            pad_x, pad_y = int(style.get("paddingX", 16) * k), int(style.get("paddingY", 8) * k)
            r = int(style.get("borderRadius", 8) * k)
            box = [x - pad_x, y - pad_y, x + w + pad_x, y + line_h + pad_y // 2]
            if r > 0:
                draw.rounded_rectangle(box, radius=r, fill=bg)
            else:
                draw.rectangle(box, fill=bg)

        # Effects that sit behind the glyphs.
        if effect in ("shadow", "heavy-shadow", "subtle-shadow", "stack"):
            off = {"subtle-shadow": 0.03, "shadow": 0.05, "heavy-shadow": 0.08, "stack": 0.06}[effect]
            d = max(1, int(size * off))
            draw.text((x + d, y + d), line_text, font=font, fill=(0, 0, 0, 190))

        pen = x
        for word in line:
            is_active = idx == active
            fill = text_color
            wscale = 1.0
            box_color = None

            if is_active and highlight[3]:
                if anim in ("word-pop", "word-bounce"):
                    # A filled plate behind the spoken word, which is what the
                    # style is known for -- recolouring the glyphs alone reads
                    # as a typo rather than emphasis.
                    box_color = highlight
                    # Dark text on a bright plate, light text on a dark one.
                    luma = 0.299 * highlight[0] + 0.587 * highlight[1] + 0.114 * highlight[2]
                    fill = (16, 16, 16, 255) if luma > 140 else (255, 255, 255, 255)
                elif anim in ("karaoke", "color-swap", "highlight"):
                    fill = highlight

            if is_active and anim in ("word-pop", "word-bounce"):
                wscale = 1.10

            word_font = font
            if wscale != 1.0:
                word_font = pick_font(style.get("fontFamily", ""),
                                      style.get("fontWeight", 600), int(size * wscale))
            ww = draw.textlength(word, font=word_font)
            dy = int((size - size * wscale) / 2)

            if box_color:
                bx = int(size * 0.16)
                by = int(size * 0.10)
                r = max(2, int(style.get("borderRadius", 8) * k * 0.5))
                draw.rounded_rectangle(
                    [pen - bx, y + dy - by, pen + ww + bx, y + dy + size * wscale + by],
                    radius=r, fill=box_color)

            draw.text((pen, y + dy), word, font=word_font, fill=fill,
                      stroke_width=0 if box_color else stroke_w,
                      stroke_fill=stroke_color if (stroke_w and not box_color) else None)
            pen += int(ww + spacing)
            # The plate extends past the glyphs on both sides, so the gap has
            # to clear it or the next word sits on top of the highlight.
            gap = draw.textlength(" ", font=font) + spacing
            if box_color:
                gap += int(size * 0.16) * 2
            pen += int(gap)
            idx += 1
        y += line_h

    # Effects applied to the finished text layer.
    if effect in ("glow", "neon", "subtle-glow"):
        radius = {"subtle-glow": 4, "glow": 8, "neon": 14}[effect]
        glow = img.filter(ImageFilter.GaussianBlur(radius * k))
        img = Image.alpha_composite(glow, img)
    elif effect == "glitch":
        r, g, b, a = img.split()
        shift = max(2, int(3 * k))
        img = Image.merge("RGBA", (r.transform(r.size, Image.AFFINE, (1, 0, shift, 0, 1, 0)),
                                   g, b.transform(b.size, Image.AFFINE, (1, 0, -shift, 0, 1, 0)), a))

    if st["scale"] != 1.0:
        sw, sh = int(width * st["scale"]), int(height * st["scale"])
        scaled = img.resize((sw, sh), Image.LANCZOS)
        out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        out.paste(scaled, (int((width - sw) / 2), int((height - sh) / 2)), scaled)
        img = out

    if st["alpha"] < 1.0:
        alpha = img.split()[3].point(lambda v: int(v * st["alpha"]))
        img.putalpha(alpha)

    return img
