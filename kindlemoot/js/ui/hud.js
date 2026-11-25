// The in-match display: objective, health, abilities, crosshair, hit feedback,
// damage numbers, name plates, kill feed and the scoreboard.

import { RULES, TEAMS, ROLE_NAMES } from '../data/heroes.js';

const FLAME = '<svg viewBox="0 0 24 24"><path d="M12 2c1 4 5 5.500 5 10.500A5 5 0 0 1 7 12.500c0-2 1-3 1.500-4.500C10 9.500 11 6 12 2zm0 11c-1.200 1.400-2 2.300-2 3.600a2 2 0 0 0 4 0c0-1.300-.800-2.200-2-3.600z"/></svg>';
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function scoreboardHtml(sim, me) {
  let h = '<table class="board"><tr><th>Hero</th><th>Role</th><th>Stops</th><th>Falls</th><th>Assists</th><th>Damage</th><th>Healing</th></tr>';
  for (const t of [0, 1]) {
    h += `<tr class="team"><td colspan="7" class="t${t}">${TEAMS[t].name} — ${Math.floor(sim.objective.score[t])}%</td></tr>`;
    for (const e of sim.ents) {
      if (e.team !== t || e.decoy) continue;
      const s = e.stats;
      h += `<tr class="${e === me ? 'row-me' : ''} ${e.alive ? '' : 'row-dead'}"><td>${esc(e.name)}${e === me ? ' (you)' : ''}</td><td>${ROLE_NAMES[e.hero.role]}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.assists}</td><td>${Math.round(s.damage)}</td><td>${Math.round(s.healing)}</td></tr>`;
    }
  }
  return h + '</table>';
}

export class Hud {
  constructor(root, view, audio) {
    this.root = root; this.view = view; this.audio = audio;
    root.innerHTML = `
      <div class="vig base"></div><div class="vig night"></div><div class="vig low"></div><div class="vig hurt"></div><div class="vig heal"></div>
      <div class="scope"></div>
      <div class="plates"></div><div class="dmgs"></div>
      <div class="obj">
        <div class="side dawn"><span class="pct t0">0%</span><div class="bar"><i></i></div></div>
        <div class="flame">${FLAME}</div>
        <div class="side dusk"><span class="pct t1">0%</span><div class="bar"><i></i></div></div>
        <div class="msg"></div>
      </div>
      <div class="feed"></div>
      <div class="cross"><i></i><i></i><i></i><i></i></div>
      <div class="hit"><i></i><i></i><i></i><i></i></div>
      <div class="dirs"></div>
      <div class="toast"></div>
      <div class="hint"></div>
      <div class="dead" hidden><b></b><div class="n"></div><small>Press <kbd>H</kbd> to change hero</small></div>
      <div class="me"><div class="name"></div><div class="hpnum"></div><div class="hpbar"><i></i><u></u></div><div class="fx"></div></div>
      <div class="kit-hud">
        <div class="slot a0"><div class="box"><div class="cool"></div><b></b></div><div class="lbl"></div><kbd>Shift</kbd></div>
        <div class="slot a1"><div class="box"><div class="cool"></div><b></b></div><div class="lbl"></div><kbd>E</kbd></div>
        <div class="slot ult"><div class="box"><b></b></div><div class="lbl"></div><kbd>Q</kbd></div>
        <div class="ammo"><div class="n"></div><div class="rl"><i></i></div><div class="w"></div></div>
      </div>
      <div class="tab panel" hidden></div>
      <div class="spec" hidden></div>`;
    const q = (s) => root.querySelector(s);
    this.el = {
      pct: [q('.dawn .pct'), q('.dusk .pct')], bar: [q('.dawn .bar i'), q('.dusk .bar i')], flame: q('.flame'), msg: q('.obj .msg'),
      feed: q('.feed'), cross: q('.cross'), hit: q('.hit'), toast: q('.toast'), hint: q('.hint'), dead: q('.dead'),
      name: q('.me .name'), hpnum: q('.hpnum'), hp: q('.hpbar i'), sh: q('.hpbar u'), fx: q('.me .fx'),
      slots: [q('.a0'), q('.a1'), q('.slot.ult')], ammo: q('.ammo'), ammoN: q('.ammo .n'), ammoW: q('.ammo .w'), rl: q('.ammo .rl i'),
      tab: q('.tab'), plates: q('.plates'), dmgs: q('.dmgs'), dirs: q('.dirs'), spec: q('.spec'), scope: q('.scope'),
      vHurt: q('.vig.hurt'), vLow: q('.vig.low'), vHeal: q('.vig.heal'), vNight: q('.vig.night'),
    };
    this.dmg = [];
    for (let i = 0; i < 14; i++) { const d = document.createElement('div'); d.className = 'dmg'; this.el.dmgs.appendChild(d); this.dmg.push({ el: d, life: 0, target: null, amount: 0, x: 0, y: 0, z: 0, crit: false, heal: false, rise: 0 }); }
    this.dirs = [];
    for (let i = 0; i < 6; i++) { const d = document.createElement('div'); d.className = 'dir'; this.el.dirs.appendChild(d); this.dirs.push({ el: d, life: 0, src: null }); }
    this.plates = new Map();
    this.p = { x: 0, y: 0 };
    this.cache = {};
    this.toastQ = []; this.toastT = 0;
    this.hurt = 0; this.healV = 0; this.tabOn = false; this.ultWas = false;
  }

  start(sim, me, spectating) {
    this.sim = sim; this.me = me;
    this.cache = {};
    this.el.feed.innerHTML = ''; this.el.plates.innerHTML = ''; this.plates.clear();
    this.toastQ.length = 0; this.el.toast.classList.remove('show');
    this.el.spec.hidden = !spectating;
    if (spectating) this.el.spec.textContent = 'Watching a bot play. This is a test mode.';
    for (const d of this.dmg) { d.life = 0; d.el.style.opacity = 0; }
    this.vis = new Map(); this.visAt = 0;
    this.setHero();
    this.toast('Light the Year-Fire', 'Stand in the ring to capture it. Hold it to win.');
  }

  setHero() {
    const h = this.me.hero, el = this.el;
    el.name.textContent = `${h.name} · ${h.title}`;
    el.cross.className = 'cross c-' + h.weapon.type;
    el.slots[0].querySelector('.lbl').textContent = h.abilities[0].name;
    el.slots[1].querySelector('.lbl').textContent = h.abilities[1].name;
    el.slots[2].querySelector('.lbl').textContent = h.ult.name;
    el.ammoW.textContent = h.weapon.name;
    this.cache = {};
  }

  set(key, value, fn) { if (this.cache[key] !== value) { this.cache[key] = value; fn(value); } }

  toast(text, sub, time = 2.6) { this.toastQ.push({ text, sub, time }); }

  feed(html, mine) {
    const d = document.createElement('div');
    d.innerHTML = html; if (mine) d.className = 'mine';
    this.el.feed.appendChild(d);
    while (this.el.feed.children.length > 6) this.el.feed.firstChild.remove();
    setTimeout(() => d.remove(), 6000);
  }

  nameHtml(e) { return `<span class="t${e.team}">${esc(e.name)}</span>`; }

  number(target, amount, crit, heal) {
    let d = this.dmg.find((n) => n.life > 0.55 && n.target === target && n.heal === heal);
    if (!d) { d = this.dmg.reduce((a, b) => (b.life < a.life ? b : a)); d.amount = 0; d.crit = false; d.rise = 0; d.target = target; d.heal = heal; d.off = (Math.random() - 0.5) * 40; }
    d.amount += amount; d.crit = d.crit || crit; d.life = 0.9;
    d.x = target.x; d.y = target.y + target.hero.height + 0.25; d.z = target.z;
    d.el.textContent = (heal ? '+' : '') + Math.round(d.amount);
    d.el.className = 'dmg' + (d.crit ? ' crit' : '') + (heal ? ' heal' : '');
  }

  event(ev) {
    const me = this.me, sim = this.sim, el = this.el;
    switch (ev.t) {
      case 'damage': {
        if (ev.src === me && ev.target !== me) {
          this.number(ev.target, ev.amount, ev.crit, false);
          el.hit.className = 'hit' + (ev.kill ? ' kill' : ev.crit ? ' crit' : '');
          void el.hit.offsetWidth; el.hit.classList.add('go');
          this.audio.hit(ev.crit);
        }
        if (ev.target === me) {
          this.hurt = Math.min(1, this.hurt + ev.amount / 90 + 0.15);
          this.audio.hurt(ev.amount);
          if (ev.src && ev.src !== me) {
            let d = this.dirs.find((x) => x.src === ev.src && x.life > 0) || this.dirs.reduce((a, b) => (b.life < a.life ? b : a));
            d.src = ev.src; d.life = 1; d.x = ev.src.x; d.z = ev.src.z;
          }
        }
        break;
      }
      case 'heal':
        if (ev.target === me && ev.amount > 5) this.healV = 1;
        if (ev.src === me && ev.target !== me) this.number(ev.target, ev.amount, false, true);
        break;
      case 'kill': {
        const mine = ev.src === me || ev.target === me || ev.assists.includes(me);
        this.feed(`${ev.src ? this.nameHtml(ev.src) : 'The dark'} ▸ ${this.nameHtml(ev.target)}`, mine);
        if (ev.src === me) { this.audio.kill(); this.toast(`You stopped ${ev.target.name}`, '', 1.4); }
        else if (ev.assists.includes(me)) this.toast(`Assist: ${ev.target.name}`, '', 1.1);
        break;
      }
      case 'cast':
        if (ev.slot === 2) {
          this.feed(`${this.nameHtml(ev.ent)} <span class="ult">${esc(ev.ent.hero.ult.name)}!</span>`, ev.ent === me);
          if (ev.ent !== me && ev.ent.team !== me.team) this.toast(ev.ent.hero.ult.name + '!', `${ev.ent.name} used an ultimate`, 1.6);
        }
        break;
      case 'point':
        if (ev.kind === 'unlocked') this.toast('The Year-Fire is open', 'Stand in the ring');
        else if (ev.kind === 'captured') this.toast(`${TEAMS[ev.team].name} holds the fire`, ev.team === me.team ? 'Keep them out of the ring' : 'Take it back');
        else if (ev.kind === 'overtime') this.toast('Last stand!', 'The fire is fought over', 2);
        break;
      case 'hero': if (ev.ent === me) this.setHero(); break;
    }
  }

  showTab(on) {
    if (on === this.tabOn) return;
    this.tabOn = on; this.el.tab.hidden = !on; this.tabAt = 0;
  }

  frame(dt, look) {
    const sim = this.sim, me = this.me, el = this.el, view = this.view, p = this.p;
    if (!sim || !me) return;
    const now = sim.time, o = sim.objective, hero = me.hero;

    // Objective.
    for (const t of [0, 1]) {
      this.set('pct' + t, Math.floor(o.score[t]), (v) => { el.pct[t].textContent = v + '%'; el.bar[t].style.width = v + '%'; });
    }
    this.set('own', o.owner, (v) => el.flame.style.setProperty('--own-color', v >= 0 ? TEAMS[v].color : '#d8d2c4'));
    this.set('cap', Math.round(o.cap * 100) + ':' + o.capTeam, () => {
      el.flame.style.setProperty('--cap', Math.round(o.cap * 100));
      el.flame.style.setProperty('--cap-color', o.capTeam >= 0 ? TEAMS[o.capTeam].color : '#fff');
    });
    this.set('cont', o.contested, (v) => el.flame.classList.toggle('contested', v));
    const left = Math.max(0, RULES.matchTime - now);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    let msg;
    if (o.locked) msg = `The fire opens in ${Math.ceil(RULES.unlockDelay - now)}`;
    else if (o.overtime) msg = 'Last stand!';
    else if (o.contested) msg = 'Both troupes are on the fire';
    else if (o.cap > 0 && o.capTeam >= 0) msg = `${TEAMS[o.capTeam].short} is lighting the fire`;
    else if (o.owner >= 0) msg = `${TEAMS[o.owner].short} holds the fire`;
    else msg = 'Nobody holds the fire';
    this.set('msg', msg + clock, () => { el.msg.innerHTML = `${msg}<small>${clock}</small>`; });

    // Health and status.
    this.set('hp', Math.ceil(me.hp) + '/' + Math.ceil(me.shield), () => {
      el.hpnum.innerHTML = `${Math.ceil(me.hp)}${me.shield > 0 ? ` <small>+${Math.ceil(me.shield)}</small>` : ''} <small>/ ${me.maxHp}</small>`;
      const tot = me.maxHp + Math.max(0, me.shield);
      el.hp.style.width = (me.hp / tot) * 100 + '%';
      el.hp.classList.toggle('low', me.hp / me.maxHp < 0.3);
      el.sh.style.left = (me.hp / tot) * 100 + '%'; el.sh.style.width = (me.shield / tot) * 100 + '%';
    });
    let fx = '';
    if (me.slowUntil > now) fx += '<span class="bad">Slowed</span>';
    if (me.ampUntil > now) fx += '<span class="bad">Marked</span>';
    if (me.weakUntil > now) fx += '<span class="bad">Weakened</span>';
    if (me.dots.length) fx += '<span class="bad">Crows!</span>';
    if (me.staggerUntil > now && !me.onGround) fx += '<span class="bad">Thrown</span>';
    if (me.hasteUntil > now) fx += '<span class="good">Fast</span>';
    if (me.boostUntil > now) fx += '<span class="good">Stronger</span>';
    if (me.resistUntil > now) fx += '<span class="good">Guarded</span>';
    if (me.invisUntil > now) fx += '<span class="good">Hidden</span>';
    if (me.protectUntil > now && me.alive) fx += '<span class="good">Safe</span>';
    this.set('fx', fx, (v) => { el.fx.innerHTML = v; });

    // Abilities.
    for (let i = 0; i < 2; i++) {
      const cd = Math.max(0, me.cd[i]), def = hero.abilities[i];
      this.set('cd' + i, Math.ceil(cd * 10), () => {
        const s = el.slots[i];
        s.classList.toggle('ready', cd <= 0);
        s.querySelector('.cool').style.height = (cd / def.cooldown) * 100 + '%';
        s.querySelector('b').textContent = cd > 0 ? Math.ceil(cd) : '';
      });
    }
    const ultPct = Math.floor((me.ult / hero.ult.cost) * 100), ultOn = me.ultUntil > now;
    this.set('ult', ultPct + (ultOn ? 'on' : ''), () => {
      const s = el.slots[2];
      s.querySelector('.box').style.setProperty('--ult', ultPct);
      s.querySelector('b').textContent = ultPct >= 100 ? 'Q' : ultPct + '%';
      s.classList.toggle('ready', ultPct >= 100);
    });
    if (ultPct >= 100 && !this.ultWas) { this.audio.ultReady(); }
    this.ultWas = ultPct >= 100;
    this.set('hint', ultPct >= 100 && me.alive, (v) => { el.hint.textContent = `Press Q: ${hero.ult.name}`; el.hint.classList.toggle('show', v); });

    // Ammo.
    const wpn = hero.weapon;
    this.set('ammo', me.ammo + ':' + (me.reloadT > 0), () => {
      el.ammoN.innerHTML = `${me.ammo} <small>/ ${wpn.mag}</small>`;
      el.ammo.classList.toggle('reloading', me.reloadT > 0);
    });
    if (me.reloadT > 0) el.rl.style.width = (1 - me.reloadT / wpn.reload) * 100 + '%';
    this.set('crossdim', me.reloadT > 0 || me.invisUntil > now || !me.alive, (v) => el.cross.classList.toggle('dim', v));
    const zoomed = view.zoom > 0.5 && me.alive;
    this.set('scope', zoomed, (v) => { el.scope.style.opacity = v ? 1 : 0; el.cross.style.visibility = v ? 'hidden' : ''; });

    // Vignettes.
    this.hurt = Math.max(0, this.hurt - dt * 1.8); this.healV = Math.max(0, this.healV - dt * 1.5);
    el.vHurt.style.opacity = this.hurt.toFixed(2);
    el.vHeal.style.opacity = (this.healV * 0.8).toFixed(2);
    const low = me.alive && me.hp / me.maxHp < 0.3;
    el.vLow.style.opacity = low ? (0.55 + 0.3 * Math.sin(now * 7)).toFixed(2) : 0;
    this.set('night', me.weakUntil > now && me.slowUntil > now, (v) => { el.vNight.style.opacity = v ? 1 : 0; });

    // Dead panel.
    this.set('dead', !me.alive, (v) => {
      el.dead.hidden = !v;
      if (v) el.dead.querySelector('b').textContent = me.killer ? `Stopped by ${me.killer.name}` : 'You fell';
    });
    if (!me.alive) this.set('rsp', Math.ceil(me.respawnT), (v) => { el.dead.querySelector('.n').textContent = v; });

    // Toasts.
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) el.toast.classList.remove('show'); }
    else if (this.toastQ.length) {
      const t = this.toastQ.shift();
      if (this.toastQ.length > 2) this.toastQ.length = 2;
      el.toast.innerHTML = esc(t.text) + (t.sub ? `<small>${esc(t.sub)}</small>` : '');
      el.toast.classList.add('show'); this.toastT = t.time;
    }

    // Damage numbers.
    for (const d of this.dmg) {
      if (d.life <= 0) continue;
      d.life -= dt; d.rise += dt;
      if (d.life <= 0) { d.el.style.opacity = 0; continue; }
      if (view.project(d.x, d.y + d.rise * 0.9, d.z, p)) {
        d.el.style.opacity = Math.min(1, d.life * 3);
        d.el.style.transform = `translate(${(p.x + d.off).toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%) scale(${(1 + Math.max(0, d.life - 0.75) * 2).toFixed(2)})`;
      } else d.el.style.opacity = 0;
    }
    // Damage direction arcs.
    const yaw = look ? look.yaw : me.yaw;
    for (const d of this.dirs) {
      if (d.life <= 0) continue;
      d.life -= dt * 1.1;
      if (d.life <= 0) { d.el.style.opacity = 0; continue; }
      if (d.src && d.src.alive) { d.x = d.src.x; d.z = d.src.z; }
      const ang = Math.atan2(-(d.x - me.x), -(d.z - me.z)) - yaw;
      d.el.style.opacity = Math.min(1, d.life * 2);
      d.el.style.transform = `rotate(${(-ang).toFixed(3)}rad)`;
    }

    // Name plates.
    if (now >= this.visAt) {
      this.visAt = now + 0.12;
      for (const e of sim.ents) {
        if (e === me) continue;
        let v = e.alive;
        if (v && e.team !== me.team) v = me.alive && !sim.invisible(e) && sim.dist(me, e) < 70 && sim.canSee(me, e);
        this.vis.set(e.id, v);
      }
      for (const [id, pl] of this.plates) if (!sim.ents.some((e) => e.id === id)) { pl.el.remove(); this.plates.delete(id); }
    }
    for (const e of sim.ents) {
      if (e === me) continue;
      let pl = this.plates.get(e.id);
      const show = this.vis.get(e.id);
      if (!pl) {
        if (!show) continue;
        const d = document.createElement('div');
        const foe = e.team !== me.team;
        d.className = 'plate ' + (foe ? 'foe' : 'ally');
        d.innerHTML = `<span></span><div class="hp"><i></i></div>`;
        d.firstChild.textContent = e.name;
        el.plates.appendChild(d);
        pl = { el: d, bar: d.querySelector('i'), hp: -1, on: true };
        this.plates.set(e.id, pl);
      }
      const h = view.heroes.get(e.id);
      const ok = show && h && view.project(h.x, h.y + e.hero.height + 0.45, h.z, p);
      if (!ok) { if (pl.on) { pl.el.style.display = 'none'; pl.on = false; } continue; }
      if (!pl.on) { pl.el.style.display = ''; pl.on = true; }
      pl.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      const hp = Math.round(((e.hp + e.shield) / e.maxHp) * 50);
      if (hp !== pl.hp) { pl.hp = hp; pl.bar.style.width = Math.min(100, hp * 2) + '%'; }
    }

    // Scoreboard.
    if (this.tabOn) { this.tabAt -= dt; if (this.tabAt <= 0) { this.tabAt = 0.5; el.tab.innerHTML = scoreboardHtml(sim, me); } }
  }
}
