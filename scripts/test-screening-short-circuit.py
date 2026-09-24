"""Routing regressions: only a complete audio pass can enter visual screening."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor/screening'))
import source_screen

class GateRouting(unittest.TestCase):
    def run_gate(self, status):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / 'input.mp4'
            video.write_bytes(b'unit-routing-fixture')
            probe = {'format': {'duration': '1'}, 'streams': [{'codec_type': 'video', 'width': 640, 'height': 360, 'nb_frames': '30', 'avg_frame_rate': '30/1'}]}
            output = io.StringIO()
            with patch.object(sys, 'argv', ['source_screen', '--video', str(video), '--audio-model', 'audio', '--visual-model-dir', 'visual', '--face-model', 'face']), patch.object(source_screen.subprocess, 'run') as command, patch.object(source_screen, 'screen_audio', return_value={'status': status}), patch.object(source_screen, 'screen_visual', return_value={'status': 'allowed'}) as visual, contextlib.redirect_stdout(output):
                command.return_value.stdout = json.dumps(probe)
                source_screen.main()
            return json.loads(output.getvalue()), visual.call_count
    def test_uncertain_audio_never_spends_hours_scanning_video(self):
        result, calls = self.run_gate('uncertain')
        self.assertEqual(calls, 0)
        self.assertEqual(result['status'], 'uncertain')
        self.assertEqual(result['visual']['status'], 'not-run')
    def test_rejected_audio_stays_rejected(self):
        result, calls = self.run_gate('rejected')
        self.assertEqual(calls, 0)
        self.assertEqual(result['status'], 'rejected')
    def test_allowed_audio_still_requires_visual_scan(self):
        result, calls = self.run_gate('allowed')
        self.assertEqual(calls, 1)
        self.assertEqual(result['status'], 'allowed')

if __name__ == '__main__': unittest.main()
