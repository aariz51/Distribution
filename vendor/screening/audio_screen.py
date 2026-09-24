"""Screen complete original audio with Google's YAMNet. Never a guarantee of absence."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from functools import lru_cache

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
sys.path.insert(0, str(Path(__file__).parent / "yamnet"))
import numpy as np

POLICY_VERSION = "original-audio-v3"
RATE = 16000
HOP = 0.48
REJECT_SCORE = 0.20
UNCERTAIN_SCORE = 0.05
MUSIC_CLASSES_SHA256 = "4123c3a65f9e0b42347f8091fa36a8097dd4052b7b751a9e2ccb01d96cf82493"


@lru_cache(maxsize=1)
def music_indices(names):
    # YAMNet outputs independent sigmoid scores. A child need not activate its
    # parent, and ontology descendants are not contiguous in the class map.
    data = (Path(__file__).parent / "music-classes.json").read_bytes()
    if hashlib.sha256(data).hexdigest() != MUSIC_CLASSES_SHA256:
        raise ValueError("Music classifier ontology integrity mismatch")
    manifest = json.loads(data)
    class_map = Path(__file__).parent / "yamnet/yamnet_class_map.csv"
    if hashlib.sha256(class_map.read_bytes()).hexdigest() != manifest["classMapSha256"]:
        raise ValueError("Music classifier vocabulary integrity mismatch")
    import csv
    with class_map.open() as handle:
        classes = list(csv.DictReader(handle))
    if tuple(row["display_name"] for row in classes) != names:
        raise ValueError("Music classifier vocabulary order mismatch")
    selected = {item["id"] for item in manifest["classes"]}
    indices = tuple(i for i, row in enumerate(classes) if row["mid"] in selected)
    if len(indices) != len(selected) or len(indices) != 154:
        raise ValueError("Music classifier ontology is incomplete")
    return indices


def classify_scores(scores, names, start_sec=0.0):
    if scores.ndim != 2 or scores.shape[1] != len(names) or not np.isfinite(scores).all():
        raise ValueError("Invalid music classifier scores")
    indices = music_indices(tuple(names))
    music = scores[:, indices].max(axis=1)
    findings = []
    for index in np.flatnonzero(music >= UNCERTAIN_SCORE):
        class_id = indices[int(np.argmax(scores[index, indices]))]
        findings.append({"startSec": round(start_sec + int(index) * HOP, 3), "endSec": round(start_sec + int(index) * HOP + .975, 3), "score": float(music[index]), "label": names[class_id], "status": "rejected" if music[index] >= REJECT_SCORE else "uncertain"})
    return findings, float(music.max(initial=0))


def screen_audio(video: Path, model_path: Path, expected_duration: float):
    import csv
    import params
    import yamnet
    with (Path(__file__).parent / "yamnet/yamnet_class_map.csv").open() as handle:
        names = [row["display_name"] for row in csv.DictReader(handle)]
    if not model_path.is_file():
        raise ValueError("Music classifier weights are missing; run screening setup")
    weights_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()
    if weights_hash != "13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744":
        raise ValueError("Music classifier weights failed integrity verification")
    model = yamnet.yamnet_frames_model(params.Params())
    model.load_weights(str(model_path))
    metadata = json.loads(subprocess.run([os.environ.get("FFPROBE_BIN", "ffprobe"), "-v", "error", "-show_streams", "-of", "json", str(video)], check=True, capture_output=True, text=True, timeout=120).stdout)
    streams = [stream for stream in metadata["streams"] if stream["codec_type"] == "audio"]
    if not streams:
        raise ValueError("Original has no readable audio track")
    results = []
    for stream in streams:
        channels = int(stream.get("channels", 0))
        if channels < 1 or channels > 8 or abs(float(stream.get("start_time", 0))) > .25:
            raise ValueError("Unsupported audio layout or timeline offset")
        for channel in range(channels):
            results.append(_screen_channel(video, model, names, expected_duration, int(stream["index"]), channel))
    rejected = sum(item["rejectedWindows"] for item in results)
    uncertain = sum(item["uncertainWindows"] for item in results)
    findings = [{**finding, "streamIndex": item["streamIndex"], "channel": item["channel"]} for item in results for finding in item["findings"]][:100]
    return {"status": "rejected" if rejected else "uncertain" if uncertain else "allowed", "policyVersion": POLICY_VERSION, "model": "google/yamnet", "modelSha256": weights_hash, "musicClassesSha256": MUSIC_CLASSES_SHA256, "durationSec": expected_duration, "windows": sum(item["windows"] for item in results), "maxMusicScore": max(item["maxMusicScore"] for item in results), "rejectedWindows": rejected, "uncertainWindows": uncertain, "findings": findings, "thresholds": {"reject": REJECT_SCORE, "uncertain": UNCERTAIN_SCORE}, "coverage": "all-audio-streams-and-channels", "streams": len(streams), "streamLayouts": [{"index": int(stream["index"]), "channels": int(stream["channels"])} for stream in streams], "channels": results}


def _screen_channel(video, model, names, expected_duration, stream_index, channel):
    with tempfile.TemporaryDirectory(prefix="audio-screen-") as scratch:
        pcm = Path(scratch) / "audio.f32"
        subprocess.run([os.environ.get("FFMPEG_BIN", "ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-i", str(video), "-map", f"0:{stream_index}", "-vn", "-af", f"pan=mono|c0=c{channel}", "-ar", str(RATE), "-f", "f32le", str(pcm)], check=True, timeout=3600, capture_output=True)
        samples = pcm.stat().st_size // 4
        duration = samples / RATE
        if duration <= 0 or abs(duration - expected_duration) > max(.25, expected_duration * .001):
            raise ValueError(f"Incomplete audio coverage: {duration:.3f}s versus {expected_duration:.3f}s")
        waveform = np.memmap(pcm, mode="r", dtype="<f4")
        stride = int(30.72 * RATE)  # exactly 64 hops
        extra = int(.975 * RATE)
        findings, maximum, windows = [], 0.0, 0
        rejected = uncertain = 0
        for offset in range(0, samples, stride):
            audio = np.asarray(waveform[offset:min(samples, offset + stride + extra)], dtype=np.float32)
            scores, _, _ = model(audio)
            scores = scores.numpy()[:min(64, int(np.ceil((samples - offset) / (RATE * HOP))))]
            current, score = classify_scores(scores, names, offset / RATE)
            maximum = max(maximum, score)
            windows += len(scores)
            rejected += sum(item["status"] == "rejected" for item in current)
            uncertain += sum(item["status"] == "uncertain" for item in current)
            findings.extend(current[:max(0, 100 - len(findings))])
            print(f"[screen] audio {min(duration, (offset + stride) / RATE):.1f}/{duration:.1f}s", file=sys.stderr, flush=True)
        del waveform
    return {"status": "rejected" if rejected else "uncertain" if uncertain else "allowed", "policyVersion": POLICY_VERSION, "streamIndex": stream_index, "channel": channel, "durationSec": duration, "windows": windows, "maxMusicScore": maximum, "rejectedWindows": rejected, "uncertainWindows": uncertain, "findings": findings, "thresholds": {"reject": REJECT_SCORE, "uncertain": UNCERTAIN_SCORE}, "coverage": "complete-audio"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--model", type=Path, default=Path.home() / ".cache/distribution-screening/yamnet.h5")
    args = parser.parse_args()
    try:
        result = screen_audio(args.video, args.model, args.duration)
    except Exception as error:
        result = {"status": "uncertain", "policyVersion": POLICY_VERSION, "error": str(error)}
    print(json.dumps(result, allow_nan=False))
    return 0 if "error" not in result else 1

if __name__ == "__main__":
    sys.exit(main())
