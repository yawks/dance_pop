"""Rebuild local playback bundles for Pixabay files downloaded by the user."""
from pathlib import Path
from build_local_music import bundle_track

FILES = [
    'aurec-dance-music-584839.mp3', 'kulakovka-dance-278468.mp3',
    'kulakovka-dance-upbeat-pop-611603.mp3', 'kulakovka-upbeat-funk-614901.mp3',
    'kulakovka-upbeat-energetic-rock-614902.mp3', 'aurec-summer-jazz-611129.mp3',
    'the_mountain-bossa-nova-618207.mp3',
]

if __name__ == '__main__':
    root = Path(__file__).parent / 'music'
    missing = [name for name in FILES if not (root / name).is_file()]
    if missing:
        raise SystemExit('Download the missing Pixabay files into music/:\n' + '\n'.join(missing))
    for name in FILES:
        print(bundle_track(root / name).name)
