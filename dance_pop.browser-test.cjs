// Optional real-DOM/layout smoke test. Uses an isolated headless Chrome profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(chrome)) throw new Error('Set CHROME_BIN to a Chrome executable.');
const base = path.join(os.tmpdir(), 'opencode');
fs.mkdirSync(base, { recursive: true });
const directory = fs.mkdtempSync(path.join(base, 'dance-pop-ui-'));
const source = fs.readFileSync(path.join(__dirname, 'dance_pop.html'), 'utf8');

for (const { scenario, width, height } of [
  { scenario: 'setup', width: 1440, height: 1000 },
  { scenario: 'songs', width: 1440, height: 1000 },
  { scenario: 'songs', width: 1280, height: 720 },
  { scenario: 'results', width: 1280, height: 720 },
]) {
  const script = `
    (async () => {
    const report = document.createElement('pre'); report.id = 'test-report'; report.hidden = true;
    document.body.appendChild(report);
    try {
      const check = (value, message) => { if (!value) throw new Error(message); };
      document.getElementById('musicModeSelect').value = 'mute';
      previewTrack = async () => {};
      gameModeSelect.value = 'duo'; updateHUD(); showScreen('setup', 'levelLeft');
      const key = value => document.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
      key('Enter'); check(document.activeElement.id === 'levelRight', 'J1 Enter must advance to J2');
      key('Enter'); check(document.activeElement.id === 'setupNextBtn', 'J2 Enter must advance to song choice');
      check(document.querySelectorAll('.song-card').length === 3, 'Exactly three real song cards');
      const playerCalibration = calibratePlayers();
      check(screen === 'calibration', 'Player calibration opens');
      document.getElementById('calibrationManualBtn').click();
      check(!document.getElementById('manualCalibration').hidden, 'Manual height controls are available');
      check(!document.getElementById('playerPreview').hidden, 'Camera preview remains visible while setting heights');
      document.getElementById('manualLeft').value = '40';
      document.getElementById('manualRight').value = '20';
      document.getElementById('calibrationManualBtn').click();
      check(playerBounds.left.ymin > playerBounds.right.ymin, 'Manual player heights are independent');
      document.getElementById('calibrationOkBtn').click();
      await playerCalibration;
      check(!document.querySelector('kbd'), 'No navigation help is displayed');
      check(!document.getElementById('musicVolume'), 'Volume slider is removed');
      check(!document.getElementById('optionsBtn') && !document.getElementById('optionsPanel'), 'Options menu is removed');
      check(document.getElementById('levelLeft').getBoundingClientRect().height < 95, 'Level block stays compact without instructions');
      showScreen('songs');
      check(!songCards[1].querySelector('.song-details').textContent.includes(TRACKS[selectedTrack].length), 'Song duration is hidden');
      updateTimerDisplay(0); check(document.getElementById('roundTimer').textContent === '2:00', 'Timer starts at two minutes');
      updateTimerDisplay(90); check(document.getElementById('roundTimer').classList.contains('warning'), 'Timer turns orange at 30 seconds');
      updateTimerDisplay(110); check(document.getElementById('roundTimer').classList.contains('urgent'), 'Timer turns red at 10 seconds');
      check(document.activeElement.id === 'selectedSongCard', 'Initial song focus must be centered');
      key('ArrowLeft'); check(selectedTrack === TRACKS.length - 1, 'Cyclic previous track');
      key('ArrowRight'); check(selectedTrack === 0, 'Cyclic next track');
      check(document.activeElement.id === 'selectedSongCard', 'Focus stays centered after navigation');
      check(!availableControls().some(control => control.dataset.slot === '-1' || control.dataset.slot === '1'), 'Side cards must not steal keyboard focus');
      check(getComputedStyle(songCards[0]).maskImage !== 'none', 'Left card has outward fade');
      check(getComputedStyle(songCards[2]).maskImage !== 'none', 'Right card has outward fade');
      key('Enter'); check(document.activeElement.id === 'startBtn', 'Song confirmation advances to bottom button');
      key('ArrowUp'); check(document.activeElement.id === 'selectedSongCard', 'Up returns to carousel');
      const bounds = startBtn.getBoundingClientRect();
      check(bounds.bottom <= innerHeight + 1 && bounds.top >= 0, 'Dance button must remain visible at the bottom');
      const center = songCards[1].getBoundingClientRect();
      check(center.bottom <= bounds.top, 'Bottom button must not cover the selected song');
      check(document.querySelector('.songs-heading').getBoundingClientRect().top >= 0, 'Song heading must not be clipped');
      check(Math.abs(center.left + center.width / 2 - innerWidth / 2) < 5, 'Selected song must be horizontally centered');
      document.getElementById('musicModeSelect').value = 'mute';
      const liveStream = { getVideoTracks: () => [{ readyState: 'live' }] };
      currentStream = liveStream; calibrationComplete = true; playerCalibrationMode = 'duo'; cameraDeviceId = 'active-camera';
      camSelectMenu.replaceChildren(new Option('Refreshed device', 'stale-camera-id'));
      camSelectMenu.value = 'stale-camera-id';
      await beginRound();
      check(screen === 'countdown', 'A selected song must start without recalibrating despite changed dropdown IDs');
      check(currentStream === liveStream && calibrationComplete, 'Live camera and calibration are retained');
      returnToSongs();
      if ('${scenario}' === 'setup') showScreen('setup', 'levelLeft');
      if ('${scenario}' === 'results') {
        showScreen('results', 'resultsOkBtn');
        const labels = [...document.querySelectorAll('.stat-card > span:not(.visually-hidden)')];
        check(labels.length === 10, 'All ten result labels remain visible');
        check(labels.every(label => label.textContent.trim().split(/\\s+/).length <= 2), 'Result labels contain at most two words');
        check(labels.every(label => parseFloat(getComputedStyle(label).fontSize) >= 20), 'Result labels are large enough for TV');
        check(document.querySelectorAll('.stat-card .visually-hidden').length === 10, 'Detailed explanations stay accessible');
        const cards = [...document.querySelectorAll('.stat-card')].map(card => card.getBoundingClientRect());
        check(cards.every(card => card.left >= 0 && card.right <= innerWidth), 'Result cards fit the viewport width');
      }
      report.textContent = 'PASS';
    } catch (error) { report.textContent = 'FAIL: ' + error.stack; }
    })();
  `;
  const html = source.replace('<head>', `<head><base href="${pathToFileURL(__dirname + path.sep).href}">`)
    .replace('</body>', `<script>${script}</script></body>`);
  const fixture = path.join(directory, `${scenario}-${width}x${height}.html`);
  const screenshot = path.join(directory, `${scenario}-${width}x${height}.png`);
  fs.writeFileSync(fixture, html);
  const dom = execFileSync(chrome, [
    '--headless', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${path.join(directory, 'profile')}`, `--window-size=${width},${height}`,
    '--virtual-time-budget=500', '--dump-dom', `--screenshot=${screenshot}`, pathToFileURL(fixture).href,
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const result = dom.match(/<pre id="test-report"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
  if (result !== 'PASS') throw new Error(result || 'Browser test did not finish');
  console.log(`PASS ${scenario}: ${screenshot}`);
}
