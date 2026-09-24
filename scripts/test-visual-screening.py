import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor/screening'))
from visual_screen import VisualScreen

class VisualPolicy(unittest.TestCase):
    def test_each_person_needs_its_own_face(self):
        screen = VisualScreen.__new__(VisualScreen)
        screen.faces = MagicMock()
        screen.faces.detect.return_value = (None, np.array([[5, 5, 30, 30]]))
        screen.judge_face = lambda *_: ('allowed', None)
        screen.people = lambda _: [(np.array([0, 0, 50, 90]), .9), (np.array([60, 0, 40, 90]), .9)]
        status, reason = screen.judge_frame(np.zeros((100, 100, 3), dtype=np.uint8))
        self.assertEqual(status, 'uncertain'); self.assertIn('separately', reason)
    def test_nan_and_ambiguous_faces_block(self):
        screen = VisualScreen.__new__(VisualScreen)
        screen.gender = MagicMock()
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        screen.gender.forward.return_value = np.array([np.nan, 0])
        with self.assertRaises(ValueError): screen.judge_face(frame, [5, 5, 30, 30])
        screen.gender.forward.return_value = np.array([.55, .45])
        self.assertEqual(screen.judge_face(frame, [5, 5, 30, 30])[0], 'uncertain')
        screen.gender.forward.return_value = np.array([.01, .99])
        self.assertEqual(screen.judge_face(frame, [5, 5, 30, 30])[0], 'rejected')

if __name__ == '__main__': unittest.main()
