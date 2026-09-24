"""Failure contract: requested isolation must never fall back to original audio."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("clean_source", Path(__file__).resolve().parents[1] / "vendor/autoshorts-py/assets/clean_source.py")
clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clean)

class CleanFailure(unittest.TestCase):
    def test_missing_caption_dependency_is_not_a_clean_result(self):
        with patch.dict("sys.modules", {"cv2": None}):
            with self.assertRaisesRegex(RuntimeError, "requires OpenCV"):
                clean.detect_caption_band(Path("source.mp4"), 4)

    def test_separator_failure_propagates_without_bandpass(self):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            if "demucs" in command:
                raise subprocess.CalledProcessError(1, command)
            return subprocess.CompletedProcess(command, 0)
        with tempfile.TemporaryDirectory() as work, patch.object(clean.subprocess, "run", side_effect=run):
            with self.assertRaises(subprocess.CalledProcessError):
                clean.isolate_voice(Path("source.mp4"), Path(work))
        self.assertEqual(len(calls), 2)
        self.assertFalse(any("-af" in command for command in calls))

    def test_missing_vocals_is_failure(self):
        with tempfile.TemporaryDirectory() as work, patch.object(clean.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(RuntimeError, "no vocals"):
                clean.isolate_voice(Path("source.mp4"), Path(work))

if __name__ == "__main__":
    unittest.main()
