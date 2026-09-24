"""Original-media gate. JSON-only result on stdout, progress on stderr."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import signal

def _cancel(signum, _frame):
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, _cancel)
signal.signal(signal.SIGINT, _cancel)
from audio_screen import screen_audio
from visual_screen import screen_visual

POLICY_VERSION = "original-media-v3"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--audio-model", type=Path, required=True)
    parser.add_argument("--visual-model-dir", type=Path, required=True)
    parser.add_argument("--face-model", type=Path, required=True)
    args = parser.parse_args()
    report = {"policyVersion": POLICY_VERSION, "status": "uncertain"}
    try:
        with args.video.open("rb") as handle:
            report["contentSha256"] = hashlib.file_digest(handle, "sha256").hexdigest()
        probe = json.loads(subprocess.run([os.environ.get("FFPROBE_BIN", "ffprobe"), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(args.video)], check=True, capture_output=True, text=True, timeout=120).stdout)
        duration = float(probe["format"]["duration"])
        report["audio"] = screen_audio(args.video, args.audio_model, duration)
        if report["audio"]["status"] == "rejected":
            report.update(status="rejected", reason="Music detected in the original audio", visual={"status": "not-run", "reason": "Audio already rejected"})
        elif report["audio"]["status"] != "allowed":
            report.update(status="uncertain", reason="Possible music needs review", visual={"status": "not-run", "reason": "Audio has not passed; source remains blocked"})
        else:
            video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
            frames = int(video.get("nb_frames", "0")) if str(video.get("nb_frames", "0")).isdigit() else 0
            if not frames:
                frames = int(subprocess.run([os.environ.get("FFPROBE_BIN", "ffprobe"), "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(args.video)], check=True, capture_output=True, text=True, timeout=3600).stdout.strip())
            numerator, denominator = map(float, video["avg_frame_rate"].split("/"))
            rotation = next((float(item["rotation"]) for item in video.get("side_data_list", []) if "rotation" in item), float(video.get("tags", {}).get("rotate", 0)))
            if not rotation.is_integer() or int(rotation) % 90 != 0:
                raise ValueError("Unsupported video display rotation")
            report["visual"] = screen_visual(args.video, video["width"], video["height"], numerator / denominator, frames, args.visual_model_dir, args.face_model, int(rotation))
            statuses = [report["audio"]["status"], report["visual"]["status"]]
            report["status"] = "rejected" if "rejected" in statuses else "uncertain" if "uncertain" in statuses else "allowed"
            report["reason"] = report["visual"].get("reason") or ("Possible music needs review" if report["audio"]["status"] == "uncertain" else "No prohibited content detected by the configured models")
    except Exception as error:
        report.update(status="uncertain", reason="Screening could not complete", error=str(error))
    print(json.dumps(report, allow_nan=False))
    return 0

if __name__ == "__main__":
    sys.exit(main())
