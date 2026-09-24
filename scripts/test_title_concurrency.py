"""Regression at the title CLI boundary; encoder interception forces overlap deterministically.

Real media encoding is separately exercised by the SafeChoice verification run.
"""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "vendor/autoshorts-py/assets/title_bar.py"
spec = importlib.util.spec_from_file_location("title_bar", SCRIPT)
title = importlib.util.module_from_spec(spec)
spec.loader.exec_module(title)


class TitleIsolation(unittest.TestCase):
    def invoke(self, source, output, text):
        with patch.object(sys, "argv", [str(SCRIPT), "--video", str(source), "--output", str(output), "--text", text]):
            return title.main()

    def test_overlapping_same_basename_jobs_keep_their_own_overlay(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            for directory in (root / "one", root / "two"):
                directory.mkdir()
                (directory / "flat.mp4").touch()
            observed = []

            def encoder(argv, **kwargs):
                png = Path(argv[argv.index("-filter_complex") - 1])
                before = png.read_bytes()
                observed.append(png)
                if len(observed) == 1:
                    self.invoke(root / "two/flat.mp4", root / "two/out.mp4", "Second product")
                    self.assertTrue(png.exists(), "other job deleted the first job's overlay")
                    self.assertEqual(before, png.read_bytes(), "other job overwrote the first title")
                return subprocess.CompletedProcess(argv, 0)

            with patch.object(title, "probe", return_value=(320, 568, 1)), patch.object(title, "topmost_face", return_value=None), patch.object(title.subprocess, "run", side_effect=encoder), contextlib.redirect_stdout(io.StringIO()):
                self.invoke(root / "one/flat.mp4", root / "one/out.mp4", "First product")
            self.assertNotEqual(observed[0], observed[1])
            self.assertTrue(all(not p.exists() for p in observed), "overlays must be cleaned up")

    def test_encoder_failure_cleans_overlay(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "flat.mp4"
            source.touch()
            observed = []

            def encoder(argv, **kwargs):
                observed.append(Path(argv[argv.index("-filter_complex") - 1]))
                raise subprocess.CalledProcessError(1, argv)

            with patch.object(title, "probe", return_value=(320, 568, 1)), patch.object(title, "topmost_face", return_value=None), patch.object(title.subprocess, "run", side_effect=encoder):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.invoke(source, Path(root) / "out.mp4", "SafeChoice")
            self.assertFalse(observed[0].exists(), "failed encodes must not leak overlays")


if __name__ == "__main__":
    unittest.main()
