import sys
import unittest
from pathlib import Path
import csv
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "vendor/screening"))
from audio_screen import classify_scores

class AudioPolicy(unittest.TestCase):
    def setUp(self):
        with (Path(__file__).resolve().parents[1] / 'vendor/screening/yamnet/yamnet_class_map.csv').open() as handle:
            self.names = [row['display_name'] for row in csv.DictReader(handle)]
    def test_speech_and_wind_do_not_become_music(self):
        scores = np.zeros((1, len(self.names)))
        scores[0, self.names.index('Speech')] = .9
        scores[0, self.names.index('Wind')] = .9
        findings, maximum = classify_scores(scores, self.names)
        self.assertEqual(findings, []); self.assertEqual(maximum, 0)
    def test_brief_and_quiet_music_retains_time_and_uncertainty(self):
        scores = np.zeros((3, len(self.names)))
        scores[1, self.names.index('Music')] = .4
        scores[2, self.names.index('Background music')] = .06
        findings, _ = classify_scores(scores, self.names, 30.72)
        self.assertEqual([f['status'] for f in findings], ['rejected', 'uncertain'])
        self.assertEqual(findings[0]['startSec'], 31.2)
    def test_invalid_scores_fail(self):
        with self.assertRaises(ValueError): classify_scores(np.full((1, len(self.names)), np.nan), self.names)
        with self.assertRaises(ValueError): classify_scores(np.zeros((1, 3)), self.names)
    def test_independent_music_and_singing_descendants_are_not_ignored(self):
        for name in ('Choir', 'Child singing', 'Synthetic singing', 'Rapping', 'Cowbell'):
            with self.subTest(name=name):
                scores = np.zeros((1, len(self.names)))
                scores[0, self.names.index(name)] = .99
                findings, maximum = classify_scores(scores, self.names)
                self.assertEqual(maximum, .99)
                self.assertEqual(findings[0]['label'], name)
                self.assertEqual(findings[0]['status'], 'rejected')

if __name__ == '__main__': unittest.main()
