"""Conservative per-frame visual screening; apparent presentation is not gender identity."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import subprocess
import cv2
import numpy as np

POLICY_VERSION = "original-visual-v2"


class VisualScreen:
    def __init__(self, models: Path, face_model: Path):
        threads = int(os.environ.get("SCREENING_CV_THREADS", "2"))
        if threads < 1 or threads > 16:
            raise ValueError("SCREENING_CV_THREADS must be between1and16")
        cv2.setNumThreads(threads)
        expected = {
            models / "object_detection_yolox_2022nov.onnx": "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063",
            models / "gender_googlenet.onnx": "af24a4eaa9eaf70913cc9a337a0387c86f11549cbd9bbc16bffeefcdcf88cbf4",
            face_model: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        }
        for file, digest in expected.items():
            if hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                raise ValueError(f"Screening model failed integrity verification: {file.name}")
        self.person = cv2.dnn.readNetFromONNX(str(models / "object_detection_yolox_2022nov.onnx"))
        self.gender = cv2.dnn.readNetFromONNX(str(models / "gender_googlenet.onnx"))
        self.faces = cv2.FaceDetectorYN.create(str(face_model), "", (320, 320), .65)
        grids, strides = [], []
        for stride in (8, 16, 32):
            x, y = np.meshgrid(np.arange(640 // stride), np.arange(640 // stride))
            grid = np.stack((x, y), axis=2).reshape(-1, 2)
            grids.append(grid)
            strides.append(np.full((len(grid), 1), stride))
        self.grid, self.strides = np.concatenate(grids), np.concatenate(strides)
        self.model_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [models / "object_detection_yolox_2022nov.onnx", models / "gender_googlenet.onnx", face_model]}

    def people(self, frame):
        h, w = frame.shape[:2]
        ratio = min(640 / w, 640 / h)
        canvas = np.full((640, 640, 3), 114, dtype=np.uint8)
        resized = cv2.resize(frame, (max(1, int(w * ratio)), max(1, int(h * ratio))))
        canvas[:resized.shape[0], :resized.shape[1]] = resized
        self.person.setInput(cv2.dnn.blobFromImage(canvas, 1, (640, 640), swapRB=True))
        raw = self.person.forward()[0]
        if raw.shape != (8400, 85) or not np.isfinite(raw).all():
            raise ValueError("Invalid person detector output")
        score = raw[:, 4] * raw[:, 5]
        chosen = np.flatnonzero(score >= .15)
        if not len(chosen):
            return []
        center = (raw[chosen, :2] + self.grid[chosen]) * self.strides[chosen]
        size = np.exp(raw[chosen, 2:4]) * self.strides[chosen]
        xywh = np.concatenate((center - size / 2, size), axis=1) / ratio
        if not np.isfinite(xywh).all():
            raise ValueError("Invalid person detection coordinates")
        kept = cv2.dnn.NMSBoxes(xywh.tolist(), score[chosen].tolist(), .15, .4)
        return [(xywh[int(i)], float(score[chosen[int(i)]])) for i in np.asarray(kept).flatten()]

    def judge_face(self, frame, face):
        x, y, w, h = [int(value) for value in face[:4]]
        if min(w, h) < 24:
            return "uncertain", "Face too small to assess"
        pad = int(max(w, h) * .25)
        crop = frame[max(0, y-pad):y+h+pad, max(0, x-pad):x+w+pad]
        if crop.size == 0:
            return "uncertain", "Face is outside readable image area"
        self.gender.setInput(cv2.dnn.blobFromImage(crop, 1, (224, 224), (104, 117, 123), swapRB=False))
        score = self.gender.forward().flatten()
        if len(score) != 2 or not np.isfinite(score).all():
            raise ValueError("Invalid presentation classifier output")
        if score.min() < 0 or abs(float(score.sum()) - 1) > .01:
            score = np.exp(score - score.max()); score /= score.sum()
        if score[1] >= .75:
            return "rejected", "Possible female figure detected"
        if score[0] < .90:
            return "uncertain", "Person's visual presentation is uncertain"
        return "allowed", None

    def judge_frame(self, frame):
        height, width = frame.shape[:2]
        self.faces.setInputSize((width, height))
        _, faces = self.faces.detect(frame)
        faces = [] if faces is None else list(faces)
        for face in faces:
            if not np.isfinite(face).all():
                raise ValueError("Invalid face detector output")
            status, reason = self.judge_face(frame, face)
            if status != "allowed":
                return status, reason
        # Actual decoded person boxes, not a tile cleared by any face in it.
        assigned = set()
        for (x, y, w, h), confidence in self.people(frame):
            if confidence < .35:
                return "uncertain", "Possible person could not be assessed confidently"
            associated = [i for i, f in enumerate(faces) if x <= f[0] + f[2]/2 <= x+w and y <= f[1] + f[3]/2 <= y+h]
            if len(associated) != 1 or associated[0] in assigned:
                return "uncertain", "Person has no separately assessable face or is in a crowd"
            assigned.add(associated[0])
        return "allowed", None


def screen_visual(video: Path, width: int, height: int, fps: float, expected_frames: int, models: Path, face_model: Path, rotation: int = 0):
    detector = VisualScreen(models, face_model)
    if width <= 0 or height <= 0 or fps <= 0 or expected_frames <= 0:
        raise ValueError("Reliable video dimensions/frame coverage unavailable")
    command = [os.environ.get("FFMPEG_BIN", "ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-xerror", "-noautorotate", "-i", str(video), "-map", "0:v:0", "-an", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"]
    import tempfile
    import sys
    with tempfile.TemporaryFile() as error_output:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=error_output)
        count, judged, previous, last_result = 0, 0, None, None
        try:
            while True:
                data = process.stdout.read(width * height * 3)
                if not data:
                    break
                if len(data) != width * height * 3:
                    raise ValueError("Truncated decoded video frame")
                count += 1
                digest = hashlib.sha256(data).digest()
                if digest != previous:
                    frame = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
                    if rotation % 360:
                        frame = np.rot90(frame, (rotation % 360) // 90).copy()
                    last_result = detector.judge_frame(frame)
                    judged += 1
                    previous = digest
                status, reason = last_result
                if status != "allowed":
                    return {"status": status, "reason": reason, "atSec": round((count-1)/fps, 3), "framesDecoded": count, "expectedFrames": expected_frames, "coverage": "stopped-at-finding", "policyVersion": POLICY_VERSION, "modelHashes": detector.model_hashes}
                if count % 120 == 0:
                    print(f"[screen] visual {count}/{expected_frames} frames", file=sys.stderr, flush=True)
            if process.wait(timeout=30) != 0 or count != expected_frames:
                raise ValueError(f"Incomplete visual coverage: {count}/{expected_frames} frames")
            return {"status": "allowed", "framesDecoded": count, "framesInferred": judged, "expectedFrames": expected_frames, "coverage": "every-decoded-frame", "policyVersion": POLICY_VERSION, "modelHashes": detector.model_hashes}
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=30)
            process.stdout.close()
