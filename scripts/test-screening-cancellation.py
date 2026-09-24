"""Real decoder cancellation: verify parent termination leaves no decoder child."""
import os
from pathlib import Path
import subprocess
import sys
import time
root = Path(__file__).resolve().parents[1]
program = '''
import sys,json,subprocess
from pathlib import Path
sys.path.insert(0,'vendor/screening')
import source_screen  # installs the same production cancellation handlers
from visual_screen import screen_visual
video=Path('storage/promo/87a4532a-92e7-4408-a6cc-18079b5d948a/out/promo_vertical.mp4')
v=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(video)]))['streams'][0]
n,d=map(float,v['avg_frame_rate'].split('/'))
screen_visual(video,v['width'],v['height'],n/d,int(v['nb_frames']),Path.home()/'.cache/autoshorts',Path('vendor/autoshorts-py/assets/face_detection_yunet_2023mar.onnx'))
'''
if len(sys.argv) > 1 and sys.argv[1] == 'audio':
    program = '''
import sys
from pathlib import Path
sys.path.insert(0,'vendor/screening')
import source_screen
from audio_screen import screen_audio
screen_audio(Path('storage/products/6cc41ef3-7761-4520-b843-361ce1b8bca7/sources/c806bbdb-fcd5-4fa6-bdf3-0d1a65238c0e/original.mp4'),Path.home()/'.cache/distribution-screening/yamnet.h5',211.092608)
'''
process = subprocess.Popen([sys.executable, '-c', program], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
children = []
try:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        result = subprocess.run(['pgrep','-P',str(process.pid)], capture_output=True, text=True)
        for value in result.stdout.split():
            name = subprocess.run(['ps','-p',value,'-o','comm='], capture_output=True, text=True).stdout
            if 'ffmpeg' in name: children.append(int(value))
        if children: break
        if process.poll() is not None: raise RuntimeError('Screening exited before decoder observation')
        time.sleep(.05)
    if not children: raise RuntimeError('No live decoder observed')
    process.terminate(); process.wait(timeout=5)
    for pid in children:
        try: os.kill(pid, 0)
        except ProcessLookupError: continue
        raise RuntimeError(f'Decoder survived parent cancellation: {pid}')
    print('PASS: observed live FFmpeg decoder, cancelled production signal handler, parent and all observed decoders terminated')
finally:
    if process.poll() is None: process.kill(); process.wait()
    for pid in children:
        try: os.kill(pid, 9)
        except ProcessLookupError: pass
