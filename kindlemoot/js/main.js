// Kindlemoot entry point: settings, input, the game loop and the screen flow.

import { Sim, DT } from './sim/sim.js';
import { MAP } from './data/map.js';
import { HEROES, HERO_IDS } from './data/heroes.js';
import { GameView } from './render/view.js';
import { GameAudio } from './audio.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { AimLog, KIND, FLAG } from './aimlog.js';

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');            // test mode: a bot plays your slot
let NOLOCK = params.has('nolock') || AUTO; // test mode: play without pointer lock
const SPEED = Math.max(0.1, Math.min(16, +(params.get('speed') || 1)));

const DEFAULTS = { sensitivity: 1, volume: 0.7, fov: 76, quality: 'auto', invertY: false, difficulty: 'normal', comp: 'classic', hero: 'marta' };
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('kindlemoot.settings') || '{}'); } catch (e) { /* storage can be blocked */ }
  const out = { ...DEFAULTS, ...s };
  if (!HEROES[out.hero]) out.hero = DEFAULTS.hero;
  if (!['auto', 'low', 'medium', 'high'].includes(out.quality)) out.quality = DEFAULTS.quality;
  if (!['easy', 'normal', 'hard'].includes(out.difficulty)) out.difficulty = DEFAULTS.difficulty;
  return out;
}

const canvas = document.getElementById('view');
const hudRoot = document.getElementById('hud');
const settings = loadSettings();
const audio = new GameAudio();
audio.setVolume(settings.volume);
// ?quality=low|medium|high in the address wins over the saved setting, for tests. It is not saved.
const qualityChoice = () => (['low', 'medium', 'high'].includes(params.get('quality')) ? params.get('quality') : settings.quality);
const view = new GameView(canvas, MAP, qualityChoice() === 'auto' ? 'medium' : qualityChoice(), settings.fov);
const hud = new Hud(hudRoot, view, audio);

const app = {
  settings, audio,
  saveSettings() { try { localStorage.setItem('kindlemoot.settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } },
  on: {},
};
const menus = new Menus(document.getElementById('ui'), app);

// "Auto" graphics: time a few frames at each level and keep the best level that
// leaves room for 60 frames each second. The answer is kept for this window size.
const FRAME_BUDGET = 11;
function applyQuality() {
  if (qualityChoice() !== 'auto') { app.auto = null; view.setQuality(qualityChoice()); return; }
  const w = canvas.clientWidth, h = canvas.clientHeight, key = w + 'x' + h;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('kindlemoot.auto') || 'null'); } catch (e) { /* ignore */ }
  if (!saved || saved.key !== key || params.has('retest')) {
    saved = { key, q: 'low', scale: 1, ms: {} };
    for (const q of ['high', 'medium', 'low']) {
      view.setQuality(q);
      const ms = saved.ms[q] = Math.round(view.benchmark(12, w, h) * 10) / 10;
      if (ms < FRAME_BUDGET) { saved.q = q; break; }
      if (q === 'low') saved.scale = Math.max(0.55, Math.min(1, Math.sqrt(FRAME_BUDGET / ms)));
    }
    try { localStorage.setItem('kindlemoot.auto', JSON.stringify(saved)); } catch (e) { /* ignore */ }
  }
  app.auto = saved;
  view.setQuality(saved.q, saved.scale);
}

let state = 'title';      // title | select | playing | paused | swap | ended
let sim = null, human = null, subject = null;
let acc = 0, alpha = 1, last = performance.now();
const look = { yaw: 0, pitch: 0 };
const keys = Object.create(null);
const mouse = { fire: false, alt: false };
const latch = { a1: false, a2: false, ult: false, reload: false, jump: false };
const perf = { fps: 0, ms: 0, frames: 0, t: 0, worst: 0 };
const aim = new AimLog(params.has('aimlog')); // mouse-look telemetry; see aimlog.js
let lockTry = '';    // the pointer-lock request in flight: 'raw', 'plain' or ''
let lockRaw = false; // the lock we hold came from a raw-input request

// Every reset of the view goes through here, so the aim log sees it.
function resetLook(yaw, pitch, reason) {
  const p0 = look.pitch;
  look.yaw = yaw; look.pitch = pitch;
  aim.add(KIND.reset, 0, 0, 0, settings.sensitivity, 0, p0, pitch, yaw, reason);
}

// ----- Match setup ---------------------------------------------------------

function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// A mixed troupe: at least one hero of each role, at most two of the same hero.
function mixedTeam(first, rnd) {
  for (;;) {
    const t = first ? [first] : [];
    while (t.length < 6) {
      const id = HERO_IDS[Math.floor(rnd() * HERO_IDS.length)];
      if (t.filter((x) => x === id).length < 2) t.push(id);
    }
    const roles = new Set(t.map((id) => HEROES[id].role));
    if (roles.size === 3) return t;
  }
}

function startMatch(heroId) {
  const rnd = Math.random;
  const seed = +(params.get('seed') || 0) || Math.floor(rnd() * 1e9);
  const mine = settings.comp === 'mixed' ? mixedTeam(heroId, rnd) : [heroId, ...shuffle(HERO_IDS.filter((x) => x !== heroId), rnd)];
  const theirs = settings.comp === 'mixed' ? mixedTeam(null, rnd) : shuffle(HERO_IDS, rnd);
  sim = new Sim({
    seed, map: MAP,
    teams: [{ heroes: mine, skill: 'normal' }, { heroes: theirs, skill: params.get('diff') || settings.difficulty }],
    human: AUTO ? null : { team: 0, slot: 0 },
  });
  human = sim.human;
  subject = human || sim.ents[0];
  for (const e of sim.ents) { e.px = e.x; e.py = e.y; e.pz = e.z; }
  resetLook(subject.yaw, 0, 'match start');
  view.startMatch(sim, human);
  if (!human) view.spectate = subject;
  hud.start(sim, subject, !human);
  hudRoot.hidden = false;
  menus.clear();
  acc = 0;
  audio.unlock(); audio.setPaused(false); audio.ui('start');
  state = 'paused';
  resume();
}

function leave() {
  audio.setPaused(false);
  view.endMatch(); audio.stopAll();
  sim = human = subject = null;
  hudRoot.hidden = true;
  state = 'title';
  if (document.pointerLockElement) document.exitPointerLock();
  menus.title();
}

function canSwap() {
  if (!human) return false;
  if (!human.alive) return true;
  const r = MAP.spawnRooms[human.team];
  return human.x >= r.x0 && human.x <= r.x1 && human.z >= r.z0 && human.z <= r.z1;
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  audio.setPaused(true);
  clearInput();
  menus.pause(canSwap());
}

function resume() {
  if (!sim || sim.over) return;
  const go = () => { state = 'playing'; menus.clear(); audio.setPaused(false); last = performance.now(); };
  if (NOLOCK) return go();
  if (document.pointerLockElement === canvas) return go();
  // Ask for raw mouse input first. Without it, the OS adds pointer acceleration,
  // and Chrome on Windows sometimes sends one huge jump in movementY, which
  // throws the view to straight up or straight down. If the browser cannot give
  // raw input, ask again for a plain lock.
  const refused = (err) => {
    lockTry = ''; logLockError('plain refused: ' + (err && err.name));
    if (state !== 'playing') menus.pause(canSwap(), LOCK_NOTE);
  };
  const plain = (err) => {
    logLockError('raw refused: ' + (err && err.name));
    lockTry = 'plain';
    let q;
    try { q = canvas.requestPointerLock(); } catch (e) { return refused(e); }
    if (q && q.catch) q.catch(refused);
  };
  lockTry = 'raw';
  let p;
  try { p = canvas.requestPointerLock({ unadjustedMovement: true }); } catch (e) { return plain(e); }
  // The lock change event starts the game. If the browser refuses, stay paused.
  if (p && p.catch) p.catch(plain);
  else lockTry = 'old'; // an old browser: no promise, and it ignores the option; the lock events tell the rest
}

// Browsers refuse the mouse for about a second after Esc. Tell the player what to do.
const LOCK_NOTE = 'The browser did not give the mouse to the game. Wait a second, then click Resume again.';
function logLockError(reason) { aim.add(KIND.lockError, 0, 0, 0, settings.sensitivity, 0, look.pitch, look.pitch, look.yaw, reason); }
document.addEventListener('pointerlockerror', () => {
  logLockError('event');
  // While a promise answer is due, that answer shows the note (and a refused raw request is asked again).
  if (lockTry !== 'raw' && lockTry !== 'plain' && state === 'paused' && sim && !NOLOCK) menus.pause(canSwap(), LOCK_NOTE);
});

function clearInput() {
  for (const k in keys) keys[k] = false;
  mouse.fire = mouse.alt = false;
  latch.a1 = latch.a2 = latch.ult = latch.reload = latch.jump = false;
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) { lockRaw = lockTry === 'raw'; lockTry = ''; motion.avg = 0; motion.last = 0; motion.dropped = 0; }
  aim.add(locked ? KIND.lock : KIND.unlock, lockRaw ? FLAG.raw : 0, 0, 0, settings.sensitivity, 0, look.pitch, look.pitch, look.yaw, locked ? (lockRaw ? 'raw' : 'plain') : '');
  if (locked) {
    if ((state === 'paused' || state === 'swap') && sim && !sim.over) { state = 'playing'; menus.clear(); audio.setPaused(false); last = performance.now(); }
  } else if (state === 'playing' && !NOLOCK) pause();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing' && !AUTO) { if (document.pointerLockElement) document.exitPointerLock(); else pause(); } });

app.on.play = () => { audio.unlock(); state = 'select'; if (sim) { view.endMatch(); sim = human = subject = null; hudRoot.hidden = true; } menus.select('new'); };
app.on.preview = (id) => { if (!sim) view.showHero(id); };
app.on.start = (id) => startMatch(id);
app.on.resume = resume;
app.on.leave = leave;
app.on.again = () => startMatch(settings.hero);
app.on.openSwap = () => { state = 'swap'; menus.select('swap', human.heroId); };
app.on.swap = (id) => {
  if (id && human && id !== human.heroId && canSwap()) sim.setHero(human, id);
  state = 'paused';
  resume();
  if (state !== 'playing') menus.pause(canSwap());
};
app.on.applySettings = () => {
  audio.setVolume(settings.volume);
  view.setFov(settings.fov);
  if (settings.quality !== app.qualityChoice) { app.qualityChoice = settings.quality; applyQuality(); }
};

// ----- Input ---------------------------------------------------------------

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyR', 'Tab', 'KeyH', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
window.addEventListener('keydown', (e) => {
  if (state !== 'playing') {
    if (e.code === 'Escape' && state === 'paused' && NOLOCK) resume();
    return;
  }
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  switch (e.code) {
    case 'ShiftLeft': case 'ShiftRight': latch.a1 = true; break;
    case 'KeyE': latch.a2 = true; break;
    case 'KeyQ': latch.ult = true; break;
    case 'KeyR': latch.reload = true; break;
    case 'Space': latch.jump = true; break;
    case 'Tab': hud.showTab(true); break;
    case 'KeyH': if (canSwap()) { app.on.openSwap(); if (document.pointerLockElement) document.exitPointerLock(); } break;
    case 'Escape': if (NOLOCK) pause(); break;
  }
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') hud.showTab(false);
});
window.addEventListener('blur', clearInput);
canvas.addEventListener('mousedown', (e) => {
  if (state !== 'playing') return;
  if (e.button === 0) mouse.fire = true; else if (e.button === 2) mouse.alt = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.fire = false; else if (e.button === 2) mouse.alt = false; });
window.addEventListener('contextmenu', (e) => { if (state === 'playing') e.preventDefault(); });
// Mouse look. A browser can send one sudden jump in a move: much larger than
// the moves just before it, and never twice in a row. Such a move is dropped.
// A real fast flick grows over several moves and goes on, so it passes: the
// second large move in a row always counts.
const PITCH_MAX = 1.54;
const SPIKE_MIN = 250;  // mouse counts in one move; smaller moves always count
const SPIKE_RATIO = 6;  // ... and a drop needs this many times the recent size
const motion = { avg: 0, last: 0, dropped: 0 };
document.addEventListener('mousemove', (e) => {
  if (state !== 'playing' || !human) return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && !(NOLOCK && (e.buttons & 1))) return;
  const dx = e.movementX, dy = e.movementY, sens = settings.sensitivity;
  const wz = human.hero.weapon.zoom, zoom = human.zoom && wz > 0 ? wz : 1;
  const inv = settings.invertY ? -1 : 1;
  const k = (0.0013 * sens) / zoom; // radians for each mouse count; 0.0013 at sensitivity 1
  let flags = (locked ? FLAG.locked : FLAG.drag) | (locked && lockRaw ? FLAG.raw : 0) | (zoom !== 1 ? FLAG.zoom : 0) | (inv < 0 ? FLAG.invertY : 0);
  const p0 = look.pitch;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(k)) {
    aim.add(KIND.move, flags | FLAG.notFinite, dx, dy, sens, k, p0, p0, look.yaw);
    return;
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  if (e.timeStamp - motion.last > 100) motion.avg = 0; // the mouse was at rest
  motion.last = e.timeStamp;
  const spike = size > SPIKE_MIN && size > SPIKE_RATIO * Math.max(motion.avg, 20) && !motion.dropped;
  motion.avg += (size - motion.avg) * 0.3;
  if (spike) {
    motion.dropped = 1;
    aim.add(KIND.move, flags | FLAG.spike, dx, dy, sens, k, p0, p0, look.yaw);
    return;
  }
  motion.dropped = 0;
  look.yaw -= dx * k;
  let p = p0 - dy * k * inv;
  if (p > PITCH_MAX) { p = PITCH_MAX; flags |= FLAG.clampUp; } else if (p < -PITCH_MAX) { p = -PITCH_MAX; flags |= FLAG.clampDown; }
  look.pitch = p;
  aim.add(KIND.move, flags, dx, dy, sens, k, p0, p, look.yaw);
});
window.addEventListener('resize', () => view.resize());

function fillCmd() {
  const c = human.cmd;
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const s = Math.sin(look.yaw), co = Math.cos(look.yaw);
  c.moveX = -s * f + co * r; c.moveZ = -co * f - s * r;
  c.yaw = look.yaw; c.pitch = look.pitch;
  c.jump = !!keys.Space || latch.jump;
  c.fire = mouse.fire; c.alt = mouse.alt;
  c.a1 = latch.a1; c.a2 = latch.a2; c.ult = latch.ult; c.reload = latch.reload;
  latch.a1 = latch.a2 = latch.ult = latch.reload = latch.jump = false;
}

// ----- Loop ----------------------------------------------------------------

function onEnd() {
  state = 'ended';
  hud.showTab(false);
  if (document.pointerLockElement) document.exitPointerLock();
  const won = sim.winner === subject.team, s = sim, me = subject;
  setTimeout(() => { if (sim === s && state === 'ended') { menus.end(s, me, won); audio.ui(won ? 'win' : 'lose'); } }, 1600);
}

function frame(t) {
  requestAnimationFrame(frame);
  const raw = (t - last) / 1000;
  const dt = Math.min(0.1, Math.max(0, raw));
  last = t;
  perf.frames++; perf.t += raw; if (raw > perf.worst) perf.worst = raw;
  if (perf.t >= 1) { perf.fps = perf.frames / perf.t; perf.ms = (perf.t / perf.frames) * 1000; perf.worstMs = perf.worst * 1000; perf.frames = 0; perf.t = 0; perf.worst = 0; }

  if (state === 'playing' && sim) {
    acc += dt * SPEED;
    let steps = 0;
    const max = Math.ceil(8 * SPEED);
    while (acc >= DT && steps < max && !sim.over) {
      if (human) fillCmd();
      for (const e of sim.ents) { e.px = e.x; e.py = e.y; e.pz = e.z; }
      sim.step();
      for (const ev of sim.events) {
        view.onEvent(ev); hud.event(ev); audio.event(ev, sim, subject);
        if (ev.t === 'end') onEnd();
      }
      sim.events.length = 0;
      acc -= DT; steps++;
    }
    if (steps >= max) acc = 0;
    alpha = Math.min(1, acc / DT);
  }
  if (subject) audio.setListener(subject.x, subject.y + 1.6, subject.z, human ? look.yaw : subject.yaw);
  view.frame(dt, alpha, human && state !== 'ended' ? look : null);
  if (sim) { hud.frame(state === 'playing' ? dt : 0, human ? look : null); audio.frame(dt, sim, subject); }
}

// Test and debug access. The balance tools do not use this; browser checks do.
window.__km = {
  get sim() { return sim; }, get state() { return state; }, get human() { return human; }, get subject() { return subject; },
  view, hud, audio, settings, perf, app, look, keys, mouse, latch,
  start: (id) => startMatch(id || settings.hero), pause, resume, leave,
  bench: (frames, w, h) => view.benchmark(frames, w, h),
  set noLock(v) { NOLOCK = !!v; }, // lets a browser test drive the player without pointer lock
  aim: {
    log: aim,
    summary: () => aim.summary({
      lockMode: document.pointerLockElement === canvas ? (lockRaw ? 'raw' : 'plain') : 'none',
      sensitivity: settings.sensitivity, invertY: settings.invertY, dpr: devicePixelRatio, pitch: look.pitch,
    }),
    dump: (n) => aim.dump(n), text: (n) => aim.text(n), clear: () => aim.clear(),
  },
};

app.qualityChoice = settings.quality;
applyQuality();
menus.title();
requestAnimationFrame((t) => { last = t; frame(t); document.getElementById('loading').hidden = true; });
