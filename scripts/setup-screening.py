"""Fetch pinned local screening weights. Install vendor/screening/requirements.txt separately."""
from pathlib import Path
import hashlib
import os
import tempfile
import urllib.request

EXPECTED = "13c3308955bbfaef262f175ac9c40e47b134573a93984f009220dd7cc12a1744"
cache = Path(os.environ.get("SCREENING_MODEL_DIR", str(Path.home() / ".cache/distribution-screening")))
cache.mkdir(parents=True, exist_ok=True)
target = cache / "yamnet.h5"
if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == EXPECTED:
    print("YAMNet weights verified")
else:
    with urllib.request.urlopen("https://storage.googleapis.com/audioset/yamnet.h5", timeout=120) as response:
        data = response.read(20 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != EXPECTED:
        raise RuntimeError("YAMNet download does not match pinned SHA256")
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(data)
    temporary.replace(target)
    print("YAMNet weights installed and verified")

visual_cache = Path(os.environ.get("SCREENING_VISUAL_MODEL_DIR", str(Path.home() / ".cache/autoshorts")))
visual_cache.mkdir(parents=True, exist_ok=True)
models = [
    ("object_detection_yolox_2022nov.onnx", "https://github.com/opencv/opencv_zoo/raw/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx", "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063"),
    ("gender_googlenet.onnx", "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/age_gender/models/gender_googlenet.onnx", "af24a4eaa9eaf70913cc9a337a0387c86f11549cbd9bbc16bffeefcdcf88cbf4"),
]
for name, url, expected in models:
    target = visual_cache / name
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == expected:
        print(f"{name} verified")
        continue
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(100 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(f"Model integrity mismatch: {name}")
    with tempfile.NamedTemporaryFile(dir=visual_cache, delete=False) as handle:
        temporary = Path(handle.name); handle.write(data)
    temporary.replace(target)
    print(f"{name} installed and verified")
