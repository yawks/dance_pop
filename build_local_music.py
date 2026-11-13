"""Package MP3 bytes for safe Web Audio playback when opened via file://.

Classic local scripts can deliver data URLs without fetching opaque-origin MP3s.
The recordings themselves are unchanged. HTTP serving continues to use the MP3s.
"""
import base64
import json
from pathlib import Path

ROOT = Path(__file__).parent / 'music'


def bundle_track(source):
    destination = ROOT / 'local' / (source.name + '.js')
    destination.parent.mkdir(exist_ok=True)
    data_url = 'data:audio/mpeg;base64,' + base64.b64encode(source.read_bytes()).decode('ascii')
    destination.write_text(
        'window.dancePopMusicLoaded(' + json.dumps(source.name) + ',' + json.dumps(data_url) + ');\n',
        encoding='ascii',
    )
    return destination


if __name__ == '__main__':
    for source in sorted(ROOT.glob('*.mp3')):
        print(bundle_track(source).name)
