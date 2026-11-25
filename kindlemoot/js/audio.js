// Kindlemoot sound. Every sound is made in code with the Web Audio API:
// oscillators, one shared noise buffer, filters and envelopes. No audio files.
// The class is safe to construct anywhere; nothing touches the audio system
// until unlock() runs from a user gesture.

const MAX_VOICES = 24;
const FAR = 60;            // metres; past this a sound is silent
const PENTA = [196, 220, 261.63, 293.66, 329.63, 392, 440, 523.25];
const BOX = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
const ULTS = { longnight: 1, drums: 1, crows: 1, jackbox: 1, lights: 1, lastsong: 1 };

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.paused = false;
    this.lx = 0; this.ly = 1.7; this.lz = 0; this.lyaw = 0;
    this.voices = [];
    this.limits = new Map();
    this.loops = null;
    this.beatT = 0;
    this.musicT = 3;
    this.musicI = 3;
    this.endAt = -99;
  }

  // ----- Set up ----------------------------------------------------------

  unlock() {
    if (typeof window === 'undefined') return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      if (!this.ctx) {
        const ctx = new AC();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this._vol();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 6;
        comp.attack.value = 0.004; comp.release.value = 0.18;
        this.master.connect(comp); comp.connect(ctx.destination);
        this.sfx = ctx.createGain(); this.sfx.connect(this.master);
        this.music = ctx.createGain(); this.music.gain.value = 0.5; this.music.connect(this.master);
        const len = Math.floor(ctx.sampleRate * 2);
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (!this.paused && this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    } catch (err) { this.ctx = null; return false; }
  }

  _vol() { return this.volume * this.volume * 0.9; }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    if (this.ctx) this.master.gain.setTargetAtTime(this._vol(), this.ctx.currentTime, 0.03);
  }

  setListener(x, y, z, yaw) { this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw; }

  setPaused(p) {
    this.paused = !!p;
    if (!this.ctx) return;
    try { if (this.paused) this.ctx.suspend(); else this.ctx.resume(); } catch (err) { /* ignore */ }
  }

  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices.slice()) this._drop(v);
    if (this.loops) {
      const L = this.loops;
      L.flameG.gain.setTargetAtTime(0, now, 0.05);
      L.roarG.gain.setTargetAtTime(0, now, 0.2);
      L.humG.gain.setTargetAtTime(0, now, 0.1);
    }
    this.beatT = 0;
  }

  // ----- Voices ----------------------------------------------------------

  _ok() { return this.ctx && !this.paused && this.ctx.state === 'running'; }

  // Gain and pan of a world position for the listener. Returns null when too far.
  _place(x, y, z, far) {
    const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
    const d = Math.hypot(dx, dy, dz);
    if (d >= far) return null;
    const k = d / 11;
    const g = (1 / (1 + k * k)) * (1 - d / far);
    const h = Math.hypot(dx, dz);
    let pan = 0;
    if (h > 0.4) {
      const rx = Math.cos(this.lyaw), rz = -Math.sin(this.lyaw);
      pan = ((dx * rx + dz * rz) / h) * 0.8 * Math.min(1, h / 3);
    }
    return { g, pan, d };
  }

  // Open a voice. pos is [x,y,z] or null (centred). Returns null when the
  // sound is too quiet, too far, or there is no free slot for it.
  _voice(pos, level, far = FAR) {
    if (!this._ok()) return null;
    const ctx = this.ctx, now = ctx.currentTime;
    let g = level, pan = 0;
    if (pos) {
      const p = this._place(pos[0], pos[1], pos[2], far);
      if (!p) return null;
      g *= p.g; pan = p.pan;
    }
    if (g < 0.004) return null;
    this._prune(now);
    const vs = this.voices;
    if (vs.length >= MAX_VOICES) {
      let q = vs[0];
      for (let i = 1; i < vs.length; i++) if (vs[i].level < q.level) q = vs[i];
      if (q.level >= g) return null;
      this._drop(q);
    }
    const out = ctx.createGain();
    out.gain.value = g;
    let tail = out;
    if (pan !== 0 && ctx.createStereoPanner) {
      tail = ctx.createStereoPanner();
      tail.pan.value = pan;
      out.connect(tail);
    }
    tail.connect(this.sfx);
    const v = { out, tail, level: g, end: now + 0.05, srcs: [], t: now };
    vs.push(v);
    return v;
  }

  _prune(now) {
    const vs = this.voices;
    for (let i = vs.length - 1; i >= 0; i--) {
      if (vs[i].end <= now) {
        try { vs[i].tail.disconnect(); } catch (err) { /* ignore */ }
        vs.splice(i, 1);
      }
    }
  }

  _drop(v) {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    const now = this.ctx.currentTime;
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0, now, 0.008);
      for (const s of v.srcs) { try { s.stop(now + 0.05); } catch (err) { /* already stopped */ } }
    } catch (err) { /* ignore */ }
    setTimeout(() => { try { v.tail.disconnect(); } catch (err) { /* ignore */ } }, 150);
  }

  // True when this key has not played for at least gap seconds.
  _limit(key, gap) {
    const now = this.ctx.currentTime;
    const last = this.limits.get(key);
    if (last !== undefined && now - last < gap) return false;
    this.limits.set(key, now);
    return true;
  }

  _env(t, dur, gain, attack) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
    return g;
  }

  // An oscillator with a pitch slide and a decay. lp: optional low-pass cutoff.
  _tone(v, type, f0, f1, dur, gain, t0 = 0, attack = 0.003, lp = 0) {
    const ctx = this.ctx, t = v.t + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this._env(t, dur, gain, attack);
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 0.7;
      o.connect(f); f.connect(g);
    } else o.connect(g);
    g.connect(v.out);
    o.start(t); o.stop(t + dur + 0.03);
    v.srcs.push(o);
    if (t + dur + 0.06 > v.end) v.end = t + dur + 0.06;
    return o;
  }

  // Filtered noise from the shared buffer.
  _noise(v, ftype, f0, f1, dur, gain, t0 = 0, attack = 0.002, q = 0.8) {
    const ctx = this.ctx, t = v.t + t0;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = ftype; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this._env(t, dur, gain, attack);
    s.connect(f); f.connect(g); g.connect(v.out);
    s.start(t, Math.random() * 1.7); s.stop(t + dur + 0.03);
    v.srcs.push(s);
    if (t + dur + 0.06 > v.end) v.end = t + dur + 0.06;
    return s;
  }

  // A tone whose loudness buzzes (raspberry, caw, growl).
  _buzz(v, type, f0, f1, dur, gain, rate, t0 = 0, lp = 900) {
    const ctx = this.ctx, t = v.t + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = 1.2;
    const am = ctx.createGain(); am.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rate;
    const lg = ctx.createGain(); lg.gain.value = 0.45;
    lfo.connect(lg); lg.connect(am.gain);
    const g = this._env(t, dur, gain, 0.008);
    o.connect(f); f.connect(am); am.connect(g); g.connect(v.out);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.03); lfo.stop(t + dur + 0.03);
    v.srcs.push(o, lfo);
    if (t + dur + 0.06 > v.end) v.end = t + dur + 0.06;
  }

  // A bell or chime: a few sine partials with long tails.
  _bell(v, f, dur, gain, t0 = 0) {
    this._tone(v, 'sine', f, f, dur, gain, t0, 0.004);
    this._tone(v, 'sine', f * 2.01, f * 2.01, dur * 0.6, gain * 0.35, t0, 0.004);
    this._tone(v, 'sine', f * 3.02, f * 3.02, dur * 0.35, gain * 0.15, t0, 0.004);
  }

  // A plucked string.
  _pluck(v, f, dur, gain, t0 = 0) {
    this._tone(v, 'triangle', f, f * 0.995, dur, gain, t0, 0.002);
    this._tone(v, 'sawtooth', f, f, dur * 0.5, gain * 0.35, t0, 0.002, f * 4);
    this._noise(v, 'bandpass', f * 3, 0, 0.02, gain * 0.4, t0, 0.001, 1.5);
  }

  _at(e) { return [e.x, e.y + 1.2, e.z]; }

  // ----- Sim events ------------------------------------------------------

  event(ev, sim, human) {
    if (!this._ok() || !ev) return;
    try { this._event(ev, sim, human); } catch (err) { /* sound must never break the game */ }
  }

  _event(ev, sim, human) {
    switch (ev.t) {
      case 'shot': this._shot(ev.ent, human); break;
      case 'fire': this._fire(ev.ent, human); break;
      case 'impact': {
        if (!this._limit('imp', 0.05)) break;
        const v = this._voice([ev.x, ev.y, ev.z], 0.25, 35);
        if (!v) break;
        if (ev.kind === 'spark') this._noise(v, 'bandpass', 5000, 0, 0.05, 0.4, 0, 0.001, 2);
        else if (ev.kind === 'note') this._tone(v, 'triangle', 700, 350, 0.05, 0.4);
        else this._noise(v, 'highpass', 2200, 0, 0.03, 0.5);
        break;
      }
      case 'damage': {
        const tg = ev.target;
        if (!tg || tg === human || ev.src === human) break;
        if (!this._limit('dmg', ev.kind === 'flame' ? 0.18 : 0.07)) break;
        const v = this._voice(this._at(tg), 0.22, 30);
        if (v) this._tone(v, 'sine', 150, 70, 0.07, 0.6);
        break;
      }
      case 'kill': {
        const tg = ev.target;
        if (!tg) break;
        const v = this._voice(tg === human ? null : this._at(tg), 0.5);
        if (!v) break;
        this._noise(v, 'bandpass', 1600, 500, 0.3, 0.5, 0, 0.004, 0.9);
        for (let i = 0; i < 4; i++) this._tone(v, 'sine', 1400 + Math.random() * 1800, 0, 0.12, 0.12, 0.03 + i * 0.045);
        break;
      }
      case 'decoyEnd': {
        const v = this._voice(this._at(ev.ent), 0.3, 30);
        if (v) { this._tone(v, 'sine', 700, 180, 0.09, 0.5); this._noise(v, 'highpass', 3000, 0, 0.05, 0.3); }
        break;
      }
      case 'spawn': {
        const mine = ev.ent === human;
        const v = this._voice(mine ? null : this._at(ev.ent), mine ? 0.3 : 0.15, 25);
        if (v) { this._tone(v, 'sine', 440, 880, 0.25, 0.4, 0, 0.03); this._tone(v, 'sine', 660, 1320, 0.25, 0.2, 0.06, 0.03); }
        break;
      }
      case 'jump': {
        const mine = ev.ent === human;
        if (!mine && !this._limit('jump', 0.1)) break;
        const v = this._voice(mine ? null : this._at(ev.ent), mine ? 0.12 : 0.1, 18);
        if (v) this._noise(v, 'lowpass', 500, 250, 0.09, 0.8, 0, 0.015);
        break;
      }
      case 'land': {
        const mine = ev.ent === human;
        if (!mine && !this._limit('land', 0.1)) break;
        const hard = Math.min(1, (ev.speed || 4) / 12);
        const v = this._voice(mine ? null : this._at(ev.ent), (mine ? 0.3 : 0.25) * (0.4 + hard), 22);
        if (v) { this._tone(v, 'sine', 95, 48, 0.1, 0.9); this._noise(v, 'lowpass', 400, 0, 0.06, 0.5); }
        break;
      }
      case 'reload': {
        const mine = ev.ent === human;
        if (!mine && !this._limit('rel', 0.2)) break;
        const v = this._voice(mine ? null : this._at(ev.ent), mine ? 0.3 : 0.15, 20);
        if (!v) break;
        this._noise(v, 'highpass', 2500, 0, 0.025, 0.7);
        this._tone(v, 'square', 320, 240, 0.03, 0.2, 0.01);
        this._noise(v, 'highpass', 3200, 0, 0.03, 0.8, 0.22);
        this._tone(v, 'square', 520, 400, 0.03, 0.2, 0.23);
        break;
      }
      case 'cast': this._cast(ev, human); break;
      case 'explode': this._explode(ev); break;
      case 'barrierHit': {
        if (!this._limit('bhit', 0.07)) break;
        const v = this._voice([ev.x, ev.y, ev.z], 0.3, 35);
        if (v) { this._noise(v, 'bandpass', 900, 500, 0.06, 0.8, 0, 0.002, 1.2); this._tone(v, 'sine', 260, 200, 0.05, 0.3); }
        break;
      }
      case 'barrierEnd': {
        const b = ev.barrier;
        const v = this._voice([b.x, b.y + 1.5, b.z], ev.broken ? 0.7 : 0.3);
        if (!v) break;
        if (ev.broken) {
          this._noise(v, 'highpass', 1800, 600, 0.35, 0.6, 0, 0.002);
          this._tone(v, 'triangle', 500, 120, 0.3, 0.5);
          for (let i = 0; i < 3; i++) this._noise(v, 'bandpass', 2500 + i * 900, 0, 0.04, 0.3, 0.06 + i * 0.07, 0.001, 3);
        } else this._noise(v, 'bandpass', 1500, 400, 0.4, 0.5, 0, 0.05);
        break;
      }
      case 'blink': {
        const mine = ev.ent === human;
        const a = this._voice(mine ? null : [ev.fx, ev.fy + 1, ev.fz], 0.45);
        if (a) { this._tone(a, 'sine', 380, 2600, 0.1, 0.5); this._noise(a, 'bandpass', 1200, 5000, 0.1, 0.25); }
        const b = this._voice(mine ? null : [ev.x, ev.y + 1, ev.z], 0.4);
        if (b) { this._tone(b, 'square', 880, 660, 0.06, 0.18, 0.1, 0.003, 2500); this._tone(b, 'sine', 1320, 990, 0.1, 0.3, 0.1); }
        break;
      }
      case 'deploy': {
        const d = ev.dep;
        const v = this._voice([d.x, d.y + 0.3, d.z], 0.45, 40);
        if (!v) break;
        this._tone(v, 'sine', 240, 110, 0.08, 0.6);
        if (d.type === 'jackbox') {
          // The crank winds up until the lid springs.
          const fuse = (d.def && d.def.fuse) || 0.9, n = 8;
          for (let i = 0; i < n; i++) {
            this._tone(v, 'triangle', BOX[i % BOX.length] * (1 + i * 0.04), 0, 0.07, 0.35, (i / n) * fuse * (0.6 + 0.4 * (i / n)));
          }
        } else this._tone(v, 'sine', 900, 1300, 0.05, 0.2, 0.06);
        break;
      }
      case 'buff': {
        const e = ev.ent;
        if (e !== human && ev.src !== human) break;
        if (!this._limit('buff:' + ev.kind, 0.15)) break;
        const v = this._voice(e === human ? null : this._at(e), 0.3);
        if (!v) break;
        if (ev.kind === 'rattle') { for (let i = 0; i < 3; i++) this._noise(v, 'bandpass', 4500, 0, 0.03, 0.5, i * 0.05, 0.001, 3); }
        else if (ev.kind === 'sweetbox') { this._bell(v, 1174.66, 0.35, 0.3); this._bell(v, 1568, 0.4, 0.25, 0.09); }
        else { this._bell(v, 1318.5, 0.25, 0.25); this._bell(v, 1760, 0.3, 0.2, 0.06); }
        break;
      }
      case 'crow': {
        if (!this._limit('crow', 0.09)) break;
        const tg = ev.target;
        const v = this._voice(tg === human ? null : this._at(tg), 0.5);
        if (!v) break;
        const p = 0.9 + Math.random() * 0.25;
        this._buzz(v, 'sawtooth', 640 * p, 430 * p, 0.16, 0.6, 75, 0, 1700);
        this._buzz(v, 'sawtooth', 600 * p, 400 * p, 0.2, 0.5, 70, 0.22, 1700);
        this._noise(v, 'bandpass', 1500, 0, 0.14, 0.15, 0, 0.01, 2);
        break;
      }
      case 'heal': {
        if (ev.target !== human && ev.src !== human) break;
        if (!this._limit('heal', 0.12)) break;
        const v = this._voice(null, 0.22);
        if (v) { this._tone(v, 'sine', 660, 0, 0.12, 0.5, 0, 0.01); this._tone(v, 'sine', 990, 0, 0.18, 0.4, 0.07, 0.01); }
        break;
      }
      case 'pack': {
        const mine = ev.ent === human;
        const v = this._voice(mine ? null : this._at(ev.ent), mine ? 0.4 : 0.25, 30);
        if (!v) break;
        this._bell(v, 783.99, 0.25, 0.4); this._bell(v, 987.77, 0.25, 0.4, 0.07); this._bell(v, 1174.66, 0.4, 0.4, 0.14);
        break;
      }
      case 'point': this._point(ev, human); break;
      case 'end': {
        this.stopAll();
        if (human) this._final(ev.winner === human.team);
        else { const v = this._voice(null, 0.4); if (v) this._bell(v, 523.25, 1.5, 0.5); }
        break;
      }
      default: break; // zone, zoneEnd, barrier, deployEnd, hero and anything new: no sound
    }
  }

  _shot(e, human) {
    if (!e) return;
    const mine = e === human;
    const id = e.heroId;
    if (!mine) {
      const p = this._place(e.x, e.y, e.z, FAR);
      if (!p || !this._limit('shot:' + id, p.d > 35 ? 0.14 : 0.05)) return;
    }
    const pos = mine ? null : [e.x, e.y + 1.6, e.z];
    const r = 0.94 + Math.random() * 0.12;
    if (id === 'tamsin') {
      const v = this._voice(pos, mine ? 0.75 : 0.9);
      if (!v) return;
      this._noise(v, 'bandpass', 1900 * r, 700, 0.13, 0.9, 0, 0.001, 0.7);
      this._tone(v, 'triangle', 190 * r, 55, 0.2, 0.9);
      this._noise(v, 'lowpass', 520, 220, 0.32, 0.3, 0.03, 0.04);
    } else {
      const v = this._voice(pos, mine ? 0.42 : 0.5);
      if (!v) return;
      this._tone(v, 'sine', 950 * r, 300, 0.06, 0.7);
      this._noise(v, 'highpass', 3200, 0, 0.04, 0.5, 0, 0.001);
      this._tone(v, 'triangle', 1900 * r, 1500, 0.03, 0.12, 0.012);
    }
  }

  _fire(e, human) {
    if (!e) return;
    const id = e.heroId;
    if (id === 'marta') return; // the bellows is a loop, see frame()
    const mine = e === human;
    if (!mine) {
      const p = this._place(e.x, e.y, e.z, FAR);
      if (!p || !this._limit('fire:' + id, p.d > 35 ? 0.14 : id === 'jun' ? 0.06 : 0.05)) return;
    }
    const pos = mine ? null : [e.x, e.y + 1.5, e.z];
    const r = 0.9 + Math.random() * 0.2;
    if (id === 'jun') {
      const v = this._voice(pos, mine ? 0.34 : 0.45);
      if (!v) return;
      this._noise(v, 'highpass', 2600 * r, 0, 0.035, 0.9, 0, 0.001);
      this._tone(v, 'square', 1500 * r, 480, 0.03, 0.3, 0, 0.001, 3500);
      this._tone(v, 'sine', 210, 120, 0.04, 0.3);
    } else if (id === 'meenal') {
      const v = this._voice(pos, mine ? 0.36 : 0.4);
      if (!v) return;
      this._noise(v, 'bandpass', 6200 * r, 4200, 0.17, 0.6, 0, 0.004, 2.2);
      this._tone(v, 'sine', 1500 * r, 2300, 0.08, 0.22, 0, 0.004);
      this._tone(v, 'sine', 3100 * r, 2600, 0.05, 0.1, 0.03);
    } else {
      const v = this._voice(pos, mine ? 0.42 : 0.45);
      if (!v) return;
      const f = PENTA[Math.floor(Math.random() * PENTA.length)];
      this._pluck(v, f, 0.3, 0.7);
    }
  }

  _cast(ev, human) {
    const e = ev.ent;
    if (!e) return;
    const mine = e === human;
    const ult = ev.slot === 2 || !!ULTS[ev.id];
    const pos = mine ? null : this._at(e);
    const v = this._voice(pos, (mine ? 0.55 : 0.6) * (ult ? 1.5 : 1), ult ? 90 : FAR);
    if (!v) return;
    if (ult) {
      // The stinger that says "an ultimate started".
      this._tone(v, 'sine', 70, 38, 0.6, 0.7);
      this._noise(v, 'bandpass', 300, 3200, 0.35, 0.3, 0, 0.05, 1.5);
    }
    switch (ev.id) {
      case 'ward':
        this._noise(v, 'bandpass', 800, 2600, 0.35, 0.5, 0, 0.03, 1.2);
        this._bell(v, 329.63, 0.6, 0.3, 0.05); this._bell(v, 493.88, 0.6, 0.25, 0.1);
        break;
      case 'slam':
        this._noise(v, 'lowpass', 500, 200, 0.14, 0.5, 0, 0.03);
        break;
      case 'longnight':
        this._noise(v, 'bandpass', 600, 220, 1.7, 0.6, 0, 0.3, 1.4);
        this._tone(v, 'sine', 58, 52, 1.6, 0.6, 0, 0.3);
        this._tone(v, 'sine', 1760, 1740, 1.4, 0.1, 0.1, 0.2);
        this._tone(v, 'sine', 2637, 2600, 1.1, 0.06, 0.3, 0.2);
        break;
      case 'pounce':
        this._buzz(v, 'sawtooth', 150, 300, 0.22, 0.6, 38, 0, 1100);
        this._buzz(v, 'sawtooth', 300, 110, 0.25, 0.5, 30, 0.2, 900);
        this._noise(v, 'bandpass', 500, 1600, 0.35, 0.3, 0, 0.04);
        break;
      case 'luckyred':
        for (let i = 0; i < 3; i++) this._noise(v, 'highpass', 3500, 0, 0.04, 0.3, i * 0.06, 0.004);
        this._bell(v, 1318.5, 0.3, 0.3, 0.05); this._bell(v, 1568, 0.3, 0.3, 0.12); this._bell(v, 2093, 0.5, 0.3, 0.19);
        break;
      case 'drums':
        this._tone(v, 'sine', 110, 108, 1.6, 0.5, 0, 0.005); this._tone(v, 'sine', 164.8, 163, 1.3, 0.3, 0, 0.005);
        this._tone(v, 'sine', 247, 245, 1.0, 0.2, 0, 0.005);
        this._noise(v, 'bandpass', 3000, 1500, 0.9, 0.2, 0, 0.004, 3);
        break;
      case 'guise':
        this._tone(v, 'sine', 1300, 280, 0.42, 0.4, 0, 0.02);
        this._noise(v, 'bandpass', 3000, 500, 0.45, 0.35, 0, 0.03, 2);
        break;
      case 'jackobomb':
      case 'whoopee':
        this._noise(v, 'bandpass', 600, 1300, 0.18, 0.5, 0, 0.03);
        if (ev.id === 'whoopee') this._tone(v, 'sine', 1100, 1700, 0.06, 0.2, 0.05);
        break;
      case 'crows':
        this._tone(v, 'sawtooth', 110, 104, 1.2, 0.35, 0, 0.2, 700);
        this._tone(v, 'sawtooth', 130.8, 124, 1.2, 0.3, 0, 0.2, 700);
        this._noise(v, 'bandpass', 900, 2400, 0.8, 0.3, 0, 0.2, 1.5);
        break;
      case 'gotcha': break; // the blink event makes the sound
      case 'jackbox':
        this._noise(v, 'bandpass', 500, 1200, 0.2, 0.5, 0, 0.03);
        for (let i = 0; i < 5; i++) this._tone(v, 'triangle', BOX[(i * 2) % BOX.length], 0, 0.1, 0.3, 0.05 + i * 0.07);
        break;
      case 'rangoli':
        for (let i = 0; i < 5; i++) this._tone(v, 'sine', BOX[i], 0, 0.5, 0.25, i * 0.06, 0.02);
        this._noise(v, 'bandpass', 5000, 7000, 0.4, 0.12, 0, 0.1, 3);
        break;
      case 'sweetbox':
        this._bell(v, 880, 0.3, 0.35); this._bell(v, 1174.66, 0.45, 0.35, 0.1);
        break;
      case 'lights':
        for (const [i, f] of [261.63, 329.63, 392, 523.25].entries()) this._tone(v, 'sine', f, f, 2.2, 0.3, i * 0.05, 0.3);
        for (let i = 0; i < 8; i++) this._tone(v, 'sine', BOX[i], 0, 0.4, 0.14, 0.3 + i * 0.09, 0.01);
        break;
      case 'marigold':
        for (const [i, f] of [196, 246.94, 293.66, 392].entries()) this._pluck(v, f, 0.6, 0.4, i * 0.035);
        break;
      case 'rattle':
        for (let i = 0; i < 7; i++) this._noise(v, 'bandpass', 5200 - i * 150, 0, 0.035, 0.6, i * 0.055, 0.002, 3);
        this._tone(v, 'triangle', 320, 300, 0.05, 0.2);
        break;
      case 'lastsong':
        for (const [i, f] of [392, 493.88, 587.33].entries()) {
          this._tone(v, 'sawtooth', f, f, i === 2 ? 0.7 : 0.2, 0.3, i * 0.16, 0.02, 1800);
          this._tone(v, 'square', f * 0.5, f * 0.5, i === 2 ? 0.6 : 0.18, 0.1, i * 0.16, 0.02, 900);
        }
        for (const [i, f] of [196, 246.94, 293.66, 392].entries()) this._pluck(v, f, 0.7, 0.3, 0.5 + i * 0.03);
        break;
      default:
        this._noise(v, 'bandpass', 800, 1600, 0.15, 0.3, 0, 0.02);
    }
  }

  _explode(ev) {
    const big = ev.kind === 'bomb' || ev.kind === 'jackbox' || ev.kind === 'drum' || ev.kind === 'slam';
    const v = this._voice([ev.x, ev.y + 0.5, ev.z], big ? 1.2 : 0.9, big ? 85 : FAR);
    if (!v) return;
    switch (ev.kind) {
      case 'slam':
        this._tone(v, 'sine', 85, 34, 0.42, 1.0);
        this._tone(v, 'triangle', 210, 90, 0.1, 0.5);
        this._noise(v, 'lowpass', 700, 200, 0.28, 0.6);
        break;
      case 'pounce':
        this._tone(v, 'sine', 115, 44, 0.26, 0.9);
        this._noise(v, 'lowpass', 900, 250, 0.16, 0.5);
        break;
      case 'drum':
        this._tone(v, 'sine', 98, 54, 0.55, 1.0, 0, 0.002);
        this._tone(v, 'sine', 192, 138, 0.22, 0.4, 0, 0.002);
        this._noise(v, 'bandpass', 190, 0, 0.05, 0.9, 0, 0.001, 1.2);
        this._noise(v, 'highpass', 2800, 0, 0.03, 0.15, 0, 0.001);
        break;
      case 'bomb':
        this._noise(v, 'lowpass', 1400, 180, 0.55, 1.0, 0, 0.003);
        this._tone(v, 'sine', 74, 30, 0.45, 0.9);
        for (let i = 0; i < 4; i++) this._noise(v, 'highpass', 2500, 0, 0.025, 0.25, 0.1 + Math.random() * 0.35, 0.001);
        break;
      case 'whoopee':
        this._buzz(v, 'sawtooth', 125, 62, 0.55, 0.9, 26, 0, 650);
        this._noise(v, 'bandpass', 350, 180, 0.5, 0.2, 0, 0.02, 2);
        break;
      case 'jackbox': {
        // Spring boing: a pitch that jumps up and wobbles.
        const ctx = this.ctx, t = v.t, dur = 0.7, n = 48;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const u = (i / (n - 1)) * dur;
          curve[i] = 170 + 430 * (1 - Math.exp(-7 * u)) + Math.sin(u * Math.PI * 2 * 13) * 90 * Math.exp(-3 * u);
        }
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueCurveAtTime(curve, t, dur);
        const g = this._env(t, dur, 0.8, 0.004);
        o.connect(g); g.connect(v.out); o.start(t); o.stop(t + dur + 0.03);
        v.srcs.push(o); v.end = Math.max(v.end, t + dur + 0.06);
        this._tone(v, 'sine', 90, 36, 0.3, 0.9);
        this._noise(v, 'lowpass', 1000, 250, 0.2, 0.6);
        break;
      }
      default:
        this._tone(v, 'sine', 100, 45, 0.25, 0.8);
        this._noise(v, 'lowpass', 900, 250, 0.2, 0.5);
    }
  }

  _point(ev, human) {
    if (ev.kind === 'contested' && !this._limit('contested', 3)) return;
    const v = this._voice(null, 0.5);
    if (!v) return;
    if (ev.kind === 'unlocked') {
      this._bell(v, 440, 1.6, 0.5); this._bell(v, 659.25, 1.6, 0.35, 0.02);
      this._noise(v, 'bandpass', 400, 1800, 0.6, 0.25, 0, 0.1);
    } else if (ev.kind === 'captured') {
      const up = !human || ev.team === human.team;
      const notes = up ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 622.25, 466.16, 392];
      for (let i = 0; i < notes.length; i++) this._bell(v, notes[i], i === 3 ? 1.1 : 0.4, 0.45, i * 0.11);
    } else if (ev.kind === 'contested') {
      this._tone(v, 'triangle', 587.33, 587.33, 0.14, 0.4); this._tone(v, 'triangle', 622.25, 622.25, 0.2, 0.4, 0.16);
    } else if (ev.kind === 'overtime') {
      for (let i = 0; i < 4; i++) {
        this._tone(v, 'square', 880, 880, 0.07, 0.25, i * 0.14, 0.002, 2400);
        this._tone(v, 'sine', 110, 80, 0.1, 0.5, i * 0.14);
      }
    }
  }

  _final(win) {
    if (!this.ctx) return;
    if (this.ctx.currentTime - this.endAt < 2.5) return; // already played for this match end
    this.endAt = this.ctx.currentTime;
    const v = this._voice(null, 0.7);
    if (!v) return;
    if (win) {
      const n = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      for (let i = 0; i < n.length; i++) this._bell(v, n[i], i === 4 ? 1.8 : 0.5, 0.45, i * 0.13);
      this._tone(v, 'sine', 98, 54, 0.5, 0.7, 0.52);
      this._noise(v, 'bandpass', 5000, 8000, 1.0, 0.12, 0.52, 0.05, 2);
    } else {
      const n = [440, 349.23, 293.66, 220];
      for (let i = 0; i < n.length; i++) this._tone(v, 'triangle', n[i], n[i] * 0.985, i === 3 ? 1.4 : 0.45, 0.45, i * 0.22, 0.02);
      this._tone(v, 'sine', 73.4, 55, 1.2, 0.5, 0.66, 0.05);
    }
  }

  // ----- Direct cues -----------------------------------------------------

  ui(name) {
    if (!this._ok()) return;
    if (name === 'win' || name === 'lose') { this._final(name === 'win'); return; }
    if (name === 'hover' && !this._limit('hover', 0.04)) return;
    const v = this._voice(null, 0.3);
    if (!v) return;
    switch (name) {
      case 'hover': this._tone(v, 'sine', 1250, 1350, 0.035, 0.18); break;
      case 'click': this._tone(v, 'triangle', 820, 560, 0.055, 0.5); this._noise(v, 'highpass', 3000, 0, 0.015, 0.2); break;
      case 'select': this._bell(v, 659.25, 0.2, 0.5); this._bell(v, 987.77, 0.35, 0.5, 0.08); break;
      case 'start':
        for (let i = 0; i < 4; i++) this._bell(v, [392, 523.25, 659.25, 783.99][i], i === 3 ? 0.9 : 0.25, 0.5, i * 0.09);
        this._tone(v, 'sine', 98, 54, 0.5, 0.9, 0.27);
        break;
      case 'tick': this._tone(v, 'square', 1000, 1000, 0.02, 0.3, 0, 0.001, 3000); break;
      default: break;
    }
  }

  hit(crit) {
    if (!this._ok() || !this._limit('hit', 0.03)) return;
    const v = this._voice(null, 0.32);
    if (!v) return;
    this._tone(v, 'sine', crit ? 2600 : 1750, crit ? 2400 : 1500, 0.05, 0.6, 0, 0.001);
    this._noise(v, 'highpass', 5000, 0, 0.012, 0.25, 0, 0.001);
    if (crit) this._tone(v, 'sine', 3900, 3700, 0.09, 0.35, 0.025, 0.001);
  }

  kill() {
    if (!this._ok()) return;
    const v = this._voice(null, 0.45);
    if (!v) return;
    this._bell(v, 1046.5, 0.5, 0.5); this._bell(v, 1568, 0.6, 0.4, 0.07); this._bell(v, 2093, 0.7, 0.3, 0.15);
  }

  hurt(amount) {
    if (!this._ok() || !this._limit('hurt', 0.05)) return;
    const k = Math.min(1, (amount || 10) / 60);
    const v = this._voice(null, 0.2 + 0.4 * k);
    if (!v) return;
    this._tone(v, 'sine', 125, 58, 0.13, 0.9);
    this._noise(v, 'lowpass', 600, 200, 0.08, 0.5);
  }

  ultReady() {
    if (!this._ok()) return;
    const v = this._voice(null, 0.45);
    if (!v) return;
    const n = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < n.length; i++) this._bell(v, n[i], i === 3 ? 0.9 : 0.3, 0.4, i * 0.07);
    this._noise(v, 'bandpass', 5000, 8500, 0.6, 0.1, 0.2, 0.08, 3);
  }

  // ----- Continuous sound ------------------------------------------------

  _makeLoops() {
    const ctx = this.ctx;
    const src = (offset) => { const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(0, offset); return s; };
    const L = {};
    // Marta's bellows.
    L.flameF = ctx.createBiquadFilter(); L.flameF.type = 'bandpass'; L.flameF.frequency.value = 750; L.flameF.Q.value = 0.6;
    L.flameG = ctx.createGain(); L.flameG.gain.value = 0;
    L.flameP = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    src(0.1).connect(L.flameF); L.flameF.connect(L.flameG); L.flameG.connect(L.flameP); L.flameP.connect(this.master);
    // The Year-Fire: a low roar. The crackles are one-shots, see frame().
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 260; rf.Q.value = 0.5;
    L.roarG = ctx.createGain(); L.roarG.gain.value = 0;
    L.fireP = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    src(0.9).connect(rf); rf.connect(L.roarG); L.roarG.connect(L.fireP); L.fireP.connect(this.master);
    // Zone hum: two soft sines.
    L.humG = ctx.createGain(); L.humG.gain.value = 0;
    L.humA = ctx.createOscillator(); L.humA.type = 'sine'; L.humA.frequency.value = 220;
    L.humB = ctx.createOscillator(); L.humB.type = 'sine'; L.humB.frequency.value = 330;
    const hb = ctx.createGain(); hb.gain.value = 0.6;
    L.humA.connect(L.humG); L.humB.connect(hb); hb.connect(L.humG); L.humG.connect(this.master);
    L.humA.start(); L.humB.start();
    this.loops = L;
  }

  frame(dt, sim, human) {
    if (!this._ok() || !sim) return;
    try { this._frame(dt, sim, human); } catch (err) { /* sound must never break the game */ }
  }

  _frame(dt, sim, human) {
    const ctx = this.ctx, now = ctx.currentTime;
    if (!this.loops) this._makeLoops();
    const L = this.loops;
    this._prune(now);
    if (sim.over) { this.stopAll(); return; }

    // Bellows: follow the loudest burning hero.
    let fg = 0, fpan = 0;
    for (const e of sim.ents) {
      if (!e.flaming || !e.alive) continue;
      if (e === human) { fg = 0.3; fpan = 0; break; }
      const p = this._place(e.x, e.y + 1.4, e.z, 45);
      if (p && p.g * 0.5 > fg) { fg = p.g * 0.5; fpan = p.pan; }
    }
    L.flameG.gain.setTargetAtTime(fg, now, 0.04);
    if (fg > 0) {
      L.flameF.frequency.setTargetAtTime(600 + Math.random() * 500, now, 0.05);
      if (L.flameP.pan) L.flameP.pan.setTargetAtTime(fpan, now, 0.05);
    }

    // Year-Fire at the centre of the square.
    const pt = sim.map && sim.map.point ? sim.map.point : { x: 0, y: 0, z: 0 };
    const fire = this._place(pt.x, (pt.y || 0) + 2.5, pt.z, 50);
    const near = fire ? fire.g : 0;
    L.roarG.gain.setTargetAtTime(near * 0.16, now, 0.2);
    if (fire && L.fireP.pan) L.fireP.pan.setTargetAtTime(fire.pan * 0.7, now, 0.1);
    if (near > 0.02 && Math.random() < dt * 9 * Math.min(1, near * 2)) {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800 + Math.random() * 2500;
      const g = ctx.createGain(), dur = 0.012 + Math.random() * 0.02;
      g.gain.setValueAtTime(near * (0.05 + Math.random() * 0.14), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      s.connect(f); f.connect(g); g.connect(L.fireP);
      s.start(now, Math.random() * 1.9, dur + 0.02);
    }

    // Heartbeat under 30% health.
    if (human && human.alive && human.hp / human.maxHp < 0.3) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        const frac = human.hp / human.maxHp;
        this.beatT = 0.62 + frac * 1.1;
        const v = this._voice(null, 0.5);
        if (v) { this._tone(v, 'sine', 58, 38, 0.14, 0.9, 0, 0.008); this._tone(v, 'sine', 52, 36, 0.14, 0.6, 0.19, 0.008); }
      }
    } else this.beatT = 0;

    // Hum while the player stands in a zone that matters to them.
    let hum = 0, fa = 220, fb = 330;
    if (human && human.alive && sim.zones) {
      for (const z of sim.zones) {
        if (Math.hypot(human.x - z.x, human.z - z.z) > z.radius) continue;
        const friendly = z.team === human.team;
        if (z.type === 'longnight') { if (!friendly) { hum = 0.06; fa = 110; fb = 116.5; } continue; }
        if (!friendly) continue;
        hum = 0.045;
        if (z.type === 'marigold') { fa = 293.66; fb = 440; }
        else if (z.type === 'lastsong') { fa = 261.63; fb = 392; }
        else { fa = 329.63; fb = 493.88; }
        break;
      }
    }
    L.humG.gain.setTargetAtTime(hum, now, 0.15);
    if (hum > 0) { L.humA.frequency.setTargetAtTime(fa, now, 0.1); L.humB.frequency.setTargetAtTime(fb, now, 0.1); }

    // A very quiet music box, so the square is never dead silent.
    this.musicT -= dt;
    if (this.musicT <= 0) {
      this.musicT = 0.7 + Math.random() * 1.9;
      const step = Math.floor(Math.random() * 5) - 2;
      this.musicI = Math.max(0, Math.min(BOX.length - 1, this.musicI + step));
      this._box(BOX[this.musicI], now, 0.03);
      if (Math.random() < 0.3) {
        const j = Math.max(0, Math.min(BOX.length - 1, this.musicI + (Math.random() < 0.5 ? 2 : -2)));
        this._box(BOX[j], now + 0.24, 0.022);
        this.musicI = j;
      }
    }
  }

  _box(f, t, gain) {
    const ctx = this.ctx;
    for (const [mul, lvl, dur] of [[1, 1, 1.5], [3.01, 0.18, 0.5]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain * lvl, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.music);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
}
