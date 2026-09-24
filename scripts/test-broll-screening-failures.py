"""Fault injection for candidate admission; never supplies production media."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import unittest
import numpy as np
import cv2

assets = Path(__file__).resolve().parents[1] / 'vendor/autoshorts-py/assets'
spec = importlib.util.spec_from_file_location('broll', assets / 'broll_pipeline.py')
broll = importlib.util.module_from_spec(spec)
spec.loader.exec_module(broll)

class FailClosed(unittest.TestCase):
    def screen(self, rejection=None, empty=False, policy='no-women'):
        model = MagicMock()
        model.people.return_value = []
        calls = []
        def judge(frame):
            calls.append(int(frame[0, 0, 0]))
            return ('uncertain', 'unreadable person') if len(calls) == rejection else ('allowed', None)
        model.judge_frame.side_effect = judge
        def run(cmd, **kwargs):
            if cmd[0] == 'ffprobe':
                return SimpleNamespace(stdout='10')
            if not empty:
                for i in range(12):
                    cv2.imwrite(cmd[-1].replace('%08d', f'{i:08d}'), np.full((8,8,3), i, np.uint8))
            return SimpleNamespace(returncode=0)
        with patch.dict('os.environ', {'BROLL_PEOPLE_POLICY': policy}), patch.object(broll, '_strict_screen', return_value=model), patch.object(broll.subprocess, 'run', side_effect=run):
            result = broll.clip_is_allowed(Path('fixture.mp4'), assets, 0, 1)
        return result, calls

    def test_every_original_and_portrait_frame(self):
        result, calls = self.screen()
        self.assertTrue(result[0]); self.assertEqual(calls, list(range(12))*2)

    def test_between_old_samples_rejected(self):
        result, _ = self.screen(rejection=9)
        self.assertFalse(result[0])

    def test_crop_only_failure_rejected(self):
        result, _ = self.screen(rejection=15)
        self.assertFalse(result[0]); self.assertIn('portrait', result[1])

    def test_empty_decode_rejected(self):
        self.assertFalse(self.screen(empty=True)[0][0])

    def test_disabled_policy_cannot_bypass(self):
        self.assertFalse(self.screen(policy='off')[0][0])

if __name__ == '__main__':
    unittest.main()
