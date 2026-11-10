# Watches a video for /api/cards/:id/watch: downloads it with yt-dlp, transcribes
# the audio with Whisper on CPU, and pulls a handful of evenly spaced frames so
# the vision model can read what's on screen. Prints one JSON object to stdout.
#   python3 watch.py <url> <workdir>
import json, os, subprocess, sys
import numpy as np
import yt_dlp
from faster_whisper import WhisperModel

url, work = sys.argv[1], sys.argv[2]
FRAMES = 8

opts = {
    'quiet': True, 'no_warnings': True, 'noprogress': True, 'noplaylist': True,
    'format': 'b[height<=720][ext=mp4]/b[height<=720]/b',
    'outtmpl': os.path.join(work, 'video.%(ext)s'),
    'max_filesize': 300 * 1024 * 1024,
    'match_filter': yt_dlp.utils.match_filter_func('duration <=? 1200'),
    # YouTube needs a JS runtime to unscramble its stream URLs; the image already has node.
    'js_runtimes': {'node': {}},
}
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info(url)
path = next((os.path.join(work, f) for f in os.listdir(work) if f.startswith('video.')), None)
if not path:
    sys.exit('no video in this post (or it runs over 20 minutes)')

duration = float(subprocess.run(
    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
    capture_output=True, text=True).stdout.strip() or 0)

# Decode with ffmpeg rather than faster-whisper's own PyAV path, which breaks
# whenever PyAV changes its open() signature.
pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
                     capture_output=True).stdout
transcript = ''
if pcm:
    model = WhisperModel(os.environ.get('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8')
    segments, _ = model.transcribe(np.frombuffer(pcm, np.float32), vad_filter=True)
    transcript = ' '.join(s.text.strip() for s in segments)

frames = []
if duration > 0:
    step = duration / FRAMES
    for i in range(FRAMES):
        out = os.path.join(work, f'frame{i}.jpg')
        subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{step * (i + 0.5):.2f}', '-i', path,
                        '-frames:v', '1', '-vf', 'scale=768:-2', '-q:v', '4', out])
        if os.path.exists(out):
            frames.append(out)

print(json.dumps({'title': info.get('title'), 'duration': duration, 'transcript': transcript, 'frames': frames}))
