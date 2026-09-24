"""Isolated local-model evaluation; never modifies production screening evidence."""
import os
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_NUM_INTRAOP_THREADS", "2")
os.environ.setdefault("TF_NUM_INTEROP_THREADS", "2")
import sys
import json
import hashlib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "storage/tmp/ina-diagnostic-deps"))
from inaSpeechSegmenter import Segmenter

segmenter = Segmenter(vad_engine="smn", detect_gender=False)
results = []
for file in sorted((root / "storage/tmp/audio-semantic-diagnostic").glob("*.wav")):
    segments = segmenter(str(file))
    row = {"file": file.name, "sampleSha256": hashlib.sha256(file.read_bytes()).hexdigest(), "segments": segments}
    print(json.dumps(row), flush=True)
    results.append(row)
model = Path.home() / ".keras/inaSpeechSegmenter/keras_speech_music_noise_cnn.hdf5"
report = {"diagnosticOnly": True, "approvalChanged": False, "packageVersion": "0.8.0", "modelSha256": hashlib.sha256(model.read_bytes()).hexdigest(), "results": results}
(root / "storage/tmp/ina-audio-diagnostic.json").write_text(json.dumps(report, indent=2))
