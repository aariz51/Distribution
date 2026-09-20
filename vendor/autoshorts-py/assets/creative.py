"""Compose the branded post creative that goes out with a clip.

Why this is not an image-generation prompt
------------------------------------------
The obvious build is "describe the post, send it to an image model, ship what
comes back". That fails on the two things the creative exists to do.

  Typography. The headline is the product. Image models render text as
  text-shaped artefacts -- dropped letters, invented ligatures, a second
  garbled line under the first. A post whose headline is misspelled is worse
  than no post.

  Identity. The creative has to show *this* app: its wordmark, its green, its
  actual screenshots. A model asked for "a food scanner app logo" invents a
  different company every call.

So the division of labour is: the model decides *what to say and which frame to
say it over*, and this file decides *what it looks like*. Copy and frame choice
are judgement calls, which is what a model is for. Kerning a serif headline
against a brand palette is not a judgement call, it is a specification, and
Pillow executes a specification exactly the same way every time.

Reads a JSON spec on stdin, writes a PNG, prints the path.

Spec:
  {"frame": "/path/to/frame.png",        # background plate, usually a video frame
   "headline": "Ripe papaya is safe",
   "kicker": "THE TRUTH ABOUT",          # optional eyebrow above the headline
   "attribution": "Dr Imran Ahmed",      # optional speaker credit
   "brand": {...},                       # see BrandProfile below
   "layout": "bottom-anchor",            # or top-banner | split
   "size": [1080, 1350],
   "screenshot": "/path/app_screen.png", # optional, for the split layout
   "out": "/path/creative.png"}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance
except ImportError:  # pragma: no cover - reported to the caller, not raised
    print("Pillow is required for creative generation", file=sys.stderr)
    sys.exit(2)


# --- Fonts ------------------------------------------------------------------

# Display faces in preference order. A high-contrast serif is what gives the
# reference its editorial feel; a grotesque in the same slot reads as a generic
# stock-photo caption.
DISPLAY_FALLBACKS = [
    "/System/Library/Fonts/Supplemental/Didot.ttc",
    "/System/Library/Fonts/Supplemental/Baskerville.ttc",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/System/Library/Fonts/NewYork.ttf",
]

BODY_FALLBACKS = [
    "/System/Library/Fonts/Supplemental/Futura.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(path: str | None, size: int, fallbacks: list[str]):
    """Best available face at `size`, preferring the brand's own font file.

    A brand that ships its real typeface should get it; everything else is a
    graceful degradation rather than a crash, because a creative rendered in
    Georgia is still publishable and a traceback is not.
    """
    candidates = ([path] if path else []) + fallbacks
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return ImageFont.truetype(candidate, size)
        except (OSError, ValueError):
            continue
    return ImageFont.load_default()


# --- Colour -----------------------------------------------------------------


def hex_to_rgb(value: str, default: tuple[int, int, int]) -> tuple[int, int, int]:
    """Parse `#RRGGBB`, `RRGGBB` or Flutter's `0xFFRRGGBB`.

    The Flutter form is accepted because brand tokens are usually copied
    straight out of a Dart palette file, and asking a user to hand-convert them
    is how the wrong green ends up in the logo lockup.
    """
    if not isinstance(value, str):
        return default
    text = value.strip().lstrip("#")
    if text.lower().startswith("0x"):
        text = text[2:]
    if len(text) == 8:  # ARGB -> RGB
        text = text[2:]
    if len(text) != 6:
        return default
    try:
        return tuple(int(text[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return default


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    """WCAG relative luminance, used to pick readable text over a plate."""

    def channel(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = relative_luminance(a), relative_luminance(b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def readable_ink(
    background: tuple[int, int, int],
    ink: tuple[int, int, int],
    paper: tuple[int, int, int],
) -> tuple[int, int, int]:
    """Whichever of the brand's two neutrals actually reads on `background`.

    The scrim is built to darken the plate, but a plate can be almost any
    brightness and a brand's "ink" can be a mid grey. Choosing by measured
    contrast rather than by assuming the scrim won means a bright frame does
    not silently produce a headline nobody can read.
    """
    return ink if contrast_ratio(background, ink) >= contrast_ratio(background, paper) else paper


# --- Text layout ------------------------------------------------------------


def wrap_to_width(draw, text: str, font, max_width: int) -> list[str]:
    """Greedy word wrap measured against the real font, not a character count.

    A proportional serif makes "ILLNESS" and "wwwwwww" wildly different widths,
    so wrapping by character count overflows the frame on exactly the emphatic
    all-caps headlines this design uses most.
    """
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def fit_headline(
    draw,
    text: str,
    font_path: str | None,
    max_width: int,
    max_height: int,
    start_size: int,
    min_size: int = 28,
    max_lines: int = 4,
):
    """Largest size at which the headline fits its box in at most `max_lines`.

    Shrink-to-fit rather than truncate: a headline is the one element that must
    survive intact. Cutting it with an ellipsis destroys the sentence the whole
    post is built around, whereas two points of size is invisible.
    """
    size = start_size
    while size > min_size:
        font = load_font(font_path, size, DISPLAY_FALLBACKS)
        lines = wrap_to_width(draw, text, font, max_width)
        line_height = int(size * 1.08)
        if len(lines) <= max_lines and len(lines) * line_height <= max_height:
            return font, lines, line_height
        size -= 2
    font = load_font(font_path, min_size, DISPLAY_FALLBACKS)
    lines = wrap_to_width(draw, text, font, max_width)[:max_lines]
    return font, lines, int(min_size * 1.08)


# --- Plate treatment --------------------------------------------------------


def prepare_plate(frame_path: str, size: tuple[int, int]) -> Image.Image:
    """Cover-fit the frame to the canvas and grade it back a step.

    Two deliberate moves. Cover-fit (crop the overflow) rather than fit-inside,
    because letterboxing a social post wastes the only space it has. And a
    slight desaturation plus lifted contrast, because an ungraded video still
    competes with the headline for attention -- the plate is scenery, the words
    are the message.
    """
    width, height = size
    image = Image.open(frame_path).convert("RGB")
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.LANCZOS,
    )
    left = (resized.width - width) // 2
    # Bias the crop upward: in a talking-head frame the subject's face sits
    # above centre, and a centred crop cuts foreheads.
    top = max(0, (resized.height - height) // 3)
    plate = resized.crop((left, top, left + width, top + height))

    plate = ImageEnhance.Color(plate).enhance(0.82)
    plate = ImageEnhance.Contrast(plate).enhance(1.06)
    return plate


def measure_region(image: Image.Image, top: int, bottom: int) -> tuple[int, int, int]:
    """Mean colour of a horizontal band, so text colour is chosen from pixels.

    The first version of this file asked `readable_ink` whether white or ink
    read better against a hardcoded `(40, 40, 40)` -- an assumption that the
    scrim had already darkened everything. On a bright plate it had not, and
    the result was near-white type on near-white background: a headline that
    technically rendered and could not be read. Measuring removes the
    assumption.
    """
    top = max(0, min(image.height - 1, top))
    bottom = max(top + 1, min(image.height, bottom))
    band = image.crop((0, top, image.width, bottom))
    # A 1x1 thumbnail is the mean pixel, and far cheaper than summing.
    pixel = band.resize((1, 1), Image.BOX).getpixel((0, 0))
    return pixel[:3] if isinstance(pixel, tuple) else (pixel, pixel, pixel)


def apply_panel_scrim(
    plate: Image.Image,
    panel_top: int,
    tint: tuple[int, int, int],
    feather: int,
    floor: float = 0.72,
) -> Image.Image:
    """Darken the plate from `panel_top` down, feathering in above it.

    Keyed to where the text actually is rather than to a fixed curve over the
    whole frame. The earlier version used `position ** 2.2` across the full
    height, which put only ~28% coverage at the point the headline started --
    enough to muddy the picture, nowhere near enough to carry type. Here the
    band under the text is held at a guaranteed minimum opacity and the
    transition happens in `feather` pixels above it, so legibility does not
    depend on how bright the source video happened to be.
    """
    width, height = plate.size
    gradient = Image.new("L", (1, height), 0)
    for y in range(height):
        if y >= panel_top:
            value = floor
        elif y >= panel_top - feather:
            # Smoothstep in, so the scrim edge is not a visible hard line.
            t = (y - (panel_top - feather)) / max(1, feather)
            value = floor * (t * t * (3 - 2 * t))
        else:
            value = 0.0
        gradient.putpixel((0, y), int(255 * value))

    mask = gradient.resize((width, height))

    # Blur the plate under the panel before tinting it.
    #
    # Darkening alone is a blunt instrument: it lowers every pixel equally, so
    # a busy plate stays busy and its detail keeps competing with the headline
    # for the eye. Defocusing removes the competition instead of dimming it,
    # which is why every editorial cover does this and why the darkening can
    # then be gentler -- the picture survives as picture rather than becoming a
    # grey rectangle.
    blurred = plate.filter(ImageFilter.GaussianBlur(radius=max(6, height // 90)))
    softened = Image.composite(blurred, plate, mask)

    overlay = Image.new("RGB", (width, height), tint)
    return Image.composite(overlay, softened, mask.point(lambda v: int(v * 0.88)))


# --- Brand furniture --------------------------------------------------------


def paste_logo(canvas: Image.Image, logo_path: str | None, box_width: int, centre_x: int, y: int) -> int:
    """Draw the logo centred on `centre_x`, returning the height consumed.

    Returns 0 when there is no usable logo so callers can close the gap rather
    than leaving a hole where the brand mark should be.
    """
    if not logo_path or not Path(logo_path).exists():
        return 0
    try:
        logo = Image.open(logo_path).convert("RGBA")
    except OSError:
        return 0
    scale = box_width / logo.width
    sized = logo.resize(
        (box_width, max(1, round(logo.height * scale))), Image.LANCZOS
    )
    canvas.paste(sized, (centre_x - sized.width // 2, y), sized)
    return sized.height


def draw_device_frame(screenshot_path: str, target_height: int) -> Image.Image | None:
    """Put an app screenshot in a rounded device shell with a soft shadow.

    A raw screenshot pasted flat looks like a bug report. The shell is what
    makes it read as "this is an app you can install".
    """
    if not screenshot_path or not Path(screenshot_path).exists():
        return None
    try:
        shot = Image.open(screenshot_path).convert("RGB")
    except OSError:
        return None

    scale = target_height / shot.height
    shot = shot.resize((max(1, round(shot.width * scale)), target_height), Image.LANCZOS)

    radius = max(12, target_height // 28)
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width - 1, shot.height - 1], radius=radius, fill=255)

    pad = radius * 2
    shell = Image.new("RGBA", (shot.width + pad * 2, shot.height + pad * 2), (0, 0, 0, 0))

    shadow = Image.new("RGBA", shell.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [pad, pad + radius // 2, pad + shot.width, pad + shot.height + radius // 2],
        radius=radius,
        fill=(0, 0, 0, 110),
    )
    shell.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(radius)))

    rounded = Image.new("RGBA", shot.size, (0, 0, 0, 0))
    rounded.paste(shot, (0, 0), mask)
    shell.alpha_composite(rounded, (pad, pad))
    return shell


# --- Composition ------------------------------------------------------------


def compose_dark_editorial(spec: dict) -> str:
    """The layout the SafeChoice Instagram grid actually uses.

    Reverse-engineered from the live @safechoiceapp posts rather than invented,
    because a generated post that does not sit beside the existing ones is
    off-brand however well it is set. The differences from the light layouts
    are not cosmetic -- they are a different design system:

      near-black ground, not warm paper
      bold grotesque headline, not a high-contrast serif
      everything left-aligned to a single margin, not centred
      wordmark top-left with the second word in the accent colour
      a green pill and small footer codes anchoring the bottom

    No video frame is used. These posts are typographic: the picture is the
    words, which also sidesteps the burned-in-text problem entirely.
    """
    brand = spec.get("brand") or {}
    width, height = spec.get("size") or [1080, 1350]
    width, height = int(width), int(height)

    ground = hex_to_rgb(brand.get("colorGround", ""), (13, 17, 20))
    accent = hex_to_rgb(brand.get("colorAccent", ""), (23, 178, 106))
    paper = hex_to_rgb(brand.get("colorCanvas", ""), (246, 245, 241))
    muted = tuple(int(c * 0.55 + 40) for c in paper)
    body_font_path = brand.get("fontBody")
    # The headline face is the body family at its heaviest weight, not the
    # display serif: this system is grotesque-led.
    heavy_font_path = brand.get("fontHeavy") or body_font_path

    canvas = Image.new("RGB", (width, height), ground)
    draw = ImageDraw.Draw(canvas)

    margin = int(width * 0.075)
    content_width = width - margin * 2

    # --- wordmark, top left ----------------------------------------------
    mark_font = load_font(body_font_path, int(width * 0.026), BODY_FALLBACKS)
    name = (brand.get("name") or "").strip()
    y = margin
    if name:
        logo_path = brand.get("logoPath")
        x = margin
        if logo_path and Path(logo_path).exists():
            try:
                logo = Image.open(logo_path).convert("RGBA")
                size = int(width * 0.032)
                logo = logo.resize((size, size), Image.LANCZOS)
                canvas.paste(logo, (x, y - 2), logo)
                x += size + int(width * 0.012)
            except OSError:
                pass
        # Split the wordmark so the second half carries the accent, the way
        # "SafeChoice" and "LabelWise" are both set.
        head, tail = _split_wordmark(name)
        draw.text((x, y), head, font=mark_font, fill=paper)
        x += draw.textlength(head, font=mark_font)
        if tail:
            draw.text((x, y), tail, font=mark_font, fill=accent)

    # --- kicker -----------------------------------------------------------
    y = int(height * 0.30)
    kicker = (spec.get("kicker") or "").strip().upper()
    if kicker:
        kicker_font = load_font(body_font_path, int(width * 0.021), BODY_FALLBACKS)
        draw.text((margin, y), " ".join(kicker), font=kicker_font, fill=accent)
        y += int(width * 0.045)

    # --- headline ---------------------------------------------------------
    headline = (spec.get("headline") or "").strip()
    if not headline:
        raise ValueError("creative spec has no headline")

    headline_font, lines, line_height = fit_headline(
        draw,
        headline,
        heavy_font_path,
        content_width,
        int(height * 0.40),
        start_size=int(width * 0.082),
        max_lines=5,
    )
    for line in lines:
        draw.text((margin, y), line, font=headline_font, fill=paper)
        y += line_height

    # --- subline ----------------------------------------------------------
    subline = (spec.get("subline") or "").strip()
    if subline:
        y += int(height * 0.018)
        sub_font = load_font(body_font_path, int(width * 0.023), BODY_FALLBACKS)
        # A trailing arrow is drawn, not set, so a subset font cannot turn it
        # into a tofu box.
        trailing_arrow = subline.rstrip().endswith("\u2192")
        text = subline.rstrip().rstrip("\u2192").rstrip() if trailing_arrow else subline
        wrapped = wrap_to_width(draw, text, sub_font, content_width)
        for index, line in enumerate(wrapped):
            draw.text((margin, y), line, font=sub_font, fill=muted)
            if trailing_arrow and index == len(wrapped) - 1:
                arrow_size = int(width * 0.022)
                draw_arrow(
                    draw,
                    margin + draw.textlength(line, font=sub_font) + arrow_size * 0.4,
                    y + arrow_size * 0.15,
                    arrow_size,
                    muted,
                )
            y += int(width * 0.032)

    # --- CTA pill, bottom left -------------------------------------------
    cta = (brand.get("ctaText") or "").strip()
    if cta:
        pill_font = load_font(body_font_path, int(width * 0.021), BODY_FALLBACKS)
        pad_x, pad_y = int(width * 0.026), int(width * 0.016)
        arrow_size = int(width * 0.020)
        gap = int(width * 0.014)
        text_w = draw.textlength(cta, font=pill_font)
        text_h = int(width * 0.024)
        pill_bottom = height - margin - int(width * 0.03)
        draw.rounded_rectangle(
            [margin, pill_bottom - text_h - pad_y,
             margin + text_w + gap + arrow_size + pad_x * 2, pill_bottom + pad_y],
            radius=999,
            fill=accent,
        )
        draw.text((margin + pad_x, pill_bottom - text_h), cta, font=pill_font, fill=ground)
        draw_arrow(
            draw,
            margin + pad_x + text_w + gap,
            pill_bottom - text_h + arrow_size * 0.15,
            arrow_size,
            ground,
        )

    # --- footer codes -----------------------------------------------------
    # The small monospace marks in the bottom corners of the real posts. They
    # carry no information; they are what makes the set read as a series.
    code_font = load_font(body_font_path, int(width * 0.015), BODY_FALLBACKS)
    left_code = (spec.get("footerLeft") or "").strip()
    right_code = (spec.get("footerRight") or "").strip()
    if left_code:
        draw.text((margin, height - margin), left_code, font=code_font, fill=muted)
    if right_code:
        w = draw.textlength(right_code, font=code_font)
        draw.text((width - margin - w, height - margin), right_code, font=code_font, fill=muted)

    out = spec.get("out") or str(Path.cwd() / "creative.png")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "PNG", optimize=True)
    return out


def draw_arrow(draw, x: float, y: float, size: int, fill) -> None:
    """A right-pointing arrow, drawn rather than typed.

    The obvious approach is to put U+2192 in the string, and it produced a tofu
    box: the brand's bundled Inter is subset and has no arrow glyph. Falling
    back to a system font for one character would break the line's typeface
    mid-sentence. Two lines and a triangle always render, in any font, at any
    size.
    """
    mid = y + size / 2
    bar = max(1, size // 9)
    draw.rectangle([x, mid - bar / 2, x + size * 0.72, mid + bar / 2], fill=fill)
    draw.polygon(
        [(x + size * 0.58, mid - size * 0.30),
         (x + size, mid),
         (x + size * 0.58, mid + size * 0.30)],
        fill=fill,
    )


def _split_wordmark(name: str) -> tuple[str, str]:
    """Split a compound wordmark so the second half can take the accent.

    Handles the CamelCase forms these brands use ("SafeChoice", "LabelWise")
    and falls back to the last space-separated word. A name with no seam is
    returned whole rather than being cut at an arbitrary midpoint.
    """
    if " " in name:
        head, _, tail = name.rpartition(" ")
        return head + " ", tail
    for i in range(1, len(name)):
        if name[i].isupper() and name[i - 1].islower():
            return name[:i], name[i:]
    return name, ""


def compose(spec: dict) -> str:
    """Lay the creative out bottom-up, then scrim, then draw.

    Order matters and it is the thing the first version got wrong. It drew
    elements at guessed positions and applied a fixed scrim independently, so
    the scrim and the text had no relationship to each other. Here the stack is
    measured first (logo, wordmark, screenshot, attribution, headline, kicker),
    which yields the exact pixel where the text panel begins; only then is the
    plate darkened from that line down; only then is anything drawn. Legibility
    stops being a happy accident of how bright the source video was.
    """
    brand = spec.get("brand") or {}
    width, height = spec.get("size") or [1080, 1350]
    width, height = int(width), int(height)

    ink = hex_to_rgb(brand.get("colorInk", ""), (20, 23, 26))
    accent = hex_to_rgb(brand.get("colorAccent", ""), (23, 178, 106))
    paper = hex_to_rgb(brand.get("colorCanvas", ""), (246, 245, 241))
    display_font_path = brand.get("fontDisplay")
    body_font_path = brand.get("fontBody")

    layout = spec.get("layout") or "bottom-anchor"
    if layout == "dark-editorial":
        return compose_dark_editorial(spec)
    headline = (spec.get("headline") or "").strip()
    if not headline:
        raise ValueError("creative spec has no headline")

    margin = int(width * 0.085)
    content_width = width - margin * 2
    gap = int(height * 0.022)

    frame = spec.get("frame")
    has_frame = bool(frame and Path(frame).exists())
    plate = (
        prepare_plate(frame, (width, height))
        if has_frame
        else Image.new("RGB", (width, height), paper)
    )

    measure = ImageDraw.Draw(plate)

    # --- measure the stack from the bottom edge upward -------------------
    cursor = height - margin

    lockup_font = load_font(body_font_path, int(width * 0.026), BODY_FALLBACKS)
    brand_name = (brand.get("name") or "").strip()
    wordmark_height = int(width * 0.032) if brand_name else 0
    cursor -= wordmark_height

    logo_width = int(width * 0.1)
    logo_path = brand.get("logoPath")
    has_logo = bool(logo_path and Path(logo_path).exists())
    if has_logo:
        cursor -= logo_width + int(width * 0.018)
    logo_top = cursor

    shell = None
    if layout == "split":
        shell = draw_device_frame(spec.get("screenshot") or "", int(height * 0.32))
        if shell is not None:
            cursor -= shell.height + gap
    shell_top = cursor

    attribution = (spec.get("attribution") or "").strip()
    attribution_font = load_font(body_font_path, int(width * 0.028), BODY_FALLBACKS)
    if attribution:
        cursor -= int(width * 0.042)
    attribution_top = cursor

    rule_height = max(2, height // 450)
    cursor -= gap + rule_height
    rule_y = cursor

    # The headline gets whatever vertical room is left above the furniture,
    # capped so it never climbs past the upper third and swallows the picture.
    headline_budget = int(height * (0.2 if layout == "split" else 0.33))
    headline_font, lines, line_height = fit_headline(
        measure,
        headline,
        display_font_path,
        content_width,
        headline_budget,
        start_size=int(width * 0.1),
    )
    block_height = len(lines) * line_height
    cursor -= int(gap * 0.8) + block_height
    headline_top = cursor

    kicker = (spec.get("kicker") or "").strip().upper()
    kicker_font = load_font(body_font_path, int(width * 0.024), BODY_FALLBACKS)
    if kicker:
        cursor -= int(width * 0.05)
    kicker_top = cursor

    panel_top = cursor - int(gap * 0.5)

    if layout == "top-banner":
        # Same stack, flipped: the text rides at the top and the plate keeps
        # its lower two thirds clear for the speaker.
        shift = panel_top - margin
        panel_top -= shift
        kicker_top -= shift
        headline_top -= shift
        rule_y -= shift
        attribution_top -= shift

    # --- treat the plate now that the panel is known ---------------------
    if has_frame:
        plate = apply_panel_scrim(
            plate,
            panel_top if layout != "top-banner" else 0,
            ink,
            feather=int(height * 0.16),
        )
        if layout == "top-banner":
            # Scrim the top band instead, by flipping, scrimming, flipping back.
            plate = apply_panel_scrim(
                prepare_plate(frame, (width, height)).transpose(Image.FLIP_TOP_BOTTOM),
                height - (attribution_top + int(width * 0.06)),
                ink,
                feather=int(height * 0.16),
            ).transpose(Image.FLIP_TOP_BOTTOM)

    canvas = plate.convert("RGB")
    draw = ImageDraw.Draw(canvas)

    # Text colour from the pixels the text will actually sit on, measured after
    # the scrim rather than assumed before it.
    band = measure_region(canvas, headline_top, headline_top + block_height)
    text_on_plate = readable_ink(band, ink, paper)

    def centred(text: str, font, y: int, fill) -> None:
        draw.text(
            (width // 2 - draw.textlength(text, font=font) / 2, y), text, font=font, fill=fill
        )

    if kicker:
        # Letter-spaced by hand: Pillow has no tracking control, and an
        # un-tracked small-caps eyebrow reads as an accident rather than a
        # deliberate label.
        centred(" ".join(kicker), kicker_font, kicker_top, accent)

    y = headline_top
    for line in lines:
        centred(line, headline_font, y, text_on_plate)
        y += line_height

    rule_width = int(width * 0.09)
    draw.rounded_rectangle(
        [
            width // 2 - rule_width // 2,
            rule_y,
            width // 2 + rule_width // 2,
            rule_y + rule_height,
        ],
        radius=rule_height,
        fill=accent,
    )

    if attribution:
        centred(attribution, attribution_font, attribution_top, accent)

    if shell is not None:
        canvas.paste(shell, (width // 2 - shell.width // 2, shell_top), shell)

    if has_logo:
        paste_logo(canvas, logo_path, logo_width, width // 2, logo_top)

    if brand_name:
        centred(brand_name, lockup_font, height - margin - wordmark_height, text_on_plate)

    out = spec.get("out") or str(Path.cwd() / "creative.png")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "PNG", optimize=True)
    return out


def main() -> int:
    # Two modes on one script so the Rust side materialises a single sidecar.
    # `--pick-frame` takes frame paths and reports the best; the default mode
    # reads a spec on stdin and composes.
    if len(sys.argv) > 1 and sys.argv[1] == "--pick-frame":
        result = pick_frame(sys.argv[2:])
        if result is None:
            print("no readable frames", file=sys.stderr)
            return 1
        print(json.dumps(result))
        return 0

    try:
        spec = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"invalid creative spec: {exc}", file=sys.stderr)
        return 2
    try:
        print(compose(spec))
    except Exception as exc:  # noqa: BLE001 - surfaced to the Rust caller
        print(f"creative composition failed: {exc}", file=sys.stderr)
        return 1
    return 0




# --- Frame selection --------------------------------------------------------
#
# Which frame the creative sits on is the difference between a post that looks
# shot and one that looks scraped. Taking the first frame, or the midpoint,
# reliably lands on a blink, a motion-blurred gesture, or a hard cut. So
# candidates are sampled across the clip and scored on the things that actually
# make a still usable.


def score_frame(path: str) -> dict:
    """Score one candidate frame. Higher is better.

    Three measures, because they fail independently:

      Sharpness (variance of the Laplacian). A motion-blurred frame is the most
      common bad pick and the easiest to detect -- a blurred image has little
      high-frequency energy.

      Exposure. Frames that are crushed to black or blown to white carry no
      picture regardless of how sharp they are, and a mid-range mean with a
      healthy spread is what a usable still looks like.

      Detail spread (standard deviation). Separates a real photograph from a
      title card or a fade-to-black, both of which are sharp and correctly
      exposed and still useless as a background plate.
    """
    from PIL import ImageStat

    image = Image.open(path).convert("L")
    # Work at a fixed small size so scores are comparable across source
    # resolutions -- a 4K frame is not "sharper" than a 720p one just because
    # it has more pixels to disagree about.
    image = image.resize((320, 180), Image.LANCZOS)

    edges = image.filter(ImageFilter.FIND_EDGES)
    sharpness = ImageStat.Stat(edges).stddev[0]

    stat = ImageStat.Stat(image)
    mean = stat.mean[0]
    spread = stat.stddev[0]

    # Penalise the extremes rather than banning them: a deliberately dark frame
    # can still be a fine plate, it is just rarely the best available one.
    exposure = 1.0 - abs(mean - 128.0) / 128.0

    text_penalty = text_likelihood(image)

    return {
        "path": path,
        "sharpness": sharpness,
        "exposure": exposure,
        "spread": spread,
        "textiness": text_penalty,
        # The text term is subtracted hard, not weighted gently. A frame with
        # somebody else's caption burned across it is not a slightly worse
        # plate, it is an unusable one -- our headline would sit on top of
        # their sentence. Better to fall back to a softer, text-free frame.
        "score": sharpness * 0.55
        + spread * 0.3
        + exposure * 40.0
        - text_penalty * 120.0,
    }


def text_likelihood(gray: Image.Image) -> float:
    """0..1 estimate that this frame has text burned into it.

    Added after the scorer picked, as *best of twenty*, the frame with the
    largest block of the original creator's subtitles on it. That was not bad
    luck: text is high-contrast and finely detailed, so it scores near the top
    on both sharpness and spread -- the scorer was rewarding precisely the
    feature that makes a plate unusable.

    Two detectors, because they fail on different things:

      Glyph shapes (OpenCV, when available). Finds connected components and
      keeps the ones shaped like letters -- small, roughly as tall as they are
      wide, solid, and sharing a baseline with neighbours. This catches text
      that the density test misses: a caption mid-fade scatters a dozen
      isolated letters across the frame, which is sparse by row but obviously
      text to the eye, and the first version scored exactly that frame 0.00.

      Row density (Pillow only). A cheap fallback for installs without cv2.
    """
    try:
        return _glyph_likelihood(gray)
    except Exception:  # noqa: BLE001 - cv2 missing or unhappy; use the fallback
        return _row_density_likelihood(gray)


def _glyph_likelihood(gray: Image.Image) -> float:
    """Text score from connected components shaped like letters."""
    import cv2
    import numpy as np

    array = np.array(gray)
    # Text is high-contrast against whatever it sits on, in either polarity, so
    # both a bright-on-dark and a dark-on-bright pass are needed.
    scores = []
    for invert in (False, True):
        source = 255 - array if invert else array
        _, binary = cv2.threshold(source, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        count, _, stats, centroids = cv2.connectedComponentsWithStats(binary, 8)

        glyphs = []
        height, width = array.shape
        for i in range(1, count):
            x, y, w, h, area = stats[i]
            if h < 4 or h > height * 0.35 or w < 2 or w > width * 0.3:
                continue
            aspect = w / max(1, h)
            # Letters are taller than wide or roughly square; a long thin run
            # is a cable, a horizon or a window frame.
            if not 0.12 <= aspect <= 1.6:
                continue
            # Glyph strokes fill a good part of their bounding box. A wispy
            # natural edge does not.
            if area < w * h * 0.15:
                continue
            glyphs.append((centroids[i][0], centroids[i][1], h))

        if len(glyphs) < 4:
            scores.append(0.0)
            continue

        # Text sits on baselines. Group glyphs by y and find the largest run of
        # similarly-sized letters sharing one -- that is a word or a line, and
        # it is what separates real text from incidental blobs.
        glyphs.sort(key=lambda g: g[1])
        best_line = 0
        for i, (_, y0, h0) in enumerate(glyphs):
            line = [g for g in glyphs if abs(g[1] - y0) <= max(3, h0 * 0.4)
                    and 0.55 <= g[2] / max(1, h0) <= 1.8]
            best_line = max(best_line, len(line))

        # Four aligned letters is a short word; a caption line is 15-40.
        scores.append(min(1.0, best_line / 12.0))

    return max(scores) if scores else 0.0


def _row_density_likelihood(gray: Image.Image) -> float:
    """Fallback: many short light-dark runs along a scanline mean a text row."""
    width, height = gray.size
    pixels = gray.load()

    busy_rows = 0
    for y in range(0, height, 2):
        transitions = 0
        previous = pixels[0, y]
        for x in range(1, width):
            current = pixels[x, y]
            if abs(current - previous) > 55:
                transitions += 1
            previous = current
        if transitions > width * 0.09:
            busy_rows += 1

    density = busy_rows / max(1, height // 2)
    return min(1.0, density / 0.25)


def pick_frame(frames: list[str]) -> dict | None:
    """Best of the sampled frames, with the scores kept for inspection."""
    scored = []
    for frame in frames:
        try:
            scored.append(score_frame(frame))
        except Exception:  # noqa: BLE001 - one unreadable frame must not sink the batch
            continue
    if not scored:
        return None
    scored.sort(key=lambda s: s["score"], reverse=True)
    return {"best": scored[0], "all": scored}


if __name__ == "__main__":
    sys.exit(main())
