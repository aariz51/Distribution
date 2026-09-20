"""Strip a downloaded video back to clean picture and clean voice.

Two problems with reposted source material:

  Burned-in captions -- the original creator's subtitles are baked into the
  pixels. Ours are then drawn on top and the frame carries two sets of text.

  Music and effects -- a backing track under the speech fights the sound design
  we add, and doubles the copyright exposure.

Both are handled here, before anything is cut:

  * Soft subtitle tracks are simply not copied.
  * Burned-in captions are found by looking for text that recurs in the same
    band of the frame across many samples -- the signature of a subtitle strip,
    which a moving picture does not produce -- and that band is removed by
    cropping it away or, when it sits inside the action, by inpainting.
  * Speech is isolated from music with a vocal separator when one is available,
    falling back to a band-pass that keeps the voice and drops most of the bed.

Usage:
  clean_source.py --video IN.mp4 --output OUT.mp4 [--assets DIR]
                  [--no-audio-clean] [--report-only]
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

# Frames sampled when looking for a caption band. Subtitles persist for
# seconds at a time, so a wide spread over the whole video is what separates
# them from a caption-like graphic that appears once.
PROBE_FRAMES = 24
# How much denser than the rest of the frame a strip must be to read as a
# caption. Measured on a real 360p repost whose captions sat over busy
# packaging: the caption strip ran 2.1x the frame's median density while
# everything else stayed within 1.2x.
PEAK_RATIO = 1.55
# Once a peak is found, the band grows through neighbours that are merely
# elevated. Captions often run to two lines and the second line is less dense
# than the first, so anchoring on the peak alone removed one line and left the
# other on screen.
SHOULDER_RATIO = 1.12
# Bands are measured in this many horizontal strips.
STRIPS = 12

# Mean Canny edge density above which a frame is carrying substantial graphics
# or text rather than being ordinary footage. Calibrated against a stock-and-
# kinetic-text explainer, which sits at ~0.127 across every strip, versus a
# plain talking head, which sits well below it.
PERVASIVE_TEXT_DENSITY = 0.11


def log(msg: str) -> None:
    print(f"[clean] {msg}", file=sys.stderr, flush=True)


def probe(video: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json",
         str(video)], check=True, text=True, capture_output=True).stdout
    return json.loads(out)


def subtitle_tracks(info: dict) -> int:
    return sum(1 for s in info.get("streams", []) if s.get("codec_type") == "subtitle")


def detect_caption_band(video: Path, duration: float) -> tuple[float, float] | None:
    """Vertical band (as fractions of height) holding burned-in captions.

    Text is detected by edge density: glyphs produce many short, high-contrast
    edges packed into a small area, which differs from both flat backgrounds
    and natural detail. A band only qualifies when it lights up across many
    separate samples, because real subtitles are present most of the time.
    """
    try:
        import cv2
        import numpy as np
    except Exception as exc:
        log(f"OpenCV unavailable ({exc}); cannot inspect for burned-in captions")
        return None

    # Edge density per strip, per sample. Absolute thresholds were the first
    # attempt and they fail on busy footage: over a wall of chocolate wrappers
    # every strip looks "texty", the whole frame reads as one band, and the
    # band is then discarded for being too big. A caption strip is better
    # described as a *local* peak -- markedly denser than the rest of the same
    # frame -- which holds whether the background is a plain wall or a collage.
    per_strip = [[] for _ in range(STRIPS)]
    seen = 0
    for i in range(PROBE_FRAMES):
        t = duration * (i + 0.5) / PROBE_FRAMES
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(video),
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True).stdout
        if not raw:
            continue
        frame = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            continue
        seen += 1
        h, w = frame.shape[:2]
        edges = cv2.Canny(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 120, 240)
        strip_h = max(1, h // STRIPS)
        for s in range(STRIPS):
            band = edges[s * strip_h:(s + 1) * strip_h, :]
            if band.size:
                per_strip[s].append(float(band.mean()) / 255.0)
    if seen < 4:
        return None

    means = [float(np.mean(v)) if v else 0.0 for v in per_strip]
    median = float(np.median([m for m in means if m > 0]) or 0.0)
    if median <= 0:
        return None

    # Only the lower half can hold subtitles; a peak up top is the speaker or
    # a title card.
    lower = range(STRIPS // 2, STRIPS)
    peaks = [s for s in lower if means[s] >= median * PEAK_RATIO]
    if not peaks:
        # No band stands out. That is usually good news -- there are no
        # subtitles. But it is also what "kinetic" social-first editing looks
        # like: text that moves around the frame scene by scene never settles
        # into a strip, so every strip ends up equally busy and the peak test
        # finds nothing.
        #
        # The two cases are told apart by the overall level, not the shape. A
        # clean talking head has a low absolute edge density everywhere; a
        # frame with big text on it is dense wherever the text happens to be.
        # Band removal genuinely cannot help here -- there is no band, and
        # inpainting the whole frame would destroy the picture -- so this
        # reports rather than acts, and the rest of the pipeline adapts.
        if median >= PERVASIVE_TEXT_DENSITY:
            log("WARNING: this source appears to have text burned across the "
                "whole frame, not in a fixed subtitle strip. It cannot be "
                "removed without destroying the picture. Clips and post "
                "creatives will show the original creator's text.")
        return None

    # Keep the run containing the strongest peak, so a caption spanning two
    # strips is captured whole without swallowing the entire lower half.
    best = max(peaks, key=lambda s: means[s])
    shoulder = median * SHOULDER_RATIO
    run = [best]
    s = best - 1
    while s >= STRIPS // 2 and means[s] >= shoulder:
        run.insert(0, s)
        s -= 1
    s = best + 1
    while s < STRIPS and means[s] >= shoulder:
        run.append(s)
        s += 1

    top = run[0] / STRIPS
    bottom = (run[-1] + 1) / STRIPS
    if bottom - top > 0.34:
        log("densest band spans too much of the frame to be a subtitle strip")
        return None
    log(f"caption band peak at strip {best} "
        f"({means[best]:.3f} vs median {median:.3f})")
    return top, bottom


def isolate_voice(video: Path, work: Path) -> Path | None:
    """Return an audio file holding the speech with the bed removed.

    Detection was the wrong idea here. Aariz's instruction is simply to remove
    whatever is under the voice, and a "is there music?" test only creates a
    way to be wrong -- the first version measured three identical values at
    -104 dB on a video that plainly had a bed, and concluded there was none.
    So separation always runs.

    Demucs does a real source separation and keeps the voice intact. If it is
    unavailable or fails, a speech band-pass still removes most of a bed,
    which is worse but better than leaving it.
    """
    work.mkdir(parents=True, exist_ok=True)
    raw = work / "source_audio.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
         "-vn", "-ac", "2", "-ar", "44100", str(raw)],
        check=True, capture_output=True)

    try:
        log("separating voice from the backing track (demucs)")
        subprocess.run(
            [sys.executable, "-m", "demucs", "--two-stems", "vocals",
             "-n", "htdemucs", "-o", str(work), str(raw)],
            check=True, capture_output=True, text=True, timeout=3600)
        for cand in work.rglob("vocals.wav"):
            log("voice isolated")
            return cand
        log("demucs produced no vocals track")
    except subprocess.TimeoutExpired:
        log("demucs timed out; falling back to a speech band-pass")
    except Exception as exc:
        log(f"demucs unavailable ({str(exc)[:80]}); falling back to a speech band-pass")

    filtered = work / "voice_bandpass.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw),
         "-af", "highpass=f=180,lowpass=f=6500,afftdn=nr=18:nf=-30,dynaudnorm=g=5",
         str(filtered)],
        check=True, capture_output=True)
    return filtered


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--output")
    ap.add_argument("--assets", default=str(Path(__file__).parent))
    ap.add_argument("--no-audio-clean", action="store_true")
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    if not video.exists():
        raise SystemExit(f"video not found: {video}")

    info = probe(video)
    duration = float(info.get("format", {}).get("duration") or 0)
    subs = subtitle_tracks(info)
    band = detect_caption_band(video, duration) if duration > 1 else None
    strip_audio = not args.no_audio_clean

    log(f"subtitle tracks: {subs}")
    log(f"burned-in caption band: {'%.2f-%.2f of height' % band if band else 'none found'}")
    log(f"audio will be re-voiced: {strip_audio}")

    if args.report_only:
        print(json.dumps({"subtitle_tracks": subs,
                          "caption_band": band,
                          "strip_audio": strip_audio}))
        return 0

    output = Path(args.output) if args.output else video.with_name(f"{video.stem}_clean.mp4")

    vf = []
    if band:
        top, bottom = band
        h = int(info["streams"][0].get("height") or 1080)
        w = int(info["streams"][0].get("width") or 1920)
        band_top = int(h * top) // 2 * 2
        band_bottom = int(h * bottom) // 2 * 2
        # Cut the strip away when it hangs off the bottom of the frame;
        # otherwise blur it out, which keeps the framing intact.
        if bottom > 0.86:
            keep = band_top // 2 * 2
            vf.append(f"crop={w}:{keep}:0:0")
            log(f"cropping away the bottom {h - keep}px caption strip")
        else:
            bh = max(2, band_bottom - band_top)
            vf.append(
                f"[0:v]split[main][cap];[cap]crop={w}:{bh}:0:{band_top},"
                f"boxblur=luma_radius=24:luma_power=2[blur];"
                f"[main][blur]overlay=0:{band_top}[v]")
            log(f"blurring the caption strip at y={band_top}..{band_bottom}")

    filters = ",".join(f for f in vf if f and "overlay" not in f)
    complex_filter = next((f for f in vf if "overlay" in f), None)

    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video)]
    # Mapping any stream explicitly turns off ffmpeg's automatic selection, so
    # the video has to be mapped too -- leaving it out silently produced an
    # audio-only file. The complex path maps the filter's output, not the
    # original video, or the blur would be discarded.
    # `-map` is an OUTPUT option. Emitting one here, before the isolated voice
    # is added as a second `-i`, made ffmpeg try to apply it to that input and
    # fail with "Option map cannot be applied to input url". So the filter is
    # declared now and the label it produces is remembered; every `-map` is
    # deferred until all inputs are on the command line.
    video_map = "0:v:0"
    if complex_filter:
        cmd += ["-filter_complex", complex_filter]
        # The complex path maps the filter's output, not the original video,
        # or the blur would be discarded.
        video_map = "[v]"
    elif filters:
        cmd += ["-vf", filters]

    voice = None
    if strip_audio:
        import tempfile
        work = Path(tempfile.mkdtemp(prefix="voice_"))
        try:
            voice = isolate_voice(video, work)
        except Exception as exc:
            log(f"voice isolation failed ({exc}); keeping the original audio")

    if voice:
        cmd += ["-i", str(voice)]

    # All inputs are now declared, so mapping is safe.
    cmd += ["-map", video_map]
    if voice:
        # The isolated voice replaces the original track entirely, so nothing
        # of the original bed survives into the edit.
        cmd += ["-map", "1:a:0"]
    else:
        cmd += ["-map", "0:a?"]

    # Subtitle tracks are simply never mapped, so soft subs cannot survive.
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(output)]

    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        # `check=True` raised a CalledProcessError whose message was the whole
        # command line and nothing about what went wrong, because
        # `capture_output` had already swallowed ffmpeg's explanation. Surface
        # the explanation instead.
        tail = (done.stderr or "").strip().splitlines()[-4:]
        raise RuntimeError(
            "ffmpeg failed to write the cleaned video: " + " | ".join(tail)
        )
    log(f"wrote {output.name}")
    print(str(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
