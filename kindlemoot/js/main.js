// Kindlemoot entry point: settings, input, the game loop and the screen flow.

import { Sim, DT } from './sim/sim.js';
import { MAP } from './data/map.js';
import { HEROES, HERO_IDS } from './data/heroes.js';
import { GameView } from './render/view.js';
import { GameAudio } from './audio.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';

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
  look.yaw = subject.yaw; look.pitch = 0;
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
  let p;
  try { p = canvas.requestPointerLock(); } catch (e) { p = null; }
  // The lock change event starts the game. If the browser refuses, stay paused.
  if (p && p.catch) p.catch(() => { if (state !== 'playing') menus.pause(canSwap(), LOCK_NOTE); });
}

// Browsers refuse the mouse for about a second after Esc. Tell the player what to do.
const LOCK_NOTE = 'The browser did not give the mouse to the game. Wait a second, then click Resume again.';
document.addEventListener('pointerlockerror', () => { if (state === 'paused' && sim && !NOLOCK) menus.pause(canSwap(), LOCK_NOTE); });

function clearInput() {
  for (const k in keys) keys[k] = false;
  mouse.fire = mouse.alt = false;
  latch.a1 = latch.a2 = latch.ult = latch.reload = latch.jump = false;
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
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
document.addEventListener('mousemove', (e) => {
  if (state !== 'playing' || !human) return;
  if (document.pointerLockElement !== canvas && !(NOLOCK && (e.buttons & 1))) return;
  let k = 0.0013 * settings.sensitivity; // radians for each mouse count at sensitivity 1
  if (human.zoom) k /= human.hero.weapon.zoom;
  look.yaw -= e.movementX * k;
  look.pitch -= e.movementY * k * (settings.invertY ? -1 : 1);
  if (look.pitch > 1.54) look.pitch = 1.54; else if (look.pitch < -1.54) look.pitch = -1.54;
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
};

app.qualityChoice = settings.quality;
applyQuality();
menus.title();
requestAnimationFrame((t) => { last = t; frame(t); document.getElementById('loading').hidden = true; });
