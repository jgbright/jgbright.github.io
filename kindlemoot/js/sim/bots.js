// Bot brains. A bot fills the same command object as the human player, so
// bots and the human run through the same movement, weapon and ability code.

import { RULES } from '../data/heroes.js';
import { onStrip } from './abilities.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

export class Bot {
  constructor(sim, e, skill) {
    this.sim = sim; this.e = e; this.skill = skill;
    this.phase = (e.id * 5) % 30;
    this.seen = new Map();
    this.aimYaw = 0; this.aimPitch = 0;
    this.errYaw = 0; this.errPitch = 0; this.errYawT = 0; this.errPitchT = 0; this.errAt = 0;
    this.stuckN = 0; this.teleports = 0; this.retreats = 0; this.groups = 0;
    this.onSpawn();
  }

  onSpawn() {
    const e = this.e;
    this.target = null; this.heal = null; this.headShot = false;
    this.mode = 'objective'; this.grouped = false;
    this.goal = null; this.path = []; this.pathI = 0; this.repathAt = 0;
    this.spot = null; this.spotUntil = 0;
    this.strafe = this.sim.rng() < 0.5 ? 1 : -1; this.strafeUntil = 0;
    this.pend = [0, 0, 0]; this.override = null;
    this.aimYaw = e.yaw; this.aimPitch = 0;
    this.lastX = e.x; this.lastZ = e.z; this.lastCheck = this.sim.time; this.stuckN = 0;
    this.spawnAt = this.sim.time; this.retreatUntil = 0; this.groupUntil = 0;
    this.sloppy = this.sim.rng() > this.skill.ultSense;
    this.seen.clear();
  }

  think(dt) {
    const sim = this.sim, c = this.e.cmd, k = sim.tick + this.phase;
    c.fire = c.a1 = c.a2 = c.ult = c.jump = c.reload = c.alt = false;
    if (k % 6 === 0) this.perceive();
    if (k % 15 === 0) { this.pickTarget(); this.decide(); }
    if (k % 12 === 3) this.useAbilities();
    this.move(dt);
    this.aim(dt);
  }

  // ----- Senses ----------------------------------------------------------

  perceive() {
    const sim = this.sim, e = this.e, now = sim.time;
    for (const o of sim.ents) {
      if (o.team === e.team || o === e) continue;
      let s = this.seen.get(o.id);
      const vis = o.alive && !sim.invisible(o) && sim.dist(e, o) < 70 && sim.canSee(e, o);
      if (vis) {
        if (!s || now - s.last > 1) { s = { ent: o, first: now, last: now }; this.seen.set(o.id, s); }
        s.last = now;
      } else if (s && (!o.alive || now - s.last > 3)) this.seen.delete(o.id);
    }
  }

  visible(o) {
    const s = this.seen.get(o.id);
    return !!s && o.alive && this.sim.time - s.last < 0.25 && this.sim.time - s.first >= this.skill.reaction;
  }

  enemiesWithin(r, x = this.e.x, z = this.e.z) {
    let n = 0;
    for (const s of this.seen.values()) {
      const o = s.ent;
      if (o.alive && this.sim.time - s.last < 0.6 && Math.hypot(o.x - x, o.z - z) <= r) n++;
    }
    return n;
  }

  alliesWithin(r, hurt = 2) {
    let n = 0;
    const e = this.e;
    for (const o of this.sim.ents) {
      if (o === e || !o.alive || o.decoy || o.team !== e.team) continue;
      if (Math.hypot(o.x - e.x, o.z - e.z) <= r && o.hp / o.maxHp < hurt) n++;
    }
    return n;
  }

  inFight() {
    return this.enemiesWithin(40) > 0 || this.sim.time - this.e.lastHurt < 2.5;
  }

  pickTarget() {
    const sim = this.sim, e = this.e, now = sim.time, wpn = e.hero.weapon;
    let best = null, bs = -Infinity;
    for (const s of this.seen.values()) {
      const o = s.ent;
      if (!this.visible(o)) continue;
      const d = sim.dist(e, o);
      let sc = 100 - d * 1.5 + (1 - o.hp / o.maxHp) * 25;
      if (o === this.target) sc += 14;
      if (o === e.lastHurtBy && now - e.lastHurt < 2) sc += 15;
      if (!o.decoy && sim.inPoint(o)) sc += 8;
      if (o.hero.role === 'support' && e.hero.role !== 'support') sc += 8;
      if (wpn.type === 'flame' && d > wpn.range * 1.6) sc -= 30;
      if (wpn.falloffEnd && d > wpn.falloffEnd * 1.3) sc -= 20;
      // Do not all shoot the same enemy: a small cost for each ally already on it.
      for (const a of sim.ents) if (a !== e && a.team === e.team && a.bot && a.bot.target === o) sc -= 5;
      if (sc > bs) { bs = sc; best = o; }
    }
    if (best !== this.target) this.headShot = sim.rng() < this.skill.headAim && !!wpn.crit;
    this.target = best;

    // Healers also look for a hurt ally.
    this.heal = null;
    if (wpn.heal) {
      let hb = null, hs = 0;
      for (const o of sim.ents) {
        if (o === e || !o.alive || o.decoy || o.team !== e.team) continue;
        const f = o.hp / o.maxHp;
        if (f > 0.93) continue;
        const d = sim.dist(e, o);
        if (d > 38 || !sim.canSee(e, o)) continue;
        const sc = (1 - f) * 100 - d * 0.6 + (o.hero.role === 'tank' ? 6 : 0) + (o === this.heal ? 5 : 0);
        if (sc > hs) { hs = sc; hb = o; }
      }
      if (hb && (hb.hp / hb.maxHp < 0.8 || !this.target)) this.heal = hb;
    }
  }

  // ----- Decisions -------------------------------------------------------

  decide() {
    const sim = this.sim, e = this.e, now = sim.time, o = sim.objective, hero = e.hero;
    const f = e.hp / e.maxHp, team = e.team, foe = 1 - team;
    const pt = sim.map.point;
    const mustFight = (o.owner === foe && o.score[foe] >= 88) || (sim.inPoint(e) && o.score[team] >= 85) || o.overtime;

    if (this.mode === 'retreat') {
      if (f > 0.7 || now > this.retreatUntil || mustFight) { this.mode = 'objective'; this.spotUntil = 0; }
    } else {
      const limit = hero.role === 'tank' ? 0.25 : 0.38;
      if (f < limit && now - e.lastHurt < 3 && !mustFight) {
        this.mode = 'retreat'; this.retreatUntil = now + 7; this.retreats++;
        this.retreatGoal = this.pickRetreat();
      }
    }
    if (this.mode === 'objective' && !this.grouped && !mustFight) {
      const dPoint = Math.hypot(e.x - pt.x, e.z - pt.z);
      if (dPoint > 24 && o.owner !== team && !o.locked && this.alliesWithin(14) < 2) {
        let coming = 0;
        for (const a of sim.ents) {
          if (a === e || a.decoy || a.team !== team) continue;
          if ((a.alive && Math.hypot(a.x - pt.x, a.z - pt.z) > dPoint - 6) || (!a.alive && a.respawnT < 3.5)) coming++;
        }
        if (coming >= 2) { this.mode = 'group'; this.groupUntil = now + 6.5; this.groups++; }
      }
    }
    if (this.mode === 'group') {
      if (this.alliesWithin(12) >= 2 || now > this.groupUntil || now - e.lastHurt < 1 || mustFight) { this.mode = 'objective'; this.grouped = true; }
    }

    // A hurt bot steps onto a friendly healing zone that is close.
    let healSpot = null;
    if (this.mode === 'objective' && f < 0.8 && sim.zones.length) {
      let bd = 11;
      for (const z of sim.zones) {
        if (z.team !== team || (z.type !== 'rangoli' && z.type !== 'marigold')) continue;
        if (z.strip ? onStrip(z, e) : Math.hypot(z.x - e.x, z.z - e.z) < z.radius - 0.5) { healSpot = null; bd = -1; break; }
        let px = z.x, pz = z.z;
        if (z.strip) { const t = Math.max(1, Math.min(z.len - 1, (e.x - z.sx) * z.dx + (e.z - z.sz) * z.dz)); px = z.sx + z.dx * t; pz = z.sz + z.dz * t; }
        const d = Math.hypot(px - e.x, pz - e.z);
        if (d < bd) { bd = d; healSpot = { x: px, y: z.y, z: pz }; }
      }
    }

    let gx, gz, gy = 0;
    if (healSpot) {
      gx = healSpot.x; gz = healSpot.z; gy = healSpot.y;
    } else if (this.mode === 'retreat') {
      gx = this.retreatGoal.x; gz = this.retreatGoal.z; gy = this.retreatGoal.y || 0;
    } else if (this.mode === 'group') {
      const s = sim.map.staging[team][0];
      gx = s.x + ((e.slot % 3) - 1) * 2.2; gz = s.z + ((e.slot % 2) - 0.5) * 3;
    } else {
      if (now > this.spotUntil || !this.spot) this.pickSpot();
      // Somebody has to stand on the fire.
      const mine = o.count[team], theirs = o.count[foe];
      const need = (o.owner !== team && mine === 0) || (o.capTeam === foe && o.cap > 0.2 && mine === 0) || (o.overtime && mine < 2);
      if (need && !sim.inPoint(e) && !this.spot.onPoint) this.pickSpot(true);
      gx = this.spot.x; gz = this.spot.z; gy = this.spot.y;
      const t = this.target;
      if (t && hero.ai.range <= 10) {
        // Close fighters chase, but not far from the fire.
        const leash = hero.role === 'tank' ? (hero.id === 'jun' ? 20 : 13) : 24;
        const push = need || (theirs > 0 && mine === 0);
        if (!push && Math.hypot(t.x - pt.x, t.z - pt.z) < leash) { gx = t.x; gz = t.z; gy = t.y; }
      } else if (this.heal && !t && sim.dist(e, this.heal) > 16) {
        gx = this.heal.x; gz = this.heal.z; gy = this.heal.y;
      } else if (hero.role === 'support' && !this.heal) {
        // Walk to a badly hurt ally that is out of sight.
        for (const a of sim.ents) {
          if (a === e || !a.alive || a.decoy || a.team !== team || a.hp / a.maxHp > 0.5) continue;
          if (Math.hypot(a.x - this.spot.x, a.z - this.spot.z) < 22 && sim.dist(e, a) > 6) { gx = a.x; gz = a.z; gy = a.y; break; }
        }
      }
    }
    const moved = !this.goal || Math.hypot(this.goal.x - gx, this.goal.z - gz) > 2;
    if (moved || now >= this.repathAt || this.pathI >= this.path.length) {
      this.goal = { x: gx, y: gy, z: gz };
      if (Math.hypot(e.x - gx, e.z - gz) > 1.2 || Math.abs(e.y - gy) > 1) {
        this.path = sim.world.findPath(e.x, e.y, e.z, gx, gy, gz, team);
        this.pathI = 0;
      } else { this.path = []; this.pathI = 0; }
      this.repathAt = now + 1 + sim.rng() * 0.5;
    }
    this.smoothPath();
  }

  pickSpot(force) {
    const sim = this.sim, e = this.e, hero = e.hero, pt = sim.map.point, rng = sim.rng;
    const own = e.team === 0 ? -1 : 1;
    this.spotUntil = sim.time + 5 + rng() * 4;
    let x, z, y = pt.y, onPoint = false;
    if (!force && hero.ai.perch && rng() < hero.ai.perch) {
      const list = sim.map.perches[e.team];
      const p = list[rng() < 0.55 ? 0 : 1 + Math.floor(rng() * (list.length - 1))];
      x = p.x + (rng() - 0.5) * 3; z = p.z + (rng() - 0.5) * 2; y = p.y || 0;
    } else {
      const hold = force ? Math.min(hero.ai.hold, 4) : hero.ai.hold;
      const back = hold * (0.45 + rng() * 0.55);
      const side = (rng() - 0.5) * 2 * (2.5 + hold * 0.45);
      x = pt.x + own * back; z = pt.z + side;
      onPoint = Math.hypot(x - pt.x, z - pt.z) < RULES.pointRadius - 0.8;
    }
    const n = sim.world.nearestNode(x, y, z);
    this.spot = { x: n.x, y: n.y, z: n.z, onPoint };
  }

  pickRetreat() {
    const sim = this.sim, e = this.e;
    let best = null, bd = 38;
    for (const p of sim.packs) {
      if (p.readyAt > sim.time + 2) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) return { x: best.x, y: best.y, z: best.z };
    for (const a of sim.ents) {
      if (a === e || !a.alive || a.decoy || a.team !== e.team || a.hero.role !== 'support') continue;
      const d = sim.dist(e, a);
      if (d > 5 && d < 40) return { x: a.x, y: a.y, z: a.z };
    }
    const s = sim.map.staging[e.team][0];
    return { x: s.x, y: 0, z: s.z };
  }

  // Skip path nodes when the straight line is free.
  smoothPath() {
    const e = this.e, w = this.sim.world, nav = w.nav;
    for (let k = 0; k < 3 && this.pathI + 1 < this.path.length; k++) {
      const n = this.path[this.pathI + 1];
      const end = w.walk(e.x, e.y, e.z, n.x, n.z, nav.r, nav.h);
      if (Math.abs(end - n.y) < 0.25 && Math.abs(n.y - e.y) < 1.2) this.pathI++; else break;
    }
  }

  // ----- Movement --------------------------------------------------------

  move(dt) {
    const sim = this.sim, e = this.e, c = e.cmd, now = sim.time, w = sim.world, hero = e.hero;
    let mx = 0, mz = 0, atGoal = true;
    while (this.pathI < this.path.length) {
      const n = this.path[this.pathI];
      const d = Math.hypot(n.x - e.x, n.z - e.z);
      if (d < 0.75 && Math.abs(n.y - e.y) < 0.9) { this.pathI++; continue; }
      mx = (n.x - e.x) / d; mz = (n.z - e.z) / d; atGoal = false;
      break;
    }
    if (atGoal && this.goal) {
      const d = Math.hypot(this.goal.x - e.x, this.goal.z - e.z);
      if (d > 0.9 && d < 4 && Math.abs(this.goal.y - e.y) < 1) { mx = (this.goal.x - e.x) / d; mz = (this.goal.z - e.z) / d; if (d > 2.5) atGoal = false; else { mx *= 0.5; mz *= 0.5; } }
    }
    const t = this.target;
    if (t && this.mode !== 'retreat') {
      if (now > this.strafeUntil) { this.strafe = -this.strafe; this.strafeUntil = now + 0.45 + sim.rng() * 0.9; }
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 1;
      let sx = (-dz / d) * this.strafe, sz = (dx / d) * this.strafe;
      const range = hero.ai.range;
      let bx = 0, bz = 0;
      if (range > 10 && d < range * 0.45) { bx = -dx / d; bz = -dz / d; }
      const wgt = (atGoal ? 1 : 0.4) * this.skill.strafe;
      let tx = mx + sx * wgt + bx * 0.8, tz = mz + sz * wgt + bz * 0.8;
      const l = Math.hypot(tx, tz);
      if (l > 0.01) {
        tx /= l; tz /= l;
        // Do not strafe into a wall or off a ledge.
        const px = e.x + tx * 0.8, pz = e.z + tz * 0.8;
        if (w.blocked(px, pz, e.y, hero.radius, hero.height) || w.groundAt(px, pz, e.y) < e.y - 1.2) {
          this.strafe = -this.strafe; this.strafeUntil = now + 0.5;
        } else { mx = tx; mz = tz; }
      }
    }
    const want = Math.hypot(mx, mz) > 0.3;
    c.moveX = mx; c.moveZ = mz;

    // Stuck handling.
    if (now - this.lastCheck >= 0.5) {
      const moved = Math.hypot(e.x - this.lastX, e.z - this.lastZ);
      if (this.wanted && moved < 0.2 && !atGoal) {
        this.stuckN++;
        this.repathAt = 0;
        if (this.stuckN >= 2) this.jumpNow = true;
        if (this.stuckN >= 7) {
          const n = w.nearestNode(e.x, e.y, e.z);
          e.x = n.x; e.y = n.y; e.z = n.z; e.vx = e.vz = 0;
          this.stuckN = 0; this.teleports++;
        }
      } else this.stuckN = 0;
      this.lastX = e.x; this.lastZ = e.z; this.lastCheck = now; this.wanted = false;
    }
    if (want && !atGoal) this.wanted = true;
    if (this.jumpNow) { c.jump = true; this.jumpNow = false; }
  }

  // ----- Aim and fire ----------------------------------------------------

  aim(dt) {
    const sim = this.sim, e = this.e, c = e.cmd, now = sim.time, wpn = e.hero.weapon, sk = this.skill;
    const ov = this.override;
    if (ov) {
      this.aimYaw = ov.yaw; this.aimPitch = ov.pitch;
      c.yaw = ov.yaw; c.pitch = ov.pitch;
      if (--ov.ticks <= 0) this.override = null;
      return;
    }
    const t = this.heal || this.target;
    let wantYaw, wantPitch = 0, shoot = false;
    if (t && t.alive) {
      const ex = e.x, ey = sim.eyeY(e), ez = e.z;
      let tx = t.x, tz = t.z;
      let ty = this.headShot && t === this.target ? t.y + t.hero.height - 0.25 : sim.chestY(t);
      let d = Math.hypot(tx - ex, ty - ey, tz - ez);
      if (wpn.speed) {
        const time = d / wpn.speed;
        tx += t.vx * time; tz += t.vz * time;
      }
      const dx = tx - ex, dy = ty - ey, dz = tz - ez;
      d = Math.hypot(dx, dy, dz);
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      // A slow, wandering aim error. It grows when the target moves sideways.
      if (now >= this.errAt) {
        const side = Math.abs(t.vx * dz - t.vz * dx) / Math.max(d, 1);
        const mag = sk.aimError * DEG * (1 + side / 7) * (wpn.type === 'flame' ? 0.5 : 1);
        this.errYawT = (sim.rng() + sim.rng() + sim.rng() - 1.5) * 1.15 * mag;
        this.errPitchT = (sim.rng() + sim.rng() + sim.rng() - 1.5) * 0.7 * mag;
        this.errAt = now + 0.2 + sim.rng() * 0.3;
      }
      const ek = 1 - Math.exp(-6 * dt);
      this.errYaw += (this.errYawT - this.errYaw) * ek;
      this.errPitch += (this.errPitchT - this.errPitch) * ek;
      const k = 1 - Math.exp(-sk.aimSpeed * dt);
      this.aimYaw += wrap(wantYaw + this.errYaw - this.aimYaw) * k;
      this.aimPitch += (wantPitch + this.errPitch - this.aimPitch) * k;
      // Fire when the aim is close to the target.
      const off = Math.hypot(wrap(wantYaw - this.aimYaw) * Math.cos(wantPitch), wantPitch - this.aimPitch);
      const size = Math.atan2(t.hero.radius, d);
      let tol, maxD;
      if (wpn.type === 'flame') { tol = wpn.cone * DEG; maxD = wpn.range + t.hero.radius; }
      else if (wpn.zoom) { tol = size * 1.3 + 0.4 * DEG; maxD = wpn.range; }
      else if (wpn.type === 'hitscan') { tol = size * 1.5 + wpn.spread * DEG; maxD = (wpn.falloffEnd || 40) * 1.5; }
      else { tol = size * 1.6 + 1 * DEG; maxD = 48; }
      const s = t.team === e.team ? null : this.seen.get(t.id);
      const fresh = t.team === e.team || (s && now - s.last < 0.3);
      shoot = fresh && off < tol && d <= maxD;
      if (wpn.zoom && d > 14) c.alt = true;
    } else {
      // Look where we walk.
      const sp = Math.hypot(e.vx, e.vz);
      wantYaw = sp > 1 ? Math.atan2(-e.vx, -e.vz) : this.aimYaw;
      const k = 1 - Math.exp(-6 * dt);
      this.aimYaw += wrap(wantYaw - this.aimYaw) * k;
      this.aimPitch += (0 - this.aimPitch) * k;
      if (e.ammo < wpn.mag * 0.5 && e.reloadT <= 0) c.reload = true;
    }
    this.aimYaw = wrap(this.aimYaw);
    c.yaw = this.aimYaw; c.pitch = this.aimPitch;
    c.fire = shoot;
  }

  lookAt(x, y, z, ticks = 2) {
    const e = this.e, dx = x - e.x, dy = y - this.sim.eyeY(e), dz = z - e.z;
    this.override = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), ticks };
    e.cmd.yaw = this.override.yaw; e.cmd.pitch = this.override.pitch;
  }

  lobAt(t, def) {
    const e = this.e, sim = this.sim;
    const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz), dy = t.y + 0.3 - sim.eyeY(e);
    const v = def.speed, g = def.gravity;
    const disc = v ** 4 - g * (g * d * d + 2 * dy * v * v);
    let pitch = disc < 0 ? 0.7 : Math.atan((v * v - Math.sqrt(disc)) / (g * Math.max(d, 0.5)));
    pitch -= Math.atan2(2.5, v) * 0.8;
    const time = d / (v * Math.cos(pitch) || 1);
    const lx = t.x + t.vx * time * 0.6, lz = t.z + t.vz * time * 0.6;
    this.override = { yaw: Math.atan2(-(lx - e.x), -(lz - e.z)), pitch, ticks: 2 };
    e.cmd.yaw = this.override.yaw; e.cmd.pitch = pitch;
  }

  // ----- Abilities -------------------------------------------------------

  // Returns true once the wish has held for the bot's reaction delay.
  ready(slot, wish) {
    const now = this.sim.time;
    if (!wish) { this.pend[slot] = 0; return false; }
    if (!this.pend[slot]) { this.pend[slot] = now + 0.05 + this.sim.rng() * this.skill.abilityDelay; return false; }
    if (now < this.pend[slot]) return false;
    this.pend[slot] = 0;
    return true;
  }

  useAbilities() {
    const sim = this.sim, e = this.e, c = e.cmd, hero = e.hero, now = sim.time;
    const a0 = hero.abilities[0], a1 = hero.abilities[1], ult = hero.ult;
    const can0 = e.cd[0] <= 0, can1 = e.cd[1] <= 0, canU = e.ult >= ult.cost && e.ultUntil <= now;
    const t = this.target, f = e.hp / e.maxHp;
    const d = t ? sim.dist(e, t) : Infinity;
    const hurt = now - e.lastHurt < 1.5;
    const slop = this.sloppy ? 1 : 0;
    const fight = this.inFight();
    switch (hero.id) {
      case 'marta': {
        if (can0 && this.ready(0, t && d > 7 && (hurt || this.alliesWithin(10, 0.85) > 0))) { this.lookAt(t.x, sim.chestY(t), t.z); c.a1 = true; }
        if (can1 && this.ready(1, this.enemiesWithin(a1.radius * 0.8) >= 1)) c.a2 = true;
        const n = this.enemiesWithin(ult.radius * 0.8);
        if (canU && this.ready(2, n >= 3 - slop || (n >= 2 && this.alliesWithin(12) >= 1) || (n >= 1 && sim.objective.overtime))) c.ult = true;
        break;
      }
      case 'jun': {
        if (can0 && this.ready(0, t && d > 7 && d < 17 && f > 0.35 && this.mode !== 'retreat' && Math.abs(t.y - e.y) < 3)) {
          this.lookAt(t.x, sim.eyeY(e) + d * 0.32, t.z); c.a1 = true;
        }
        if (can1 && this.ready(1, fight && (f < 0.7 || this.alliesWithin(a1.radius, 0.75) >= 2))) c.a2 = true;
        const n = this.enemiesWithin(ult.radius * 0.8);
        if (canU && this.ready(2, n >= 2 - slop || (n >= 1 && sim.objective.overtime))) c.ult = true;
        break;
      }
      case 'tamsin': {
        if (can0 && this.ready(0, this.enemiesWithin(8) >= 1 && (f < 0.6 || hurt))) {
          c.a1 = true; this.mode = 'retreat'; this.retreatUntil = now + 3; this.retreatGoal = this.pickRetreat(); this.repathAt = 0;
        }
        if (can1 && this.ready(1, t && d > 6 && d < 24 && !sim.invisible(e))) { this.lobAt(t, a1); c.a2 = true; }
        let n = 0;
        for (const s of this.seen.values()) if (this.visible(s.ent) && sim.dist(e, s.ent) < ult.range) n++;
        if (canU && this.ready(2, n >= 3 - slop || (n >= 2 && sim.objective.overtime))) c.ult = true;
        break;
      }
      case 'pip': {
        const flee = hurt && f < 0.45 && this.enemiesWithin(12) >= 1;
        const close = t && d > 9 && d < 15 && f > 0.6;
        if (can0 && this.ready(0, flee || close)) {
          if (flee && t) { const dx = e.x - t.x, dz = e.z - t.z, l = Math.hypot(dx, dz) || 1; c.moveX = dx / l; c.moveZ = dz / l; }
          else if (t) { const dx = t.x - e.x, dz = t.z - e.z, l = Math.hypot(dx, dz) || 1; c.moveX = dx / l; c.moveZ = dz / l; }
          c.a1 = true;
        }
        if (can1 && this.ready(1, t && d < 11 && d > 2.5)) { this.lobAt(t, a1); c.a2 = true; }
        if (canU && t && d < 16) {
          const n = this.enemiesWithin(ult.radius * 0.75, t.x, t.z);
          if (this.ready(2, n >= 2 - slop || (n >= 1 && sim.objective.overtime && sim.inPoint(t)))) { this.lobAt(t, ult); c.ult = true; }
        } else this.pend[2] = 0;
        break;
      }
      case 'meenal': {
        const near = this.alliesWithin(a0.radius, 0.8) + (f < 0.8 ? 1 : 0);
        if (can0 && this.ready(0, (near >= 2 && fight) || f < 0.5)) c.a1 = true;
        if (can1) {
          let low = null;
          for (const o of sim.ents) {
            if (o === e || !o.alive || o.decoy || o.team !== e.team || o.hp / o.maxHp > 0.55) continue;
            if (sim.dist(e, o) < a1.range && sim.canSee(e, o) && (!low || o.hp / o.maxHp < low.hp / low.maxHp)) low = o;
          }
          if (this.ready(1, low || f < 0.5)) {
            if (low) this.lookAt(low.x, sim.chestY(low), low.z); else this.lookAt(e.x - Math.sin(e.yaw), sim.eyeY(e) + 5, e.z - Math.cos(e.yaw));
            c.a2 = true;
          }
        }
        const hurtN = this.alliesWithin(ult.radius, 0.6) + (f < 0.6 ? 1 : 0);
        if (canU && this.ready(2, fight && (hurtN >= 2 - slop || (hurtN >= 1 && this.alliesWithin(ult.radius) >= 3 && this.enemiesWithin(25) >= 3)))) c.ult = true;
        break;
      }
      case 'chema': {
        // Lay the path over hurt allies, or along the road when the troupe walks in together.
        let hx = 0, hz = 0, hn = 0;
        for (const o of sim.ents) {
          if (o === e || !o.alive || o.decoy || o.team !== e.team || o.hp / o.maxHp > 0.85) continue;
          if (Math.hypot(o.x - e.x, o.z - e.z) < a0.length) { hx += o.x; hz += o.z; hn++; }
        }
        const travel = !fight && this.alliesWithin(9) >= 2 && Math.hypot(e.x, e.z) > 25 && sim.objective.owner !== e.team;
        if (can0 && this.ready(0, (fight && (hn >= 1 || f < 0.6)) || travel)) {
          if (hn && !travel) this.lookAt(hx / hn, sim.eyeY(e), hz / hn);
          else if (travel && Math.hypot(e.vx, e.vz) > 1) this.lookAt(e.x + e.vx, sim.eyeY(e), e.z + e.vz);
          c.a1 = true;
        }
        if (can1 && this.ready(1, t && d < a1.range * 0.9)) { this.lookAt(t.x, sim.chestY(t), t.z); c.a2 = true; }
        if (canU && this.ready(2, this.alliesWithin(ult.radius) >= 2 - slop && this.enemiesWithin(28) >= 2)) c.ult = true;
        break;
      }
    }
  }
}
