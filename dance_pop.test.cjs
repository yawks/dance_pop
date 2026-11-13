const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const pixels = new Uint8ClampedArray(160 * 120 * 4);
let silhouette;
const context = new Proxy({
  getImageData: () => ({ data: pixels }),
  createImageData: () => ({ data: new Uint8ClampedArray(pixels.length) }),
  putImageData: image => { silhouette = image.data; },
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
}, { get: (target, key) => target[key] || (() => {}) });
const elements = new Map();
const documentListeners = {};
const timers = [];
let clock = 0;
let cameraRequests = 0;
const cameraTrack = { readyState: 'live', stop() { this.readyState = 'ended'; }, getSettings: () => ({ deviceId: 'mock-camera' }) };
const cameraStream = { getVideoTracks: () => [cameraTrack], getTracks: () => [cameraTrack] };
function element(id) {
  if (!elements.has(id)) {
    const listeners = {};
    const control = {
    id, value: '', style: { setProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(name, handler) { (listeners[name] ||= []).push(handler); }, getContext: () => context,
    removeEventListener(name, handler) { listeners[name] = (listeners[name] || []).filter(item => item !== handler); },
    readyState: 2, appendChild() {}, replaceChildren() {}, setAttribute() {},
    pause() { control.paused = true; }, load() {}, paused: true,
    play: async () => { control.paused = false; }, duration: 200, currentTime: 0,
    focus() { documentStub.activeElement = control; }, scrollIntoView() {},
    getClientRects: () => [{}], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    querySelectorAll: () => [],
    click: () => Promise.all([...(listeners.click || []), ...(control.onclick ? [control.onclick] : [])].map(handler => handler({}))),
    };
    Object.defineProperty(control, 'id', { get: () => id, set: value => { id = value; elements.set(value, control); } });
    elements.set(id, control);
  }
  return elements.get(id);
}
const documentStub = {
  getElementById: element, createElement: () => element(Symbol()), querySelectorAll: () => [],
  addEventListener(name, handler) {
    const previous = documentListeners[name];
    documentListeners[name] = event => { if (previous) previous(event); handler(event); };
  }, activeElement: null,
};
element('gameModeSelect').value = 'solo';
element('viewModeSelect').value = 'silhouette';
element('musicModeSelect').value = 'mute';
element('difficultyLeft').value = 'easy';
element('difficultyRight').value = 'medium';
element('camSelectMenu').value = 'mock-camera';
const sandbox = vm.createContext({
  console, Uint8ClampedArray, Float32Array, Math, Promise,
  window: { innerWidth: 1280, innerHeight: 720, addEventListener() {}, matchMedia: () => ({ matches: false }) },
  document: documentStub,
  navigator: { mediaDevices: { enumerateDevices: async () => [], getUserMedia: async () => { cameraRequests++; return cameraStream; } } },
  performance: { now: () => clock }, requestAnimationFrame() {},
  setTimeout: handler => { timers.push(handler); return handler; },
  clearTimeout: handler => { const index = timers.indexOf(handler); if (index >= 0) timers.splice(index, 1); },
  setInterval, clearInterval,
});
const html = fs.readFileSync(`${__dirname}/dance_pop.html`, 'utf8');
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], sandbox);
const run = source => vm.runInContext(source, sandbox);

assert.equal(run('screen'), 'welcome');
assert.equal(element('hud').hidden, true, 'No gameplay HUD on welcome');
assert.equal(documentStub.activeElement, element('welcomeBtn'));
element('welcomeScreen').querySelectorAll = () => [element('welcomeBtn')];
documentListeners.keydown({ key: 'Enter', preventDefault() {} });
assert.equal(run('screen'), 'setup', 'Enter advances welcome to player setup');
documentListeners.keydown({ key: 'Escape', preventDefault() {} });
assert.equal(run('screen'), 'welcome');

const pad = { mapping: 'standard', buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0, 0] };
sandbox.navigator.getGamepads = () => [pad];
pad.buttons[0].pressed = true;
run('pollGamepad(0)');
assert.equal(run('screen'), 'setup', 'Gamepad A activates the focused button');
run('pollGamepad(16)');
assert.equal(run('screen'), 'setup', 'Held A does not repeatedly activate');
pad.buttons[0].pressed = false;
pad.buttons[1].pressed = true;
run('pollGamepad(32)');
assert.equal(run('screen'), 'welcome', 'Gamepad B navigates back');
sandbox.navigator.getGamepads = () => [];

assert.equal(element('scoreRightBox').hidden, true);
assert.equal(element('scoreLeftLabel').textContent, 'Score solo');
run(`running = true; spawnTarget('solo', 'circle'); targets[0].x = W * 0.8;
  pointerPos = { x: targets[0].x, y: targets[0].y, active: true }; loop(16);`);
assert.equal(run('scoreLeft'), 10, 'Solo hits on the right count toward the solo score');
assert.equal(run('scoreRight'), 0);

function lifetime(fps) {
  run(`resetAudioAnalysis(); targets = []; pointerPos.active = false; running = true;
    nextTargetAt.solo = Infinity; spawnTarget('solo', 'circle'); lastTime = 0;`);
  let frames = 0;
  while (run('targets.length') && frames < fps * 10) {
    frames++;
    run(`loop(${frames * 1000 / fps})`);
  }
  return frames / fps;
}
for (const fps of [30, 60, 144]) {
  assert.ok(Math.abs(lifetime(fps) - 8) < 0.05, `8-second lifetime at ${fps} FPS`);
}

run(`resetAudioAnalysis(); targets = []; nextTargetAt.solo = 0; lastTime = 0;`);
let maxEasyTargets = 0;
for (let frame = 1; frame <= 240; frame++) {
  run(`loop(${frame * 1000 / 60})`);
  maxEasyTargets = Math.max(maxEasyTargets, run('targets.length'));
}
assert.equal(maxEasyTargets, 1, 'Only one gentle target at a time');

element('gameModeSelect').value = 'duo';
run('updateHUD()');
assert.equal(element('scoreRightBox').hidden, false);

assert.equal(element('levelLeftPrevious').hidden, true, 'Easy only offers the next level');
assert.equal(element('levelLeftNext').hidden, false);
assert.equal(element('levelRightPrevious').hidden, false, 'Medium offers both arrows');
assert.equal(element('levelRightNext').hidden, false);
run(`changeDifficulty('left', -1)`);
assert.equal(element('difficultyLeft').value, 'easy', 'No wrap before the first level');
run(`changeDifficulty('left', 1)`);
assert.equal(element('difficultyLeft').value, 'medium');
assert.equal(element('difficultyRight').value, 'medium', 'Other player stays independent');
documentStub.activeElement = element('levelLeftNext');
run(`changeDifficulty('left', 1)`);
assert.equal(element('levelLeftPrevious').hidden, false);
assert.equal(element('levelLeftNext').hidden, false, 'Mega star follows hard');
run(`changeDifficulty('left', 1)`);
assert.equal(element('levelLeftNext').hidden, true, 'Mega star only offers the previous level');
assert.equal(documentStub.activeElement, element('levelLeft'), 'Focus is preserved when an arrow disappears');
run(`changeDifficulty('left', 1)`);
assert.equal(element('difficultyLeft').value, 'mega', 'No wrap after the last level');
element('levelLeft').closest = selector => selector === '.level-picker' ? { dataset: { player: 'left' } } : null;
element('setupScreen').querySelectorAll = () => [element('levelLeft')];
run(`showScreen('setup', 'levelLeft'); navigate('left');`);
assert.equal(element('difficultyLeft').value, 'hard', 'Left/right keys change the focused level');
assert.equal(run('DIFFICULTIES.mega.max'), 8);
assert.ok(run('DIFFICULTIES.mega.gap < DIFFICULTIES.hard.gap'));
assert.equal(run('DIFFICULTIES.mega.starDuration'), 2);
run(`globalThis.savedPhaseFunction = currentMusicPhase; currentMusicPhase = () => 'calm';
  gameModeSelect.value = 'solo'; document.getElementById('difficultyLeft').value = 'hard';
  roundStats = emptyStats(); targets = []; nextTargetAt.solo = 0; musicBeat = true; audioSilent = false; audioEnergy = 0;
  scheduleTargets(1000);`);
assert.ok(run('nextTargetAt.solo <= 1000 + DIFFICULTIES.hard.gap * 1.3 * 1.05 + .001'), 'Calm gaps no longer use the old 1.5 slowdown');
run(`document.getElementById('difficultyLeft').value = 'easy'; targets = []; nextTargetAt.solo = 0; scheduleTargets(1000); scheduleTargets(5000);`);
assert.equal(run('targets.length'), 1, 'Calm Discovery remains limited to one shape');
run(`currentMusicPhase = savedPhaseFunction; gameModeSelect.value = 'duo'; targets = []; roundStats = emptyStats();`);
assert.ok(!run('DIFFICULTIES.easy.trapChance || DIFFICULTIES.medium.trapChance'), 'No traps on easier levels');
assert.ok(run('DIFFICULTIES.mega.trapChance > DIFFICULTIES.hard.trapChance'));
run(`gameModeSelect.value = 'duo'; document.getElementById('difficultyLeft').value = 'easy';
  document.getElementById('difficultyRight').value = 'hard'; targets = []; roundStats = emptyStats();`);
assert.equal(run(`spawnTarget('left', 'trap')`), undefined, 'Easy player never receives traps in mixed duo');
run(`scoreLeft = 100; scoreRight = 10; rainbowTimer = 8; comboEnergy = 50;
  const trap = spawnTarget('right', 'trap'); hitTarget(trap); hitTarget(trap);`);
assert.equal(run('scoreLeft + scoreRight'), 80, 'Trap removes 30 team points, without rainbow multiplier');
assert.equal(run('scoreRight'), 0);
assert.equal(run('roundStats.trapsHit'), 1, 'Penalty applies only once');
assert.equal(run('roundStats.trapPenalty'), 30);
assert.equal(run('roundStats.hits'), 0, 'Trap does not count as a successful hit');
assert.equal(run('roundStats.spawned'), 0, 'Trap does not reduce accuracy');
assert.equal(run('comboEnergy'), 50, 'Trap does not grant combo energy');
assert.ok(run('trapEffect !== null'), 'Trap starts dark failure effect');
run(`targets = []; scoreLeft = 5; scoreRight = 0; const lowScoreTrap = spawnTarget('right', 'trap'); hitTarget(lowScoreTrap);`);
assert.equal(run('scoreLeft + scoreRight'), 0, 'Cooperative score never becomes negative');
assert.equal(run('roundStats.trapPenalty'), 35, 'Statistics reflect actual points deducted');
run(`targets = []; roundStats = emptyStats(); running = true; pointerPos.active = false;
  nextTargetAt.left = Infinity; nextTargetAt.right = Infinity; lastTime = 0; spawnTarget('right', 'trap');`);
for (let frame = 1; frame <= 400; frame++) run(`loop(${frame * 1000 / 60})`);
assert.equal(run('targets.length'), 0);
assert.equal(run('roundStats.misses'), 0, 'Ignoring a trap is not a miss');
assert.equal(run('roundStats.trapsHit'), 0, 'Ignored traps do not cost points');
run(`targets = []; roundStats = emptyStats(); scoreLeft = 0; scoreRight = 0; rainbowTimer = 0;`);
run(`gameModeSelect.value = 'solo'; document.getElementById('difficultyLeft').value = 'mega';
  targets = []; roundStats = emptyStats(); nextTargetAt.solo = 0;
  musicBeat = true; audioSilent = false; scheduleTargets(1000);`);
assert.equal(run('targets.length'), 2, 'Mega star spawns two forms per eligible beat');
run(`gameModeSelect.value = 'duo'; document.getElementById('difficultyLeft').value = 'hard'; targets = []; roundStats = emptyStats();`);

// A shorter child on the left and a taller one on the right, in mirrored video coordinates.
run(`globalThis.testMask = new Uint8Array(PROC_W * PROC_H);
  for (let y = 52; y < 105; y++) for (let x = 15; x < 55; x++) testMask[y * PROC_W + x] = 1;
  for (let y = 15; y < 110; y++) for (let x = 100; x < 150; x++) testMask[y * PROC_W + x] = 1;
  globalThis.measured = estimatePlayerBounds([testMask, testMask, testMask], 'duo');`);
assert.ok(run('measured.left.ymin > measured.right.ymin'), 'Shorter child has a lower reachable top');
assert.ok(run('measured.left.ymin < 52 / PROC_H'), 'Calibrated reachable top includes a jumping/raised-arm allowance');
assert.ok(run('measured.right.ymin < 15 / PROC_H'));
run(`globalThis.noisy = new Uint8Array(testMask);
  for (let i = 0; i < 200; i++) noisy[(i * 97) % noisy.length] = 1;
  globalThis.noisyBounds = estimatePlayerBounds([noisy, noisy, noisy], 'duo');`);
assert.ok(run('noisyBounds && noisyBounds.left.ymin > noisyBounds.right.ymin'), 'Disconnected background noise does not invalidate player detection');
run(`globalThis.overexposed = new Uint8Array(PROC_W * PROC_H); overexposed.fill(1);`);
assert.equal(run(`estimatePlayerBounds([overexposed, overexposed, overexposed], 'duo')`), null, 'Exposure changes fall back to manual calibration');
assert.equal(run(`estimatePlayerBounds([new Uint8Array(PROC_W * PROC_H)], 'duo')`), null, 'Unreliable measurement offers a fallback');
assert.ok(run('DIFFICULTIES.easy.cornerChance < DIFFICULTIES.medium.cornerChance && DIFFICULTIES.medium.cornerChance < DIFFICULTIES.hard.cornerChance && DIFFICULTIES.hard.cornerChance < DIFFICULTIES.mega.cornerChance'));
run(`globalThis.seededRandom = (() => { let seed = 12345; return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; });
  globalThis.cornerCounts = Object.fromEntries(Object.entries(DIFFICULTIES).map(([name, difficulty]) => {
    const random = seededRandom(); let corners = 0;
    for (let i = 0; i < 10000; i++) {
      const p = targetPosition(difficulty, random);
      if ((p.x < .22 || p.x > .78) && (p.y < .22 || p.y > .78)) corners++;
    }
    return [name, corners];
  }));`);
assert.ok(run('cornerCounts.easy < cornerCounts.medium && cornerCounts.medium < cornerCounts.hard && cornerCounts.hard < cornerCounts.mega'), 'Increasing difficulty increasingly favours corners');
run(`globalThis.edgeRandom = (() => { let seed = 23456; return () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646; }; })();
  globalThis.hardEdgeCount = 0;
  for (let i = 0; i < 10000; i++) {
    const p = targetPosition(DIFFICULTIES.hard, edgeRandom);
    if ((p.x <= .08 || p.x >= .92) && (p.y <= .08 || p.y >= .92)) hardEdgeCount++;
  }`);
assert.ok(run('hardEdgeCount > 8000'), 'Super star strongly favours the extreme corners of reachable space');
run(`playerBounds = {}; gameModeSelect.value = 'duo'; document.getElementById('difficultyLeft').value = 'mega';
  document.getElementById('difficultyRight').value = 'mega'; targets = []; roundStats = emptyStats();
  for (let i = 0; i < 200; i++) spawnTarget(i % 2 ? 'right' : 'left', i % 7 ? 'circle' : 'trap');`);
assert.ok(run('targets.length > 2'), 'Several forms can coexist');
assert.ok(run(`targets.every((a, i) => targets.slice(i + 1).every(b => Math.hypot(a.x-b.x, a.y-b.y) >= (a.radius+b.radius)*1.3 - 1e-8))`), 'No active forms overlap across either player');
run(`targets = [{ x: W * .25, y: H * .5, radius: W * 2, kind: 'circle', side: 'right' }];
  roundStats = emptyStats(); globalThis.blockedStar = spawnTarget('left', 'star');`);
assert.equal(run('blockedStar'), undefined, 'A crowded lane defers spawning');
assert.equal(run('roundStats.starBySide.left.spawned'), 0, 'A deferred star is not consumed');
run(`playerBounds = measured; gameModeSelect.value = 'duo'; roundStats = emptyStats(); targets = [];
  for (let i = 0; i < 100; i++) spawnTarget('left', 'circle'); spawnTarget('left', 'star');`);
assert.ok(run('targets.every(t => t.y / H >= measured.left.ymin && t.y / H <= measured.left.ymax)'), 'All shapes including the bonus stay within calibrated child reach');
run(`gameModeSelect.value = 'solo'; document.getElementById('difficultyLeft').value = 'hard';
  playerBounds = { solo: { xmin: .35, xmax: .65, ymin: .3, ymax: .7 } };
  roundStats = emptyStats(); globalThis.soloEdgeHits = 0;
  for (let i = 0; i < 1000; i++) { targets = []; const t = spawnTarget('solo', 'circle');
    if (t.x / W < .15 || t.x / W > .85) soloEdgeHits++; }`);
assert.ok(run('soloEdgeHits > 700'), 'Calibrated solo Super star reaches near screen edges rather than the centre');
run(`gameModeSelect.value = 'duo';`);
run(`playerBounds = {}; targets = []; roundStats = emptyStats();`);
element('setupScreen').querySelectorAll = () => [element('levelLeft'), element('levelRight'), element('setupNextBtn')];
documentListeners.keydown({ key: 'Enter', preventDefault() {} });
assert.equal(documentStub.activeElement, element('levelRight'), 'Duo: Enter on J1 advances to J2');
documentListeners.keydown({ key: 'Enter', preventDefault() {} });
assert.equal(documentStub.activeElement, element('setupNextBtn'), 'Duo: Enter on J2 advances to song choice');
element('gameModeSelect').value = 'solo';
run(`focusControl(document.getElementById('levelLeft')); activateControl();`);
assert.equal(documentStub.activeElement, element('setupNextBtn'), 'Solo skips the second player');
element('gameModeSelect').value = 'duo';
assert.equal(run('songCards.length'), 3, 'Exactly three song cards');
assert.deepEqual(Array.from(run('songCards.map(card => Number(card.dataset.track))')), [6, 0, 1], 'Previous song wraps around');
assert.equal(run('songCards[0].tabIndex'), -1);
assert.equal(run('songCards[1].id'), 'selectedSongCard');
assert.equal(run('songCards[1].tabIndex'), 0);

element('difficultyLeft').value = 'hard';
element('difficultyRight').value = 'easy';
run(`targets = []; spawnTarget('left', 'circle'); spawnTarget('right', 'circle');`);
assert.equal(run('targets[0].duration'), 3.5, 'J1 can use hard difficulty');
assert.equal(run('targets[1].duration'), 8, 'J2 can independently use easy difficulty');
assert.ok(run('targets[1].radius > targets[0].radius'));

// Rarer, more valuable shapes shrink and expire sooner at every difficulty.
for (const level of ['easy', 'medium', 'hard']) {
  element('difficultyLeft').value = level;
  run(`targets = []; roundStats = emptyStats();
    ['circle', 'square', 'diamond', 'triangle'].forEach(kind => spawnTarget('left', kind));`);
  const shapes = Array.from(run('targets'));
  for (let i = 1; i < shapes.length; i++) {
    assert.ok(shapes[i].points > shapes[i - 1].points);
    assert.ok(shapes[i].duration < shapes[i - 1].duration);
    assert.ok(shapes[i].radius < shapes[i - 1].radius);
    assert.ok(run(`TARGET_TYPES.${shapes[i].kind}.weight < TARGET_TYPES.${shapes[i - 1].kind}.weight`));
  }
  const expected = { easy: 6, medium: 4, hard: 2 }[level];
  run(`targets = []; roundStats = emptyStats(); spawnTarget('left', 'star');`);
  assert.equal(run('targets[0].duration'), expected, `Star lifetime for ${level}`);
  assert.equal(run('targets[0].points'), 200);
  assert.ok(run('targets[0].x < W / 2 && targets[0].y < H * .25'));
  for (const fps of [30, 60, 144]) {
    run(`targets = []; roundStats = emptyStats(); resetAudioAnalysis();
      nextTargetAt.left = Infinity; nextTargetAt.right = Infinity;
      pointerPos.active = false; running = true; lastTime = 0; spawnTarget('left', 'star');`);
    let frame = 0;
    while (run('targets.length') && frame < fps * 10) {
      frame++;
      run(`loop(${frame * 1000 / fps})`);
    }
    assert.ok(Math.abs(frame / fps - expected) < .05, `${level} star lasts ${expected}s at ${fps}fps`);
  }
}
element('difficultyLeft').value = 'easy';
element('difficultyRight').value = 'hard';
run(`targets = []; roundStats = emptyStats(); scoreLeft = 0; scoreRight = 0; rainbowTimer = 0;
  spawnTarget('left', 'circle'); scheduleStars(30, 100);`);
assert.equal(run('roundStats.starBySide.left.spawned'), 0, 'A pending star waits for an occupied lane');
assert.equal(run('roundStats.starBySide.right.spawned'), 1, 'Other player gets their star independently');
assert.equal(run('targets.filter(t => t.side === "left").length'), 1);
assert.equal(run('targets.find(t => t.side === "right").duration'), 2);
run(`targets = []; scheduleStars(31, 100);`);
assert.equal(run('roundStats.starBySide.left.spawned'), 1);
run(`targets = []; scheduleStars(70, 100);`);
assert.equal(run('roundStats.starBySide.left.spawned'), 2);
assert.equal(run('roundStats.starBySide.right.spawned'), 2);
assert.ok(run('targets.find(t => t.side === "left").y > H * .75'), 'Second star is placed low');
run(`targets = []; scheduleStars(99, 100);`);
assert.equal(run('targets.length'), 0, 'Never more than two stars per player');
run(`targets = []; roundStats = emptyStats(); scoreLeft = 0; scoreRight = 0; rainbowTimer = 8;
  const firstStar = spawnTarget('left', 'star'); hitTarget(firstStar); hitTarget(firstStar);
  const secondStar = spawnTarget('right', 'star'); hitTarget(secondStar);`);
assert.equal(run('scoreLeft'), 200, 'Star is credited once and not multiplied');
assert.equal(run('scoreRight'), 200);
assert.equal(run('roundStats.starsHit'), 2);
assert.equal(run('roundStats.starPoints'), 400);
assert.equal(run('bonusEffect.points'), 400, 'Simultaneous stars share one flash');
assert.equal(run('roundStats.starBySide.left.hits'), 1);
run(`gameModeSelect.value = 'solo'; targets = []; roundStats = emptyStats();
  scheduleStars(30,100); targets = []; scheduleStars(70,100); targets = []; scheduleStars(90,100);`);
assert.equal(run('roundStats.starBySide.solo.spawned'), 2, 'Solo gets two stars, not four');
element('gameModeSelect').value = 'duo';
run(`targets = []; roundStats = emptyStats(); rainbowTimer = 0;`);

run(`resetAudioAnalysis(); targets = [];
  updateMusicFeatures(0, 0, 0, 1000, 1/60, 120); scheduleTargets(1000);`);
assert.equal(run('musicBeat'), false, 'Silence never emits a beat');
assert.equal(run('targets.length'), 0, 'Silence does not spawn targets');
run(`Object.keys(nextTargetAt).forEach(side => nextTargetAt[side] = 0);
  updateMusicFeatures(.15, .6, .08, 1100, 1/60, 120); scheduleTargets(1100);`);
assert.equal(run('musicBeat'), true, 'Musical attack emits a beat');
assert.equal(run('targets.length'), 2, 'A beat schedules one target per player');
run(`updateMusicFeatures(.15, .6, .08, 1200, 1/60, 120); scheduleTargets(1200);`);
assert.equal(run('musicBeat'), false, 'Beat detection has an anti-double-trigger cooldown');
assert.equal(run('targets.length'), 2);
run(`for (let frame = 0; frame < 120; frame++) updateMusicFeatures(.2, .5, 0, 2000 + frame*16.7, 1/60, 120);`);
const loudEnergy = run('audioEnergy');
run(`for (let frame = 0; frame < 120; frame++) updateMusicFeatures(0, 0, 0, 5000 + frame*16.7, 1/60, 120);`);
assert.ok(run('audioEnergy') < loudEnergy * .01, 'Visual energy fades during silence');
assert.equal(run('audioSilent'), true);
assert.equal(run('TRACKS.length'), 7);
assert.ok(run('TRACKS.every(track => TRACK_ENERGY_MAPS[track.file] && /^[CNR]+$/.test(TRACK_ENERGY_MAPS[track.file]))'), 'Each track has an energy map');
run(`roundStats = emptyStats(); scoreLeft = 0; scoreRight = 0; particles = [];
  globalThis.statueExample = { sides: { left: { observed: 2, moving: .2 }, right: { observed: 2, moving: 1 } } };
  scoreStatue(statueExample); scoreStatue(statueExample);`);
assert.equal(run('scoreLeft + scoreRight'), 50, 'Only the stationary child scores 50 points, once');
assert.equal(run('roundStats.statuesEvaluated'), 2);
assert.equal(run('roundStats.statuesSucceeded'), 1);
assert.equal(run('roundStats.statuePoints'), 50);
assert.equal(run('particles.filter(p => p.star).length'), 150, 'A successful statue explodes into many stars');
assert.equal(run('particles.filter(p => p.confetti && !p.star).length'), 50, 'The celebration also includes confetti');
assert.ok(run('particles.filter(p => p.star).every(p => p.decay <= 1)'), 'Stars remain visible longer than ordinary particles');
run(`roundStats = emptyStats(); scoreLeft = 0; scoreRight = 0;
  scoreStatue({ sides: { left: { observed: 0, moving: 0 }, right: { observed: .2, moving: 0 } } });`);
assert.equal(run('roundStats.statuesEvaluated'), 0, 'Invisible players are not evaluated');
assert.equal(run('scoreLeft + scoreRight'), 0, 'Invisible players neither gain nor lose points');
assert.equal(run('statueResultEffect.unavailable'), 2);
run(`roundStats = emptyStats(); scoreLeft = 0; scoreRight = 0;
  currentStream = { getVideoTracks: () => [{readyState:'live'}] }; bgFrame = new Float32Array(4);
  statueState = { started: 0, sides: { left: { observed: 0, moving: 0 }, right: { observed: 0, moving: 0 } } };
  foregroundMotion = { left: { foreground: 1000, moving: 10, area: 9600 }, right: { foreground: 1000, moving: 400, area: 9600 } };
  for (let i = 0; i < 40; i++) observeStatue(600 + i * 40, .04);
  scoreStatue(statueState);`);
assert.equal(run('roundStats.statuesSucceeded'), 1, 'Motion is assessed independently for each player');
assert.equal(run('scoreLeft'), 50);
assert.equal(run('scoreRight'), 0);
run(`currentStream = null; bgFrame = null; statueState = null; statueResultEffect = null; particles = []; roundStats = emptyStats();`);
assert.equal(run('trackCredit(TRACKS[0])'), 'Aurec · Pixabay Content License');
assert.equal(run('trackCredit(TRACKS[1])'), 'Kulakovka · Pixabay Content License');
assert.equal(run('songDuration()'), 120, 'Every round including external music lasts two minutes');
element('musicModeSelect').value = 'library';
element('musicPlayer').paused = false;
element('musicPlayer').loop = true;
element('musicPlayer').duration = 99;
element('musicPlayer').currentTime = 98.9;
run(`roundStats = emptyStats(); roundStats.elapsed = 98; lastAudioPosition = 98; updateRoundTime(.016);`);
element('musicPlayer').currentTime = .4;
run('updateRoundTime(.016)');
assert.ok(Math.abs(run('roundStats.elapsed') - 99.4) < .0001, 'Short songs continue timing across a loop');
element('musicPlayer').paused = true;
element('musicPlayer').currentTime = 5;
const pausedTime = run('roundStats.elapsed');
run('updateRoundTime(1)');
assert.equal(run('roundStats.elapsed'), pausedTime, 'Paused or buffering audio does not count as play time');
element('musicPlayer').paused = false;
element('musicPlayer').currentTime = 21;
run(`screen = 'playing'; roundStats.elapsed = 119; lastAudioPosition = 19; targets = []; updateRoundTime(.016);`);
assert.equal(run('screen'), 'results', 'Round ends at two minutes');
assert.equal(run('roundStats.elapsed'), 120);
assert.match(element('resultTime').textContent, /2 min 00 s/);
element('musicModeSelect').value = 'mute';
assert.equal(run('TRACKS[6].title'), 'Bossa Nova');
assert.equal(run('TRACKS.some(track => track.title === "Monkeys Spinning Monkeys")'), false);
for (const track of run('TRACKS')) {
  const path = `${__dirname}/music/${track.file}`;
  assert.ok(fs.statSync(path).size > 10000, `${track.title} recording is available locally`);
  const buffer = fs.readFileSync(path);
  assert.ok(buffer.subarray(0, 3).toString() === 'ID3' || (buffer[0] === 255 && (buffer[1] & 224) === 224));
  const bundle = fs.readFileSync(`${__dirname}/music/local/${track.file}.js`, 'utf8').trim();
  const [filename, source] = JSON.parse('[' + bundle.slice('window.dancePopMusicLoaded('.length, -2) + ']');
  assert.equal(filename, track.file);
  assert.ok(Buffer.from(source.split(',')[1], 'base64').equals(buffer), 'Standalone bundle preserves original recording bytes');
}

// Capture an empty background, then introduce a stationary foreground square.
pixels.fill(100);
run('capturingBackground = true; processVideo(); capturingBackground = false; prevFrame = null; processVideo();');
for (let y = 40; y < 80; y++) {
  for (let x = 60; x < 100; x++) {
    const i = (y * 160 + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 200;
  }
}
for (let frame = 0; frame < 180; frame++) run('processVideo()');
const center = (60 * 160 + 80) * 4;
assert.deepEqual(Array.from(silhouette.slice(center, center + 4)), [0, 0, 0, 255],
  'Stationary foreground remains opaque black');
assert.equal(silhouette[3], 0, 'Background remains transparent');

for (const duo of [false, true]) {
  assert.equal(run(`countdownFrame(0, ${duo}).remaining`), 5);
  assert.equal(run(`countdownFrame(1, ${duo}).text`), 'Attention…');
  assert.equal(run(`countdownFrame(2, ${duo}).text`), duo ? 'Prêts ?' : 'Prêt ?');
  assert.equal(run(`countdownFrame(4.99, ${duo}).remaining`), 1);
  assert.equal(run(`countdownFrame(5, ${duo}).text`), duo ? 'Dansez !' : 'Danse !');
}

run(`screen = 'playing'; scoreLeft = 70; scoreRight = 100; targets = [];
  roundStats = { ...emptyStats(), spawned: 20, hits: 15, misses: 5, streak: 2, bestStreak: 6, bonuses: 1, elapsed: 125 }; finishRound();`);
assert.equal(run('screen'), 'results');
assert.equal(element('resultScore').textContent, 170, 'Result combines both players');
assert.equal(element('resultAccuracy').textContent, '75 %');
assert.equal(element('resultStreak').textContent, 6);
assert.equal(element('resultStars').textContent, '0 / 4', 'Duo results use four possible stars');
assert.equal(element('resultStarPoints').textContent, 0);
assert.equal(element('resultTraps').textContent, 0);
assert.equal(element('resultTrapPenalty').textContent, '−0');
element('resultsOkBtn').click();
assert.equal(run('screen'), 'songs', 'Results OK goes to song selection');
run(`showScreen('playing'); running = true;`);
element('menuBtn').click();
assert.equal(run('screen'), 'songs', 'In-song Menu goes to song selection');
assert.equal(run('running'), false);

async function testSessionAndCountdown() {
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  element('musicModeSelect').value = 'library';
  element('musicPlayer').currentTime = 0;
  assert.equal(run('currentMusicPhase()'), 'calm');
  element('musicPlayer').currentTime = 45;
  assert.equal(run('currentMusicPhase()'), 'rush');
  run(`screen = 'playing'; running = true; roundStats = emptyStats(); roundStats.elapsed = 38;
    nextStatueIndex = 0; statueState = null; targets = []; spawnTarget('left', 'circle');
    pointerPos = { x: targets[0].x, y: targets[0].y, active: true };
    lastTime = 1000; lastAudioPosition = 45; updateStatue(1000);`);
  assert.equal(element('musicPlayer').paused, true, 'Music stops for statue');
  assert.equal(element('statueOverlay').hidden, false);
  const progressBeforePause = run('targets[0].progress');
  const timeBeforePause = run('roundStats.elapsed');
  run('loop(2000)');
  assert.equal(run('targets[0].progress'), progressBeforePause, 'Targets do not expire during statue');
  assert.equal(run('roundStats.hits'), 0, 'Movement does not score during statue');
  assert.equal(run('roundStats.elapsed'), timeBeforePause, 'Two minutes of music excludes the statue pause');
  run('updateStatue(4000)');
  await flush();
  assert.equal(run('statueState'), null);
  assert.equal(element('musicPlayer').paused, false, 'Music resumes after statue');
  run('updateStatue(4100)');
  assert.equal(run('nextStatueIndex'), 1, 'A statue break triggers only once');
  run(`running = false; statueState = null; targets = []; pointerPos.active = false;`);
  element('musicModeSelect').value = 'mute';
  await run(`startCamera('mock-camera')`);
  assert.equal(cameraRequests, 1);
  const preparation = run('prepareCameraSession()');
  await flush();
  assert.equal(run('screen'), 'calibration');
  const capture = element('captureBackgroundBtn').click();
  for (let i = 0; i < 6; i++) {
    assert.ok(timers.length, 'Capture countdown timer exists');
    timers.shift()();
    await flush();
    if (run('capturingBackground')) run('processVideo()');
  }
  await capture;
  assert.equal(run('calibrationComplete'), true);
  assert.equal(element('calibrationOkBtn').hidden, false);
  element('calibrationOkBtn').click();
  await flush();
  assert.equal(run('screen'), 'calibration', 'Player measurement follows empty-room calibration');
  element('calibrationSkipBtn').click();
  element('calibrationOkBtn').click();
  await preparation;
  assert.equal(run('screen'), 'songs', 'Calibration OK goes to songs');
  await run('prepareCameraSession()');
  assert.equal(cameraRequests, 1, 'Camera stream is reused for the session');
  assert.equal(run('screen'), 'songs', 'No repeated calibration');
  const measurement = run('calibratePlayers()');
  const measureClick = element('captureBackgroundBtn').click();
  for (let i = 0; i < 4; i++) {
    assert.ok(timers.length, 'Player measurement timer exists');
    timers.shift()();
    await flush();
    if (run('capturingPlayers')) {
      pixels.fill(100);
      for (let y = 50; y < 105; y++) for (let x = 12; x < 55; x++) {
        const p = (y * 160 + x) * 4; pixels[p] = pixels[p + 1] = pixels[p + 2] = 220;
      }
      for (let y = 15; y < 110; y++) for (let x = 100; x < 150; x++) {
        const p = (y * 160 + x) * 4; pixels[p] = pixels[p + 1] = pixels[p + 2] = 220;
      }
      for (let frame = 0; frame < 5; frame++) run('processVideo()');
    }
  }
  await measureClick;
  assert.ok(run('playerBounds.left && playerBounds.right'), 'Successful player measurement stores both zones');
  assert.ok(run('playerBounds.left.ymin > playerBounds.right.ymin'));
  element('calibrationOkBtn').click();
  await measurement;
  const manualMeasurement = run('calibratePlayers()');
  element('calibrationManualBtn').click();
  assert.equal(element('manualCalibration').hidden, false);
  element('manualLeft').value = '38';
  element('manualRight').value = '18';
  element('calibrationManualBtn').click();
  assert.ok(run('playerBounds.left.ymin > playerBounds.right.ymin'), 'Manual calibration stores separate child heights');
  assert.equal(run('playerBounds.left.xmax'), .5);
  assert.equal(run('playerBounds.right.xmin'), .5);
  element('calibrationOkBtn').click();
  await manualMeasurement;
  element('camSelectMenu').value = '';
  assert.equal(await run('prepareCameraSession()'), true, 'An empty refreshed camera select does not invalidate a calibrated live stream');
  assert.equal(cameraRequests, 1);
  clock = 10000;
  await run('beginRound()');
  assert.equal(run('screen'), 'countdown');
  assert.equal(run('running'), false, 'No targets/music before countdown ends');
  assert.equal(element('countdownNumber').textContent, 5);
  run('updateCountdown(14999)');
  assert.equal(run('screen'), 'countdown');
  clock = 15000;
  run('updateCountdown(15000)');
  await flush();
  assert.equal(run('screen'), 'playing');
  assert.equal(run('running'), true);
  assert.equal(cameraRequests, 1, 'Starting a song does not reopen the camera');
  run('returnToSongs()');
  element('camSelectMenu').value = 'stale-enumerated-device-id';
  clock = 20000;
  await run('beginRound()');
  assert.equal(run('screen'), 'countdown');
  assert.equal(cameraRequests, 1, 'A second song still reuses calibration and stream');
  assert.equal(run('calibrationComplete'), true, 'Enumeration drift cannot clear the session calibration');
  run('goBack()');
  assert.equal(run('screen'), 'songs', 'Countdown can be cancelled');
  assert.equal(run('running'), false);
  element('musicModeSelect').value = 'library';
  run(`const originalEnsureAudio = ensureAudio;
    ensureAudio = () => new Promise(resolve => { globalThis.releaseAudio = resolve; });`);
  const pending = run('beginRound()');
  run('goBack()');
  sandbox.releaseAudio();
  await pending;
  assert.equal(run('screen'), 'setup', 'Back cancels asynchronous song preparation');
  assert.equal(run('running'), false, 'A cancelled launch cannot start later');
  run('ensureAudio = originalEnsureAudio;');
  await testPreviews();
  console.log('OK: level validation J1 → J2 → songs, 3-card cyclic carousel, midpoint previews/fade/cancellation, session/camera, gameplay/audio/silhouette regressions.');
}

async function testPreviews() {
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  element('musicPlayer').duration = 200;
  run(`audioCtx = { currentTime: 100 }; musicGain = { gain: { value: .65 } };
    globalThis.automation = [];
    previewGain = { gain: {
      cancelScheduledValues(time) { automation.push(['cancel', time]); },
      setValueAtTime(value, time) { automation.push(['set', value, time]); },
      linearRampToValueAtTime(value, time) { automation.push(['ramp', value, time]); }
    }};
    ensureAudio = async () => {}; selectedTrack = 0; renderTracks(); showScreen('songs');`);
  await flush();
  assert.equal(run('previewing'), true, 'Entering songs starts the preview automatically');
  assert.equal(element('musicPlayer').currentTime, 100, 'Preview starts at the actual midpoint');
  assert.ok(run(`automation.some(event => event[0] === 'set' && event[1] === 1 && event[2] === 110)`), 'Preview stays audible for 10 seconds before fading');
  assert.ok(run(`automation.some(event => event[0] === 'ramp' && event[1] === 0 && event[2] === 111.5)`), 'Fade then reaches silence over 1.5 seconds');
  const firstTimer = run('previewTimer');
  await run('changeSong(-1)');
  assert.equal(run('selectedTrack'), 6, 'Carousel cycles backward');
  assert.deepEqual(Array.from(run('songCards.map(card => Number(card.dataset.track))')), [5, 6, 0]);
  assert.equal(documentStub.activeElement, element('selectedSongCard'), 'Focus stays centered');
  firstTimer();
  assert.equal(run('previewing'), true, 'An old preview timer cannot stop the new preview');
  await run('changeSong(1)');
  assert.equal(run('selectedTrack'), 0, 'Carousel cycles forward');
  run('previewTimer()');
  assert.equal(run('previewing'), false);
  assert.equal(element('musicPlayer').paused, true, 'Preview stops after its fade');
  await run('previewTrack()');
  run('showScreen("setup")');
  assert.equal(run('previewing'), false, 'Leaving songs stops the preview');
  assert.equal(timers.length, 0, 'No preview timers leak across screens');
  await run('playSelectedTrack()');
  assert.equal(element('musicPlayer').currentTime, 0, 'Gameplay starts at the beginning, not at the preview position');
  run('stopAudio()');
  element('musicPlayer').readyState = 0;
  element('musicPlayer').duration = NaN;
  const waiting = run('waitForMusicMetadata()');
  run('stopAudio()');
  assert.equal(await waiting, false, 'Pending preview metadata waits are cancellable');
}
testSessionAndCountdown().catch(error => { console.error(error); process.exitCode = 1; });
