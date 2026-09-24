"""Requested voice modes must not silently substitute system speech."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("outro", Path(__file__).resolve().parents[1] / "vendor/autoshorts-py/assets/outro.py")
outro = importlib.util.module_from_spec(spec)
spec.loader.exec_module(outro)

class OutroVoice(unittest.TestCase):
    def test_none_never_runs_voice_process_and_removes_stale_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / "line.wav").write_bytes(b"stale")
            with patch.object(outro.subprocess, "run") as run:
                self.assertIsNone(outro.render_voice(Path("clip"), work, work, "/missing", None, "", "none"))
                run.assert_not_called()
            self.assertFalse((work / "line.wav").exists())

    def test_missing_clone_runtime_is_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            with self.assertRaisesRegex(RuntimeError, "Voice cloning unavailable"):
                outro.render_voice(Path("clip"), work, work, "/missing", None, "Download SafeChoice", "clone")

    def test_failed_clone_never_calls_system_voice(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            for name in ("python", "tts_clone.py", "voice_pick.py"):
                (work / name).touch()
            def run(command, **kwargs):
                if "voice_pick.py" in command[1]:
                    (work / "reference.wav").write_bytes(b"test-reference")
                    return subprocess.CompletedProcess(command, 0)
                raise subprocess.CalledProcessError(1, command)
            with patch.object(outro.subprocess, "run", side_effect=run), patch.object(outro, "system_tts") as fallback:
                with self.assertRaises(subprocess.CalledProcessError):
                    outro.render_voice(Path("clip"), work, work, str(work / "python"), None, "Download SafeChoice", "clone")
                fallback.assert_not_called()

class CloneDiskGuard(unittest.TestCase):
    def test_missing_model_stops_before_download_when_disk_is_low(self):
        spec = importlib.util.spec_from_file_location("tts_clone", Path(__file__).resolve().parents[1] / "vendor/autoshorts-py/assets/tts_clone.py")
        clone = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(clone)
        with patch.object(clone.shutil, "disk_usage", return_value=type("Space", (), {"free": 512 * 1024**2})()):
            with self.assertRaisesRegex(RuntimeError, "cache is incomplete"):
                clone.require_download_space(Path(tempfile.gettempdir()))

if __name__ == "__main__":
    unittest.main()
