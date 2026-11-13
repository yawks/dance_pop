# Dance Pop!

Dance Pop! is a browser-based, cooperative dance game for one or two players. Move in front of a webcam to hit rhythm-synchronized shapes, avoid traps, catch bonus stars, and take part in freeze-dance challenges. Each player can select an independent difficulty level and calibrate their own reach.

The game interface is in **French**. It is designed for a family living room and can also be navigated with a keyboard or a standard gamepad.

## Getting started

1. Download or clone the repository.
2. Download the seven music tracks listed in [Music credits](music/CREDITS.md) from Pixabay and place them in `music/` with the exact filenames listed there. The music files are **not included in this repository**.
3. For direct `file://` use, generate the local playback bundles:

   ```sh
   python3 download_music.py
   ```

   The script uses the MP3 files already on your computer; it does not download them. Alternatively, run `python3 build_local_music.py` to bundle all MP3s in `music/`.

4. Open `dance_pop.html` in a modern browser, or run a local server from the project directory:

   ```sh
   python3 -m http.server 8000
   ```

   Then open <http://localhost:8000/dance_pop.html>.
5. Allow camera access. For the background calibration, leave the camera view empty; then return and stretch your arms for the player calibration. If automatic measurement fails, use the manual height controls.

Camera access may require `localhost` or HTTPS depending on the browser. The game can also be tried with a mouse or touch screen if a camera is unavailable. Browser autoplay restrictions may require a click or key press before music starts.

## How to play

- Select **Solo** or **Duo**, then a difficulty for each player: Discovery, Groove, Super Star, or Mega Star.
- Pick a song and dance for two minutes of music. Shorter tracks loop; brief freeze-dance pauses do not consume music time.
- Hit shapes for points. More valuable shapes are smaller and shorter-lived. Each player gets two high-value stars per round.
- In Super Star and Mega Star, avoid the red-and-black traps. The cooperative score cannot drop below zero.
- During **STATUE!**, stay still for a chance to earn 50 points per visible player. Players whom the camera cannot reliably evaluate receive neither points nor a penalty.
- The results screen shows the team score, accuracy, streaks, stars, traps, and statue bonuses.

Use the arrow keys to navigate and change a selection, **Enter** to confirm, and **Escape** to go back. Standard gamepads can use the directional pad or left stick, **A** to confirm and **B** to go back. Gamepad mappings and browser support may vary.

## Music and credits

The selected tracks are provided by Pixabay contributors. See [music/CREDITS.md](music/CREDITS.md) for titles, artists, filenames, and source links. They are subject to the [Pixabay Content License](https://pixabay.com/service/license-summary/), not a repository-wide software license. Keep your download and license records, and check the terms for your intended use.

The original MP3s and their encoded `music/local/*.js` copies are excluded from GitHub. Pixabay prohibits standalone redistribution of substantially unmodified content; including credits alone does not remove that restriction. Each user should obtain the tracks from Pixabay and generate the bundles locally.

## Development and tests

The game is a self-contained HTML/CSS/JavaScript application; there is no build step or package installation. Python 3 is only needed to generate local audio bundles or run the optional local server. Node.js runs the tests:

```sh
node dance_pop.test.cjs
node dance_pop.browser-test.cjs
node dance_pop.audio-test.cjs
```

The browser and audio tests require Google Chrome; set `CHROME_BIN` if Chrome is installed elsewhere. The audio test uses a trusted keyboard event in an isolated headless Chrome profile and requires the local music files and generated bundles. The browser and automated tests cannot replace testing with your actual webcam, room lighting, display, and players.

## Privacy and limitations

Camera processing and motion analysis run in the browser; the application itself does not upload camera frames to a server. Browser permissions and any hosting environment remain outside the game's control. Calibration uses background subtraction rather than pose tracking and can be affected by lighting, camera movement, clothing, or background activity. Beat and energy maps are approximations rather than manually verified chorus markers.

## License

No software license has been specified for this repository. The music has its own separate license, as described above. Do not assume the repository's code or artwork is licensed for reuse without permission.
