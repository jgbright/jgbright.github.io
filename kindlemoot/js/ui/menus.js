// Menu screens: title, hero select, settings, controls, pause and the end screen.

import { HEROES, HERO_IDS, ROLES, ROLE_NAMES, DIFFICULTY, WORLD_TEXT, TEAMS, describe } from '../data/heroes.js';
import { scoreboardHtml } from './hud.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Menus {
  // app: { settings, saveSettings(), audio, on: { play, start(heroId), resume, leave, swap(heroId), again, applySettings } }
  constructor(root, app) {
    this.root = root; this.app = app; this.stack = [];
    root.addEventListener('mouseover', (e) => { if (e.target.closest('button') && e.target.closest('button') !== this.lastHover) { this.lastHover = e.target.closest('button'); app.audio.ui('hover'); } });
    root.addEventListener('click', (e) => { if (e.target.closest('button')) app.audio.ui('click'); });
  }

  show(html, cls) {
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    this.current = cls.split(' ')[0];
    return this.root.firstChild;
  }
  clear() { this.root.innerHTML = ''; this.current = null; }

  title() {
    const s = this.show(`
      <h1 class="logo">${WORLD_TEXT.title}</h1>
      <p class="sub">${WORLD_TEXT.subtitle}</p>
      <div class="intro">${WORLD_TEXT.intro.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      <div class="row">
        <button class="btn primary" data-a="play">Play</button>
        <button class="btn" data-a="controls">Controls</button>
        <button class="btn" data-a="settings">Settings</button>
      </div>
      <p class="home"><a href="../">Back to jgbright.com</a></p>`, 'title');
    s.addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'play') this.app.on.play();
      else if (a === 'controls') this.controls(() => this.title());
      else if (a === 'settings') this.settings(() => this.title());
    });
  }

  // mode: 'new' (before a match) or 'swap' (during a match)
  select(mode, current) {
    const st = this.app.settings;
    let pick = current || st.hero || 'marta';
    const cards = ROLES.map((role) => `<h3>${ROLE_NAMES[role]}</h3>` + HERO_IDS.filter((id) => HEROES[id].role === role).map((id) => {
      const h = HEROES[id];
      return `<button class="card" data-hero="${id}"><span class="face" style="background:linear-gradient(135deg, ${h.color}, ${h.accent})">${h.name[0]}</span><span><b>${esc(h.name)}</b><small>${esc(h.holiday)}</small></span></button>`;
    }).join('')).join('');
    const s = this.show(`
      <header><h2>Choose your Keeper</h2><p>${mode === 'swap' ? 'You can change hero when you are down or in your spawn house.' : 'Six Keepers. Each one keeps a festival.'}</p></header>
      <div class="roster">${cards}</div>
      <div></div>
      <div class="detail panel"></div>
      <footer>
        ${mode === 'new' ? `
        <div class="opt"><span>Enemy skill</span>${Object.keys(DIFFICULTY).map((k) => `<button class="btn small" data-diff="${k}">${DIFFICULTY[k].label}</button>`).join('')}</div>
        <div class="opt"><span>Teams</span><button class="btn small" data-comp="classic" title="Each troupe has one of every Keeper">One of each</button><button class="btn small" data-comp="mixed" title="Bots pick freely. A troupe can have two of the same Keeper.">Mixed</button></div>` : ''}
        <span class="grow"></span>
        <button class="btn" data-a="back">${mode === 'swap' ? 'Cancel' : 'Back'}</button>
        <button class="btn primary" data-a="go">${mode === 'swap' ? 'Change hero' : 'Start match'}</button>
      </footer>`, 'select');
    const detail = s.querySelector('.detail');
    const render = () => {
      const h = HEROES[pick];
      s.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c.dataset.hero === pick));
      s.querySelectorAll('[data-diff]').forEach((b) => b.classList.toggle('on', b.dataset.diff === st.difficulty));
      s.querySelectorAll('[data-comp]').forEach((b) => b.classList.toggle('on', b.dataset.comp === st.comp));
      detail.innerHTML = `
        <h3>${esc(h.name)}</h3>
        <p class="tag">${esc(h.title)} — ${esc(h.tagline)}</p>
        <div class="meta"><span class="chip role">${ROLE_NAMES[h.role]}</span><span class="chip">${esc(h.holiday)}</span><span class="chip">${esc(h.culture)}</span><span class="chip">${h.hp} health</span><span class="chip">${'★'.repeat(h.difficulty)}${'☆'.repeat(3 - h.difficulty)} to learn</span></div>
        <div class="bio">${h.bio.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
        <div class="kit">
          <div><span class="k"><kbd>Mouse 1</kbd></span><span><b>${esc(h.weapon.name)}.</b> ${esc(describe(h.weapon))}</span></div>
          ${h.passive ? `<div><span class="k">Always</span><span><b>${esc(h.passive.name)}.</b> ${esc(describe(h.passive))}</span></div>` : ''}
          <div><span class="k"><kbd>Shift</kbd></span><span><b>${esc(h.abilities[0].name)}.</b> ${esc(describe(h.abilities[0]))} <i>${h.abilities[0].cooldown} s.</i></span></div>
          <div><span class="k"><kbd>E</kbd></span><span><b>${esc(h.abilities[1].name)}.</b> ${esc(describe(h.abilities[1]))} <i>${h.abilities[1].cooldown} s.</i></span></div>
          <div><span class="k"><kbd>Q</kbd></span><span><b>${esc(h.ult.name)} (ultimate).</b> ${esc(describe(h.ult))}</span></div>
        </div>
        <p class="sw"><b>Good:</b> ${esc(h.strength)}</p>
        <p class="sw c"><b>Watch out:</b> ${esc(h.counter)}</p>`;
      this.app.on.preview(pick);
    };
    s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.hero) { pick = b.dataset.hero; this.app.audio.ui('select'); render(); }
      else if (b.dataset.diff) { st.difficulty = b.dataset.diff; this.app.saveSettings(); render(); }
      else if (b.dataset.comp) { st.comp = b.dataset.comp; this.app.saveSettings(); render(); }
      else if (b.dataset.a === 'back') { if (mode === 'swap') this.app.on.swap(null); else { this.app.on.preview(null); this.title(); } }
      else if (b.dataset.a === 'go') { st.hero = pick; this.app.saveSettings(); if (mode === 'swap') this.app.on.swap(pick); else this.app.on.start(pick); }
    });
    render();
  }

  controls(back) {
    const s = this.show(`<div class="panel">
      <h2>Controls</h2>
      <dl class="keys">
        <dt><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd></dt><dd>Move</dd>
        <dt>Mouse</dt><dd>Look</dd>
        <dt><kbd>Space</kbd></dt><dd>Jump</dd>
        <dt><kbd>Mouse 1</kbd></dt><dd>Fire your weapon</dd>
        <dt><kbd>Mouse 2</kbd></dt><dd>Aim down the sight (Tamsin)</dd>
        <dt><kbd>Shift</kbd></dt><dd>First ability</dd>
        <dt><kbd>E</kbd></dt><dd>Second ability</dd>
        <dt><kbd>Q</kbd></dt><dd>Ultimate, when it is full</dd>
        <dt><kbd>R</kbd></dt><dd>Reload</dd>
        <dt><kbd>Tab</kbd></dt><dd>Hold to see the scoreboard</dd>
        <dt><kbd>H</kbd></dt><dd>Change hero (when you are down or in your spawn house)</dd>
        <dt><kbd>Esc</kbd></dt><dd>Pause</dd>
      </dl>
      <p class="note">How to win: stand in the ring around the Year-Fire to capture it. Your troupe's meter fills while you hold the fire. The first troupe to reach 100% wins. Feast plates on the sides of the square give health back.</p>
      <div class="row"><button class="btn" data-a="back">Back</button></div></div>`, 'center dim');
    s.querySelector('[data-a=back]').onclick = back;
  }

  settings(back) {
    const st = this.app.settings;
    const s = this.show(`<div class="panel">
      <h2>Settings</h2>
      <div class="field"><label for="s-sens">Mouse sensitivity</label><input id="s-sens" type="range" min="0.2" max="3" step="0.05" value="${st.sensitivity}"><span class="val"></span></div>
      <div class="field"><label for="s-vol">Volume</label><input id="s-vol" type="range" min="0" max="1" step="0.05" value="${st.volume}"><span class="val"></span></div>
      <div class="field"><label for="s-fov">Field of view</label><input id="s-fov" type="range" min="60" max="95" step="1" value="${st.fov}"><span class="val"></span></div>
      <div class="field"><label>Graphics</label><div class="seg">${['auto', 'low', 'medium', 'high'].map((q) => `<button class="btn small" data-q="${q}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div></div>
      <div class="field"><label>Look up and down</label><div class="seg"><button class="btn small" data-inv="0">Normal</button><button class="btn small" data-inv="1">Inverted</button></div></div>
      <p class="note" id="s-qnote"></p>
      <div class="row"><button class="btn" data-a="back">Back</button></div></div>`, 'center dim');
    const upd = () => {
      s.querySelector('#s-sens').nextElementSibling.textContent = (+st.sensitivity).toFixed(2);
      s.querySelector('#s-vol').nextElementSibling.textContent = Math.round(st.volume * 100) + '%';
      s.querySelector('#s-fov').nextElementSibling.textContent = st.fov + '°';
      s.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === st.quality));
      const auto = this.app.auto;
      s.querySelector('#s-qnote').textContent = (st.quality === 'auto' && auto ? `Auto tested your computer and chose ${auto.q[0].toUpperCase() + auto.q.slice(1)}. ` : '') + 'Low turns off shadows and glow. Use it if the game does not run smoothly.';
      s.querySelectorAll('[data-inv]').forEach((b) => b.classList.toggle('on', (b.dataset.inv === '1') === !!st.invertY));
    };
    s.addEventListener('input', (e) => {
      if (e.target.id === 's-sens') st.sensitivity = +e.target.value;
      if (e.target.id === 's-vol') st.volume = +e.target.value;
      if (e.target.id === 's-fov') st.fov = +e.target.value;
      upd(); this.app.saveSettings(); this.app.on.applySettings();
    });
    s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.q) st.quality = b.dataset.q;
      else if (b.dataset.inv) st.invertY = b.dataset.inv === '1';
      else if (b.dataset.a === 'back') return back();
      upd(); this.app.saveSettings(); this.app.on.applySettings();
    });
    upd();
  }

  pause(canSwap) {
    const s = this.show(`<div class="panel">
      <h2>Paused</h2>
      <p class="note">The match waits for you.</p>
      <div class="row">
        <button class="btn primary" data-a="resume">Resume</button>
        ${canSwap ? '<button class="btn" data-a="swap">Change hero</button>' : ''}
        <button class="btn" data-a="controls">Controls</button>
        <button class="btn" data-a="settings">Settings</button>
        <button class="btn" data-a="leave">Leave match</button>
      </div></div>`, 'center dim');
    s.addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'resume') this.app.on.resume();
      else if (a === 'swap') this.app.on.openSwap();
      else if (a === 'controls') this.controls(() => this.pause(canSwap));
      else if (a === 'settings') this.settings(() => this.pause(canSwap));
      else if (a === 'leave') this.app.on.leave();
    });
  }

  end(sim, me, won) {
    const o = sim.objective;
    const mins = Math.floor(sim.time / 60), secs = String(Math.floor(sim.time % 60)).padStart(2, '0');
    const s = this.show(`<div class="panel">
      <h2>${won ? 'Victory' : 'Defeat'}</h2>
      <p class="result">${won ? `${TEAMS[me.team].name} lights the first day of the new year.` : `${TEAMS[1 - me.team].name} lights the first day. There is always next year.`} Final score ${Math.floor(o.score[0])}% to ${Math.floor(o.score[1])}%, in ${mins}:${secs}.</p>
      ${scoreboardHtml(sim, me)}
      <div class="row">
        <button class="btn primary" data-a="again">Play again</button>
        <button class="btn" data-a="hero">Change hero</button>
        <button class="btn" data-a="menu">Main menu</button>
      </div></div>`, `end center dim ${won ? 'win' : 'loss'}`);
    s.addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'again') this.app.on.again();
      else if (a === 'hero') this.app.on.play();
      else if (a === 'menu') this.app.on.leave();
    });
  }
}
