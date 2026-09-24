"""Verify real rotation-tagged media is presented to inference without scrambling."""
from pathlib import Path
from unittest.mock import patch
import json
import subprocess
import sys
import tempfile
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor/screening'))
from visual_screen import screen_visual
root = Path(__file__).resolve().parents[1]
source = root / 'storage/promo/87a4532a-92e7-4408-a6cc-18079b5d948a/out/promo_vertical.mp4'
with tempfile.TemporaryDirectory() as scratch:
    frame_file = Path(scratch) / 'frame.mp4'
    subprocess.run(['ffmpeg','-v','error','-i',str(source),'-ss','5','-map','0:v:0','-frames:v','1','-an','-c:v','libx264',str(frame_file)], check=True)
    rotated = Path(scratch) / 'rotated.mp4'
    subprocess.run(['ffmpeg','-v','error','-display_rotation','90','-i',str(frame_file),'-map','0:v:0','-frames:v','1','-an','-c:v','copy',str(rotated)], check=True)
    metadata = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(rotated)]))['streams'][0]
    rotation = int(next(item['rotation'] for item in metadata['side_data_list'] if 'rotation' in item))
    expected = subprocess.check_output(['ffmpeg','-v','error','-i',str(rotated),'-frames:v','1','-f','rawvideo','-pix_fmt','bgr24','pipe:1'])
    captured = []
    class Observer:
        model_hashes = {}
        def __init__(self, *_): pass
        def judge_frame(self, frame):
            captured.append(frame.copy())
            return 'allowed', None
    n, d = map(float, metadata['avg_frame_rate'].split('/'))
    with patch('visual_screen.VisualScreen', Observer):
        report = screen_visual(rotated, metadata['width'], metadata['height'], n/d, int(metadata['nb_frames']), Path('.'), Path('.'), rotation)
    expected_image = np.frombuffer(expected, dtype=np.uint8).reshape(captured[0].shape)
    difference = np.abs(captured[0].astype(float) - expected_image)
    # FFmpeg rotates YUV before RGB conversion; NumPy rotates decoded RGB.
    # Chroma conversion rounding can differ by2levels without geometry changing.
    if report['status'] != 'allowed' or len(captured) != 1 or difference.max() > 3 or difference.mean() > .6 or expected_image.std() < 10:
        raise RuntimeError(f'Rotated geometry mismatch: mean={difference.mean()}, max={difference.max()}')
    print(f'PASS: real SafeChoice rotation={rotation} frame matches display orientation within chroma rounding, dimensions={captured[0].shape[:2]}, max pixel difference={difference.max()}')
