// Real MP3 decoder + Web Audio integration. No mocked audio or autoplay bypass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode', 'dance-audio-'));
  const chrome = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  const pending = new Map();
  const browserLogs = [];
  let nextId = 0;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      chrome.once('error', reject);
      chrome.stderr.on('data', chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        if (message.method === 'Log.entryAdded') browserLogs.push(message.params.entry.text);
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Log.enable', {}, sessionId);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const waitFor = async (condition, timeout = 5000) => evaluate(`new Promise(resolve => {
      const deadline = performance.now() + ${timeout};
      function check() {
        if (${condition}) resolve(true);
        else if (performance.now() > deadline) resolve(false);
        else setTimeout(check, 40);
      } check();
    })`);
    const key = async (key, code, virtualKey) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey }, sessionId);
    };
    await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, 'dance_pop.html')).href }, sessionId);
    assert.ok(await waitFor(`document.getElementById('welcomeBtn') && document.readyState === 'complete'`));
    await key('ArrowRight', 'ArrowRight', 39); // Real gesture, without leaving welcome.
    assert.ok(await waitFor(`screen === 'welcome' && !menuMusicPlayer.paused && menuMusicPlayer.currentTime > .15 && menuGain && menuGain.gain.value > 0`, 12000), 'Welcome screen plays Dance Music after the first gesture');
    assert.ok(await evaluate(`menuMusicPlayer.currentSrc.startsWith('data:audio/mpeg;base64,')`), 'Standalone menu audio is origin-clean');
    await key('Enter', 'Enter', 13);
    await evaluate(`cameraAttempted = true; cameraFallbackAcknowledged = true;
      cameraDeviceId = camSelectMenu.value; showScreen('songs');`); // Mouse-only session; real audio unchanged.
    const snapshot = () => evaluate(`({ screen, starting, running, previewing,
      context: audioCtx?.state, readyState: musicPlayer.readyState,
      networkState: musicPlayer.networkState, preload: musicPlayer.preload,
      paused: musicPlayer.paused, time: musicPlayer.currentTime, duration: musicPlayer.duration,
      src: musicPlayer.currentSrc.slice(0, 75), error: musicPlayer.error?.message,
      status: document.getElementById('musicStatus').textContent })`);
    const previewPlayed = await waitFor(`previewing && !musicPlayer.paused && musicPlayer.currentTime > musicPlayer.duration / 2 + .15`);
    console.log('Preview:', await snapshot());
    assert.ok(previewPlayed, 'Actual preview must load metadata and play from the midpoint');
    assert.ok(await waitFor('menuMusicPlayer.paused', 3000), 'Menu music fades and stops after the crossfade');
    await evaluate(`globalThis.signalLevel = () => {
      const values = new Float32Array(musicAnalyser.fftSize);
      musicAnalyser.getFloatTimeDomainData(values);
      return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
    }`);
    const signal = await waitFor('signalLevel() > .001');
    console.log('Browser logs:', browserLogs);
    assert.ok(signal, 'Real MP3 decoding produces a nonzero audio signal');
    await evaluate(`focusControl(startBtn)`);
    await key('Enter', 'Enter', 13);
    assert.ok(await waitFor(`screen === 'countdown'`), 'Dance button must enter the countdown');
    assert.ok(await waitFor(`screen === 'playing' && running && musicPlayer.currentTime > .1 && musicPlayer.currentTime < 15`, 10000),
      JSON.stringify(await snapshot()));
    assert.ok(await waitFor('signalLevel() > .001'), 'Gameplay music must also produce audio');
    assert.ok(await waitFor('roundStats.spawned > 0'), 'Real musical energy must spawn gameplay targets');
    console.log('Gameplay:', await snapshot());
    await evaluate('roundStats.elapsed = 38; lastAudioPosition = musicPlayer.currentTime');
    assert.ok(await waitFor('statueState && musicPlayer.paused && !document.getElementById("statueOverlay").hidden'), 'Statue interrupts real playback');
    const statueTime = await evaluate('roundStats.elapsed');
    assert.ok(await waitFor('!statueState && !musicPlayer.paused && document.getElementById("statueOverlay").hidden', 7000), 'Playback resumes after the statue break');
    assert.ok(await evaluate('roundStats.elapsed') - statueTime < .5, 'Statue pause does not consume music time');
    assert.equal(await evaluate('roundStats.statuesEvaluated'), 0, 'Absent camera is not judged');
    await evaluate('roundStats.elapsed = 115; lastAudioPosition = musicPlayer.currentTime');
    assert.ok(await waitFor('previewGain.gain.value > .2 && previewGain.gain.value < .55'), 'Music fades during the final ten seconds');
    await evaluate('returnToSongs()');
    for (let index = 0; index < 4; index++) await key('ArrowRight', 'ArrowRight', 39);
    assert.ok(await waitFor(`selectedTrack === 4 && previewing && !musicPlayer.paused
      && musicPlayer.currentTime > musicPlayer.duration / 2 + .15 && signalLevel() > .001`), 'Rapid selection must play the final selected track, with real audio');
    for (let index = 0; index < 3; index++) await key('ArrowRight', 'ArrowRight', 39);
    assert.ok(await waitFor(`selectedTrack === 0 && previewing && !musicPlayer.paused
      && musicPlayer.currentTime > musicPlayer.duration / 2 + .15 && signalLevel() > .001`, 12000), 'Aurec preview must play');
    assert.equal(await evaluate('trackCredit(TRACKS[selectedTrack])'), 'Aurec · Pixabay Content License');
    await key('ArrowRight', 'ArrowRight', 39);
    assert.ok(await waitFor(`selectedTrack === 1 && previewing && !musicPlayer.paused
      && musicPlayer.currentTime > musicPlayer.duration / 2 + .15 && signalLevel() > .001`, 12000), 'Kulakovka preview must play');
    assert.equal(await evaluate('trackCredit(TRACKS[selectedTrack])'), 'Kulakovka · Pixabay Content License');
    assert.ok(!browserLogs.some(line => line.includes('CORS access restrictions')), 'Standalone audio must not be CORS-muted');
    console.log('PASS: actual MP3 signals, preview midpoint, trusted launch/countdown, gameplay from start, music-driven targets, rapid track selection.');
  } finally {
    for (const request of pending.values()) clearTimeout(request.timeout);
    if (socket) socket.close();
    chrome.kill();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
