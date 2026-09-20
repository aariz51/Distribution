"""Blur women's faces in a video, leaving men's faces untouched.

Aariz's content must comply with his religious practice, which means a woman's
face should not appear. Discarding any footage containing a woman is what the
B-roll screen does, but that is not an option for the *source* video: the
speaker and their interviewees are the content. So faces are found, classified,
and only the women's are blurred.

Two properties matter more than raw accuracy:

  * Tracking. A face is detected on sampled frames and its box is carried
    across the frames in between, so a blur does not flicker off the moment a
    detection is missed.

  * Erring toward blurring. When the classifier is unsure, the face is blurred.
    A wrongly blurred man is a cosmetic loss; a missed woman defeats the point.

Usage:
  blur_women.py --video IN.mp4 --output OUT.mp4 [--assets DIR] [--report-only]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# Faces are looked for this many times a second. Faces move slowly relative to
# frame rate, so this is ample and keeps a long video tractable.
SAMPLE_FPS = 4.0
# Above this the face is treated as male and left alone. Deliberately high:
# anything less certain gets blurred.
MALE_CONFIDENCE = 0.75
# Detections below this are ignored entirely as noise.
FACE_SCORE_MIN = 0.55
# A blur box is held this many seconds past its last sighting, so brief
# detection gaps do not flash the face back into view.
HOLD_SECONDS = 0.6
# The box is grown by this fraction so hair and jaw are covered too.
BOX_PAD = 0.35

# The same weights the B-roll screen uses. The opencv_zoo path 404s; this is
# the one that actually resolves, and sharing it means one download and one
# behaviour rather than two that can drift apart.
GENDER_MODEL_URL = ("https://github.com/onnx/models/raw/main/validated/vision/"
                    "body_analysis/age_gender/models/gender_googlenet.onnx")


def log(msg: str) -> None:
    print(f"[blur] {msg}", file=sys.stderr, flush=True)


def probe(video: Path) -> tuple[int, int, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-show_entries", "format=duration",
         "-of", "json", str(video)],
        check=True, text=True, capture_output=True).stdout
    d = json.loads(out)
    s = (d.get("streams") or [{}])[0]
    return (int(s.get("width") or 0), int(s.get("height") or 0),
            float((d.get("format") or {}).get("duration") or 0.0))


def cached_model(url: str, name: str) -> str:
    import urllib.request

    base = Path.home() / ".cache" / "autoshorts-models"
    base.mkdir(parents=True, exist_ok=True)
    path = base / name
    if not path.exists():
        log(f"fetching {name}")
        urllib.request.urlretrieve(url, path)
    return str(path)


def detect_women(video: Path, assets: Path, width: int, height: int,
                 duration: float) -> list[dict]:
    """Boxes to blur, each with the window of time it applies to."""
    import cv2
    import numpy as np

    weights = assets / "face_detection_yunet_2023mar.onnx"
    if not weights.exists():
        raise SystemExit(f"face model missing at {weights}")

    detector = cv2.FaceDetectorYN.create(str(weights), "", (320, 320), FACE_SCORE_MIN)
    gender_net = cv2.dnn.readNet(cached_model(GENDER_MODEL_URL, "gender_googlenet.onnx"))

    boxes: list[dict] = []
    step = 1.0 / SAMPLE_FPS
    samples = max(1, int(duration / step))
    # A face filling the frame is outside YuNet's range at full resolution, so
    # the same sweep the title placement uses applies here.
    scales = (720, 480, 320)

    for i in range(samples):
        t = i * step
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video),
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True).stdout
        if not raw:
            continue
        frame = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            continue
        h0, w0 = frame.shape[:2]

        seen: list[tuple[int, int, int, int]] = []
        for target_w in scales:
            if target_w > w0:
                continue
            k = target_w / w0
            small = cv2.resize(frame, (target_w, max(1, int(h0 * k))))
            detector.setInputSize((small.shape[1], small.shape[0]))
            try:
                _, faces = detector.detect(small)
            except Exception:
                continue
            if faces is None:
                continue
            for f in faces:
                if float(f[-1]) < FACE_SCORE_MIN:
                    continue
                x, y, fw, fh = (int(v / k) for v in f[:4])
                if fw < 12 or fh < 12:
                    continue
                # Skip a face already found at a coarser scale.
                if any(abs(x - sx) < fw * 0.5 and abs(y - sy) < fh * 0.5
                       for sx, sy, _, _ in seen):
                    continue
                seen.append((x, y, fw, fh))

                pad = int(max(fw, fh) * 0.25)
                crop = frame[max(0, y - pad):y + fh + pad, max(0, x - pad):x + fw + pad]
                if crop.size == 0:
                    continue
                blob = cv2.dnn.blobFromImage(crop, 1.0, (224, 224), (104, 117, 123),
                                             swapRB=False)
                gender_net.setInput(blob)
                out = gender_net.forward().flatten()
                # This network already outputs probabilities; re-softmaxing
                # would flatten the confidence scale.
                if out.min() < 0.0 or abs(float(out.sum()) - 1.0) > 0.01:
                    e = np.exp(out - out.max())
                    out = e / e.sum()
                male = float(out[0])

                if male >= MALE_CONFIDENCE:
                    continue  # confidently a man: left alone

                # Everything else is blurred, including uncertain faces.
                grow = int(max(fw, fh) * BOX_PAD)
                bx = max(0, int((x - grow) * width / w0))
                by = max(0, int((y - grow) * height / h0))
                bw = min(width - bx, int((fw + 2 * grow) * width / w0))
                bh = min(height - by, int((fh + 2 * grow) * height / h0))
                if bw <= 0 or bh <= 0:
                    continue
                boxes.append({"t": t, "x": bx, "y": by, "w": bw, "h": bh,
                              "male": round(male, 3)})
    return boxes


def merge(boxes: list[dict]) -> list[dict]:
    """Join detections of the same face across time into held windows."""
    merged: list[dict] = []
    for b in sorted(boxes, key=lambda d: d["t"]):
        placed = False
        for m in merged:
            overlap = (abs(m["x"] - b["x"]) < max(m["w"], b["w"]) * 0.6
                       and abs(m["y"] - b["y"]) < max(m["h"], b["h"]) * 0.6)
            if overlap and b["t"] - m["end"] <= HOLD_SECONDS:
                m["end"] = b["t"] + HOLD_SECONDS
                # Track the union, so a moving face stays covered.
                x2 = max(m["x"] + m["w"], b["x"] + b["w"])
                y2 = max(m["y"] + m["h"], b["y"] + b["h"])
                m["x"] = min(m["x"], b["x"])
                m["y"] = min(m["y"], b["y"])
                m["w"] = x2 - m["x"]
                m["h"] = y2 - m["y"]
                placed = True
                break
        if not placed:
            merged.append({**b, "start": max(0.0, b["t"] - 0.2),
                           "end": b["t"] + HOLD_SECONDS})
    return merged


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--output")
    ap.add_argument("--assets", default=str(Path(__file__).parent))
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    if not video.exists():
        raise SystemExit(f"video not found: {video}")
    assets = Path(args.assets).expanduser().resolve()

    width, height, duration = probe(video)
    log(f"scanning {duration:.0f}s at {SAMPLE_FPS:g} fps for faces")
    raw_boxes = detect_women(video, assets, width, height, duration)
    regions = merge(raw_boxes)
    log(f"{len(raw_boxes)} detection(s) -> {len(regions)} region(s) to blur")

    if args.report_only:
        print(json.dumps({"regions": regions}, indent=1))
        return 0

    output = Path(args.output) if args.output else video.with_name(
        f"{video.stem}_blurred.mp4")

    if not regions:
        log("no women detected; copying through")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(video), "-c", "copy", str(output)], check=True)
        print(str(output))
        return 0

    # boxblur has no x/y/w/h -- it blurs the whole frame. A region is blurred
    # by cropping it out, blurring that, and laying it back over the picture,
    # gated with `enable` so it only shows during its own window.
    parts = ["[0:v]split=%d%s" % (len(regions) + 1,
                                  "".join(f"[base{i}]" if i == 0 else f"[src{i}]"
                                          for i in range(len(regions) + 1)))]
    current = "base0"
    for i, r in enumerate(regions, start=1):
        # Radius computed here, not as an ffmpeg expression: boxblur's radius
        # does not accept iw/ih. It also applies to the half-resolution chroma
        # planes, where it must be strictly under min(w,h)/4 -- landing exactly
        # on that bound is rejected, so step one below it.
        radius = max(2, min(r["w"], r["h"]) // 4 - 1)
        parts.append(
            f"[src{i}]crop={r['w']}:{r['h']}:{r['x']}:{r['y']},"
            f"boxblur=luma_radius={radius}:luma_power=3[blur{i}]"
        )
        nxt = f"out{i}"
        parts.append(
            f"[{current}][blur{i}]overlay={r['x']}:{r['y']}:"
            f"enable='between(t,{r['start']:.2f},{r['end']:.2f})'[{nxt}]"
        )
        current = nxt
    graph = ";".join(parts)

    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
        "-filter_complex", graph, "-map", f"[{current}]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart",
        str(output),
    ], check=True, capture_output=True, text=True)
    log(f"blurred {len(regions)} region(s) -> {output.name}")
    print(str(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
