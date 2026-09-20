"""Place sound effects under a finished clip.

Effects are chosen from the edit itself, not sprinkled at random:

  whoosh     on scene changes, so a hard cut lands softly
  attention  once at the top, on the hook
  riser      leading into the biggest gap before a statement (a reveal)
  boom       on the strongest emphasis beat
  stinger    where the speaker's pace jumps, which usually marks a surprise

Everything is mixed well under the voice (-18 dB or lower) so speech stays the
loudest thing in the mix -- effects that fight the words cost retention rather
than adding to it.

Usage:
  sfx_mix.py --video IN.mp4 --scenes scene_plan.json --transcript words.json \
             --kit DIR --output OUT.mp4
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# Gain per effect, in dB below the programme. Transitions sit lowest because
# there are many of them; a single boom can afford to be heard.
# Levels were set to sit under a busy original mix. With the backing track
# removed the voice is alone, so effects can come up to where they are
# actually heard while still staying below the speech.
GAIN_DB = {
    "attention": -8.0,
    # The opening riser carries the suspense, so it sits louder than the rest.
    # At -11 it was audible but polite; this is meant to be felt.
    "riser": -5.0,
    "boom": -6.0,
    "stinger": -9.0,
    "pop": -10.0,
}

# Aariz's call: the whoosh reads as cheap, so transitions are left silent
# rather than papered over with it.
DISABLED = {"whoosh"}

# Editorial roles mapped onto the real sound packs, in preference order.
# Aariz's own packs come first because they are produced sounds; the
# synthesised kit stays as the fallback so a missing file never breaks a
# render. Durations were checked against the role: a riser needs to breathe
# (1.8s), a stab has to be short (0.2s) or it walks over the next word.
ROLE_FILES = {
    "riser":     ["suspense_riser", "charge", "riser"],
    "attention": ["flash", "radio_beep", "attention"],
    "boom":      ["slow_down", "charge", "boom"],
    "stinger":   ["snap", "notification", "stinger"],
    "pop":       ["click", "mouse_click", "pop"],
    "type":      ["typewriter", "iphone_typing"],
    "data":      ["data_reading_short", "ui_progress"],
}


def resolve(role: str, kits: list[Path]) -> Path | None:
    """First file that exists for this role, across the kits in order."""
    for name in ROLE_FILES.get(role, [role]):
        for kit in kits:
            for ext in (".wav", ".mp3"):
                candidate = kit / f"{name}{ext}"
                if candidate.exists():
                    return candidate
    return None
# Never place two effects closer than this, or the mix turns into clutter.
MIN_GAP = 1.6
MAX_EFFECTS = 12


def log(msg: str) -> None:
    print(f"[sfx] {msg}", file=sys.stderr, flush=True)


def duration_of(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        check=True, text=True, capture_output=True).stdout.strip()
    return float(out or 0.0)


def plan_effects(scenes: list[dict], words: list[dict], duration: float) -> list[tuple[float, str]]:
    """Decide what plays when, from the structure of the edit."""
    picks: list[tuple[float, str]] = []

    # 1. The opening. A hook only works if the scroller stops, so the first
    #    two seconds get the strongest treatment: a riser building through the
    #    opening words into a hit on the first real beat. This is the "suspense
    #    at the start" the edit is built around.
    if words:
        first = float(words[0].get("start", 0.0))
        # Find the first natural pause to build into.
        opening_gap = None
        for a, b in zip(words, words[1:]):
            if float(b.get("start", 0)) > first + 1.0:
                gap = float(b.get("start", 0)) - float(a.get("end", 0))
                if gap > 0.18:
                    opening_gap = float(b.get("start", 0))
                    break
        # If the speaker runs straight through, invent a landing a few seconds
        # in rather than skipping the opening entirely.
        landing = opening_gap if (opening_gap and opening_gap < 9.0) else min(
            3.2, max(2.0, first + 2.4))

        # Build, then hit. The riser runs from the top of the clip and the
        # stab lands on the pause -- putting the stab at zero instead made it
        # collide with the riser and one of them was always dropped.
        picks.append((max(0.0, landing - 1.7), "riser"))
        picks.append((max(0.25, landing - 0.05), "attention"))


    # 3. Later payoffs. The longest remaining silences are where a reveal
    #    lands, so build into them the same way.
    if len(words) > 4:
        gaps = []
        for a, b in zip(words, words[1:]):
            at = float(b.get("start", 0))
            gap = at - float(a.get("end", 0))
            if gap > 0.32 and at > 9.0:
                gaps.append((gap, at))
        gaps.sort(reverse=True)
        for _, at in gaps[:2]:
            picks.append((max(0.0, at - 1.9), "riser"))
            picks.append((at - 0.05, "boom"))
        if len(gaps) > 2:
            picks.append((max(0.0, gaps[2][1] - 0.1), "stinger"))

    # Thin by importance, not by clock order. Cuts are frequent, so a plain
    # first-come filter fills the whole budget with whooshes and the reveal
    # beats -- the ones that actually carry meaning -- never get placed.
    # Openings first: an effect in the first three seconds does more for
    # retention than any number of mid-clip transitions.
    def priority(at: float, name: str) -> tuple:
        base = {"attention": 0, "riser": 1, "boom": 1, "stinger": 2, "pop": 3}.get(name, 3)
        return (0 if at < 3.0 else 1, base, at)
    MAX_PER_KIND = {"whoosh": 4}

    picks = [(at, n) for at, n in picks
             if 0 <= at <= duration - 0.25 and n not in DISABLED]
    picks.sort(key=lambda p: priority(p[0], p[1]))

    chosen: list[tuple[float, str]] = []
    counts: dict[str, int] = {}
    for at, name in picks:
        if len(chosen) >= MAX_EFFECTS:
            break
        if counts.get(name, 0) >= MAX_PER_KIND.get(name, MAX_EFFECTS):
            continue
        # A riser is a sustained bed, not a transient hit -- it is designed to
        # play *under* the opening stab and resolve into the boom. Spacing it
        # like a discrete effect deleted the opening suspense every time.
        def clashes(other_at: float, other_name: str) -> bool:
            if "riser" in (name, other_name) and name != other_name:
                return abs(at - other_at) < 0.15
            return abs(at - other_at) < MIN_GAP

        if any(clashes(o_at, o_name) for o_at, o_name in chosen):
            continue
        chosen.append((at, name))
        counts[name] = counts.get(name, 0) + 1

    chosen.sort()
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--kit", required=True)
    ap.add_argument("--scenes")
    ap.add_argument("--transcript")
    ap.add_argument("--output", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    if not video.exists():
        raise SystemExit(f"video not found: {video}")

    scenes = []
    if args.scenes and Path(args.scenes).exists():
        scenes = json.loads(Path(args.scenes).read_text()).get("scenes", [])
    words = []
    if args.transcript and Path(args.transcript).exists():
        words = json.loads(Path(args.transcript).read_text()).get("words", [])

    duration = duration_of(video)
    picks = plan_effects(scenes, words, duration)
    if not picks:
        log("nothing to place; copying through")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(video), "-c", "copy", args.output], check=True)
        print(args.output)
        return 0

    # The produced library is searched first, then the synthesised kit.
    kits = [Path(k).expanduser() for k in (args.kit or "").split(",") if k.strip()]
    library = Path("~/autoshorts/sfx_lib").expanduser()
    if library.exists() and library not in kits:
        kits.insert(0, library)

    available = []
    for at, name in picks:
        path = resolve(name, kits)
        if path:
            available.append((at, name, path))
        else:
            log(f"no sound available for {name}, skipping")
    if not available:
        raise SystemExit("no effect files found in the kit")

    for at, name, _ in available:
        log(f"{name:10s} at {at:6.2f}s")

    inputs = ["-i", str(video)]
    for _, _, path in available:
        inputs += ["-i", str(path)]

    parts, labels = [], []
    for idx, (at, name, _) in enumerate(available, start=1):
        gain = GAIN_DB.get(name, -18.0)
        delay = int(at * 1000)
        parts.append(f"[{idx}:a]adelay={delay}|{delay},volume={gain}dB[s{idx}]")
        labels.append(f"[s{idx}]")
    mix = ("[0:a]" + "".join(labels)
           + f"amix=inputs={len(labels) + 1}:duration=first:normalize=0[aout]")
    filt = ";".join(parts + [mix])

    if args.dry_run:
        print(json.dumps({"placements": [{"at": a, "effect": n} for a, n, _ in available]}, indent=1))
        return 0

    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs,
        "-filter_complex", filt,
        "-map", "0:v", "-map", "[aout]",
        # Video is copied, so adding sound costs no picture quality at all.
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", args.output,
    ], check=True, capture_output=True, text=True)
    log(f"mixed {len(available)} effect(s)")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
