// The match simulation. Fixed time step, seeded random numbers, no DOM and no
// renderer. The browser and the headless balance runner both step this code.

import { RULES, HEROES, DIFFICULTY } from '../data/heroes.js';
import { World } from './world.js';
import { ABILITIES, ZONES, updateDeployable } from './abilities.js';
import { Bot } from './bots.js';

export const DT = 1 / RULES.tickRate;
const DEG = Math.PI / 180;

export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let sharedWorld = null;
export function getWorld(map) {
  if (!sharedWorld || sharedWorld.map !== map) {
    sharedWorld = new World(map, RULES);
    sharedWorld.buildNav();
  }
  return sharedWorld;
}

export function aimDir(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp; out.y = Math.sin(pitch); out.z = -Math.cos(yaw) * cp;
  return out;
}

export class Sim {
  // opts: { seed, map, teams: [{heroes:[ids], skill}], human: {team, slot} | null }
  constructor(opts) {
    this.rules = RULES;
    this.map = opts.map;
    this.world = getWorld(opts.map);
    this.rng = makeRng(opts.seed || 1);
    this.tick = 0;
    this.time = 0;
    this.events = [];
    this.ents = [];
    this.projectiles = [];
    this.zones = [];
    this.barriers = [];
    this.deployables = [];
    this.nextId = 1;
    this.over = false;
    this.winner = -1;
    this.objective = {
      locked: true, owner: -1, capTeam: -1, cap: 0, score: [0, 0],
      count: [0, 0], contested: false, overtime: false,
    };
    this.packs = opts.map.packs.map((p) => ({ x: p.x, z: p.z, y: this.world.groundAt(p.x, p.z, 0), readyAt: 0 }));
    this.human = null;
    for (let team = 0; team < 2; team++) {
      const def = opts.teams[team];
      def.heroes.forEach((heroId, slot) => {
        const e = this.makeEnt(team, slot, heroId);
        const isHuman = opts.human && opts.human.team === team && opts.human.slot === slot;
        if (isHuman) { this.human = e; e.isHuman = true; }
        else e.bot = new Bot(this, e, DIFFICULTY[def.skill || 'normal']);
        this.ents.push(e);
        this.spawn(e, true);
      });
    }
    this._v = { x: 0, y: 0, z: 0 };
    this._p = { x: 0, z: 0 };
  }

  makeEnt(team, slot, heroId) {
    const hero = HEROES[heroId];
    return {
      id: this.nextId++, team, slot, heroId, hero, name: hero.name,
      isHuman: false, bot: null, decoy: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
      onGround: true, airT: 0,
      hp: hero.hp, maxHp: hero.hp, shield: 0, shieldUntil: 0,
      alive: true, respawnT: 0, protectUntil: 0, diedAt: -99, killer: null,
      ammo: hero.weapon.mag, reloadT: 0, fireT: 0, flaming: false, zoom: false,
      cd: [0, 0], ult: 0, ultUntil: 0,
      slowUntil: 0, slowMul: 1, hasteUntil: 0, hasteMul: 1,
      ampUntil: 0, ampMul: 1, weakUntil: 0, weakMul: 1,
      boostUntil: 0, boostMul: 1, resistUntil: 0, resistMul: 0,
      stealUntil: 0, stealMul: 0, invisUntil: 0, staggerUntil: 0,
      dots: [], pounce: false, drums: null, lastHurt: -99, lastHurtBy: null, hurtBy: new Map(),
      lastShot: -99,
      cmd: { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, fire: false, alt: false, a1: false, a2: false, ult: false, reload: false },
      stats: { kills: 0, deaths: 0, assists: 0, damage: 0, healing: 0, pointTime: 0, ults: 0, casts: [0, 0], shots: 0, hits: 0, blocked: 0, packs: 0 },
    };
  }

  spawn(e, first) {
    const sp = this.map.spawns[e.team][e.slot % 6];
    e.x = sp.x; e.z = sp.z; e.y = this.world.groundAt(sp.x, sp.z, 0);
    e.vx = e.vy = e.vz = 0;
    e.yaw = e.cmd.yaw = sp.yaw; e.pitch = e.cmd.pitch = 0;
    e.hp = e.maxHp; e.shield = 0; e.alive = true; e.respawnT = 0;
    e.ammo = e.hero.weapon.mag; e.reloadT = 0; e.fireT = 0;
    e.slowUntil = e.hasteUntil = e.ampUntil = e.weakUntil = e.boostUntil = e.resistUntil = e.stealUntil = e.invisUntil = e.staggerUntil = 0;
    e.dots.length = 0; e.pounce = false; e.drums = null; e.onGround = true;
    e.protectUntil = this.time + RULES.spawnShieldTime;
    if (e.bot) e.bot.onSpawn();
    if (!first) this.events.push({ t: 'spawn', ent: e });
  }

  // Change the hero of an entity (used on respawn and in the spawn room).
  setHero(e, heroId) {
    const hero = HEROES[heroId];
    e.heroId = heroId; e.hero = hero; e.name = hero.name; e.maxHp = hero.hp;
    e.cd[0] = e.cd[1] = 0; e.ult = 0; e.ultUntil = 0;
    if (e.alive) { e.hp = hero.hp; e.ammo = hero.weapon.mag; e.reloadT = 0; }
    this.events.push({ t: 'hero', ent: e });
  }

  // ----- Queries ---------------------------------------------------------

  eyeY(e) { return e.y + e.hero.height - 0.18; }
  chestY(e) { return e.y + e.hero.height * 0.62; }
  invisible(e) { return e.invisUntil > this.time; }
  speedOf(e) {
    let s = e.hero.speed;
    if (e.slowUntil > this.time) s *= e.slowMul;
    if (e.hasteUntil > this.time) s *= e.hasteMul;
    return s;
  }
  inPoint(e) {
    const p = this.map.point;
    const dx = e.x - p.x, dz = e.z - p.z;
    return dx * dx + dz * dz <= RULES.pointRadius * RULES.pointRadius && e.y < p.y + RULES.pointHeight;
  }
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

  // Can a see b (chest or head)? Walls block sight, and so do the spawn gates of
  // the other troupe. Wards do not block sight.
  canSee(a, b) {
    const ay = this.eyeY(a);
    return this.world.los(a.x, ay, a.z, b.x, this.chestY(b), b.z, a.team) || this.world.los(a.x, ay, a.z, b.x, b.y + b.hero.height - 0.2, b.z, a.team);
  }

  // Line of fire from a point to an entity for area effects: walls and enemy wards block.
  clearTo(x, y, z, b, team) {
    const by = this.chestY(b);
    if (!this.world.los(x, y, z, b.x, by, b.z, team)) return false;
    return !this.barrierBetween(x, y, z, b.x, by, b.z, team);
  }

  barrierBetween(ax, ay, az, bx, by, bz, team) {
    const bs = this.barriers;
    if (!bs.length) return null;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.team === team) continue;
      const t = rayBarrier(b, ax, ay, az, dx, dy, dz);
      if (t >= 0 && t <= 1) return b;
    }
    return null;
  }

  // Trace a shot. Returns the nearest thing hit.
  // opts: { radius, allies } (allies: also hit hurt allies, for healing shots)
  trace(e, ox, oy, oz, dx, dy, dz, range, opts, out) {
    const team = e.team;
    let t = this.world.raycast(ox, oy, oz, dx, dy, dz, range, team);
    out.kind = t < range ? 'world' : 'none'; out.ent = null; out.barrier = null; out.head = false;
    const bs = this.barriers;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.team === team) continue;
      const tb = rayBarrier(b, ox, oy, oz, dx, dy, dz);
      if (tb >= 0 && tb < t) { t = tb; out.kind = 'barrier'; out.barrier = b; }
    }
    const pr = (opts && opts.radius) || 0;
    const allies = opts && opts.allies;
    const es = this.ents;
    for (let i = 0; i < es.length; i++) {
      const o = es[i];
      if (o === e || !o.alive) continue;
      if (o.team === team) { if (!allies || o.hp >= o.maxHp || o.decoy) continue; }
      const te = rayEnt(o, ox, oy, oz, dx, dy, dz, pr);
      if (te < t) {
        t = te; out.kind = 'ent'; out.ent = o; out.barrier = null;
        out.head = oy + dy * te >= o.y + o.hero.height - 0.52;
      }
    }
    out.t = t;
    return out;
  }

  // ----- Damage, healing, status ----------------------------------------

  damage(target, amount, src, opt) {
    if (!target.alive || this.over) return 0;
    if (target.protectUntil > this.time) return 0;
    let a = amount;
    if (src) {
      if (src.boostUntil > this.time) a *= src.boostMul;
      if (src.weakUntil > this.time) a *= src.weakMul;
    }
    if (target.ampUntil > this.time) a *= target.ampMul;
    if (target.resistUntil > this.time) a *= 1 - target.resistMul;
    let left = a;
    if (target.shield > 0) {
      const s = Math.min(target.shield, left);
      target.shield -= s; left -= s;
    }
    const dealt = Math.min(target.hp, left) + (a - left);
    target.hp -= left;
    target.lastHurt = this.time;
    if (src && src !== target) {
      target.lastHurtBy = src;
      target.hurtBy.set(src.id, this.time);
      if (!target.decoy) {
        src.stats.damage += dealt;
        if (src.ultUntil <= this.time) src.ult = Math.min(src.hero.ult.cost, src.ult + dealt * RULES.ultPerDamage);
        if (src.stealUntil > this.time && src.alive) this.heal(src, dealt * src.stealMul, null, false);
      }
    }
    const kill = target.hp <= 0;
    this.events.push({ t: 'damage', target, src, amount: a, crit: !!(opt && opt.crit), kill, kind: opt && opt.kind });
    if (kill) this.kill(target, src);
    return dealt;
  }

  kill(target, src) {
    target.alive = false; target.hp = 0; target.shield = 0;
    target.respawnT = RULES.respawnTime;
    // The "Remembered" passive of Don Chema: allies come back sooner while he stands.
    for (const a of this.ents) {
      if (a !== target && a.alive && !a.decoy && a.team === target.team && a.hero.passive && a.hero.passive.id === 'remembered') { target.respawnT -= a.hero.passive.respawn; break; }
    }
    target.diedAt = this.time; target.killer = src || null;
    target.dots.length = 0; target.drums = null; target.flaming = false; target.invisUntil = 0;
    if (target.decoy) { this.events.push({ t: 'decoyEnd', ent: target }); return; }
    target.stats.deaths++;
    const assists = [];
    if (src && src !== target) {
      src.stats.kills++;
      for (const [id, when] of target.hurtBy) {
        if (id === src.id || this.time - when > 6) continue;
        const a = this.ents.find((o) => o.id === id);
        if (a) { a.stats.assists++; assists.push(a); }
      }
    }
    target.hurtBy.clear();
    this.events.push({ t: 'kill', target, src, assists });
  }

  heal(target, amount, src, burst) {
    if (!target.alive || target.decoy) return 0;
    const a = Math.min(amount, target.maxHp - target.hp);
    if (a <= 0) return 0;
    target.hp += a;
    if (src) {
      src.stats.healing += a;
      if (src.ultUntil <= this.time) src.ult = Math.min(src.hero.ult.cost, src.ult + a * RULES.ultPerHeal);
    }
    if (burst) this.events.push({ t: 'heal', target, src, amount: a });
    return a;
  }

  // kind: slow | haste | amp | weak | boost | resist | steal
  status(e, kind, mul, dur) {
    const uk = kind + 'Until', mk = kind + 'Mul';
    const until = this.time + dur;
    const active = e[uk] > this.time;
    const stronger = kind === 'slow' || kind === 'weak' ? mul < e[mk] : mul > e[mk];
    if (!active || stronger) { e[uk] = until; e[mk] = mul; }
    else if (mul === e[mk] && until > e[uk]) e[uk] = until;
  }

  knock(e, vx, vy, vz, stagger) {
    if (!e.alive || e.protectUntil > this.time) return;
    e.vx = vx; e.vz = vz; e.vy = Math.max(e.vy, vy);
    e.onGround = false; e.airT = 1;
    e.staggerUntil = Math.max(e.staggerUntil, this.time + stagger);
  }

  // Area damage with a clear line from the centre.
  explode(x, y, z, radius, dmg, minDmg, src, opt) {
    const hit = [];
    for (const o of this.ents) {
      if (!o.alive || o.team === src.team) continue;
      const d = Math.hypot(o.x - x, this.chestY(o) - y, o.z - z) - o.hero.radius;
      if (d > radius) continue;
      if (!this.clearTo(x, y + 0.3, z, o, src.team)) continue;
      const f = Math.max(0, Math.min(1, d / radius));
      hit.push(o);
      if (opt && opt.each) opt.each(o, f);
      this.damage(o, dmg + (minDmg - dmg) * f, src, { kind: opt && opt.kind });
    }
    return hit;
  }

  // ----- Step ------------------------------------------------------------

  step() {
    if (this.over) return;
    this.tick++;
    this.time = this.tick * DT;
    const es = this.ents, n = es.length;
    // First every bot decides, from the same picture of the world. Then everybody
    // acts. The acting order flips each tick, so no troupe always shoots first.
    for (let i = 0; i < n; i++) { const e = es[i]; if (e.alive && e.bot && !e.decoy) e.bot.think(DT); }
    const fwd = (this.tick & 1) === 0;
    for (let k = 0; k < n; k++) {
      const e = es[fwd ? k : n - 1 - k];
      if (e.decoy) { this.updateDecoy(e); continue; }
      if (!e.alive) {
        e.respawnT -= DT;
        if (e.respawnT <= 0) this.spawn(e, false);
        continue;
      }
      this.updateEnt(e);
    }
    for (let i = es.length - 1; i >= 0; i--) if (es[i].decoy && !es[i].alive) es.splice(i, 1);
    this.separate();
    this.updateProjectiles();
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (z.until <= this.time || (z.follow && !z.owner.alive)) { this.zones.splice(i, 1); this.events.push({ t: 'zoneEnd', zone: z }); continue; }
      if (z.follow) { z.x = z.owner.x; z.y = z.owner.y; z.z = z.owner.z; }
      ZONES[z.type](this, z, DT);
    }
    for (let i = this.barriers.length - 1; i >= 0; i--) {
      const b = this.barriers[i];
      if (b.until <= this.time || b.hp <= 0) { this.barriers.splice(i, 1); this.events.push({ t: 'barrierEnd', barrier: b, broken: b.hp <= 0 }); }
    }
    for (let i = this.deployables.length - 1; i >= 0; i--) {
      if (!updateDeployable(this, this.deployables[i])) this.deployables.splice(i, 1);
    }
    this.updatePacks();
    this.updateObjective();
  }

  updateEnt(e) {
    const c = e.cmd, w = this.world, hero = e.hero, now = this.time;
    e.yaw = c.yaw; e.pitch = c.pitch;

    // Damage over time.
    for (let i = e.dots.length - 1; i >= 0; i--) {
      const d = e.dots[i];
      d.acc += d.dps * DT;
      if (d.acc >= d.dps * 0.25 || d.until <= now) { this.damage(e, d.acc, d.src, { kind: d.kind }); d.acc = 0; if (!e.alive) return; }
      if (d.until <= now) e.dots.splice(i, 1);
    }
    if (e.shield > 0 && e.shieldUntil <= now) e.shield = 0;
    if (e.ultUntil <= now && e.ult < hero.ult.cost) e.ult = Math.min(hero.ult.cost, e.ult + RULES.ultPassive * DT);

    // Movement.
    const speed = this.speedOf(e);
    let mx = c.moveX, mz = c.moveZ;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const staggered = e.staggerUntil > now;
    if (e.onGround && !staggered) {
      const tx = mx * speed, tz = mz * speed;
      let dx = tx - e.vx, dz = tz - e.vz;
      const dl = Math.hypot(dx, dz);
      const acc = (ml > 0.01 ? RULES.groundAccel : RULES.groundFriction) * DT;
      if (dl > acc) { dx *= acc / dl; dz *= acc / dl; }
      e.vx += dx; e.vz += dz;
    } else if (ml > 0.01) {
      const along = e.vx * mx + e.vz * mz;
      const add = Math.min(RULES.airAccel * (staggered ? 0.3 : 1) * DT, Math.max(0, speed - along));
      e.vx += mx * add; e.vz += mz * add;
    } else if (e.onGround) {
      const dl = Math.hypot(e.vx, e.vz), acc = RULES.groundFriction * 0.5 * DT;
      if (dl > acc) { e.vx -= (e.vx / dl) * acc; e.vz -= (e.vz / dl) * acc; } else { e.vx = e.vz = 0; }
    }
    if (c.jump && (e.onGround || e.airT < 0.1) && e.vy <= 0.01 && !staggered) {
      e.vy = RULES.jumpVel; e.onGround = false; e.airT = 1;
      this.events.push({ t: 'jump', ent: e });
    }
    e.vy -= RULES.gravity * DT;

    const p = this._p;
    p.x = e.x + e.vx * DT; p.z = e.z + e.vz * DT;
    const ox = p.x, oz = p.z;
    if (w.resolve(p, e.y, hero.radius, hero.height, e.team)) {
      // Lose the speed that went into the wall.
      const nx = p.x - ox, nz = p.z - oz, nl = Math.hypot(nx, nz);
      if (nl > 1e-5) {
        const d = (e.vx * nx + e.vz * nz) / nl;
        if (d < 0) { e.vx -= (d * nx) / nl; e.vz -= (d * nz) / nl; }
      }
    }
    const b = this.map.bounds;
    e.x = Math.max(b.x0 + 1, Math.min(b.x1 - 1, p.x));
    e.z = Math.max(b.z0 + 1, Math.min(b.z1 - 1, p.z));

    let ny = e.y + e.vy * DT;
    const g = w.groundAt(e.x, e.z, e.y);
    const wasGround = e.onGround;
    if (e.vy <= 0 && (ny <= g || (wasGround && ny - g < RULES.stepHeight))) {
      if (!wasGround) {
        this.events.push({ t: 'land', ent: e, speed: -e.vy });
        if (e.pounce) ABILITIES.pounce.land(this, e);
      }
      ny = g; e.vy = 0; e.onGround = true; e.airT = 0;
    } else {
      if (wasGround && g > e.y && g - e.y <= RULES.stepHeight && e.vy <= 0) { ny = g; e.vy = 0; }
      else { e.onGround = false; e.airT += DT; }
      if (e.vy > 0) {
        const ceil = w.ceilingAt(e.x, e.z, e.y + hero.height);
        if (ny + hero.height > ceil) { ny = ceil - hero.height; e.vy = 0; }
      }
    }
    e.y = ny;
    if (this.inPoint(e)) e.stats.pointTime += DT;

    // Timers.
    if (e.fireT > 0) e.fireT -= DT;
    if (e.cd[0] > 0) e.cd[0] -= DT;
    if (e.cd[1] > 0) e.cd[1] -= DT;
    const wpn = hero.weapon;
    if (e.reloadT > 0) {
      e.reloadT -= DT;
      if (e.reloadT <= 0) { e.ammo = wpn.mag; e.reloadT = 0; }
    }
    e.zoom = !!(c.alt && wpn.zoom && e.reloadT <= 0);

    // Abilities.
    const invis = e.invisUntil > now;
    if (c.a1 && e.cd[0] <= 0) this.cast(e, 0);
    if (c.a2 && e.cd[1] <= 0) this.cast(e, 1);
    if (c.ult && e.ult >= hero.ult.cost && e.ultUntil <= now) {
      if (ABILITIES[hero.ult.id].cast(this, e, hero.ult)) {
        e.ult = 0; e.stats.ults++;
        e.ultUntil = now + (hero.ult.duration || (hero.ult.beats ? hero.ult.beats * hero.ult.interval : 1));
        this.events.push({ t: 'cast', ent: e, id: hero.ult.id, slot: 2 });
      }
    }
    if (e.drums) ABILITIES.drums.tick(this, e);

    // Weapon.
    e.flaming = false;
    if (c.reload && e.reloadT <= 0 && e.ammo < wpn.mag) this.startReload(e);
    if (c.fire && !invis && e.reloadT <= 0 && e.fireT <= 0) {
      if (e.ammo > 0) this.fire(e, wpn);
      else this.startReload(e);
    } else if (c.fire && wpn.type === 'flame' && !invis && e.reloadT <= 0 && e.ammo > 0) e.flaming = true;
  }

  cast(e, i) {
    const def = e.hero.abilities[i];
    if (!ABILITIES[def.id].cast(this, e, def)) return;
    e.cd[i] = def.cooldown;
    e.stats.casts[i]++;
    this.events.push({ t: 'cast', ent: e, id: def.id, slot: i });
  }

  startReload(e) {
    e.reloadT = e.hero.weapon.reload;
    this.events.push({ t: 'reload', ent: e });
  }

  fire(e, wpn) {
    const v = this._v, rng = this.rng;
    e.fireT += 1 / wpn.rate;
    if (e.fireT < 0) e.fireT = 0;
    e.ammo--;
    e.lastShot = this.time;
    e.stats.shots++;
    const ox = e.x, oy = this.eyeY(e), oz = e.z;
    let spread = (wpn.spread || 0) * DEG;
    if (wpn.zoom && !e.zoom) spread += 0.5 * DEG;
    const yaw = e.yaw + (rng() + rng() - 1) * spread;
    const pitch = e.pitch + (rng() + rng() - 1) * spread;
    aimDir(yaw, pitch, v);
    if (wpn.type === 'hitscan') {
      const h = this.trace(e, ox, oy, oz, v.x, v.y, v.z, wpn.range, null, (this._h || (this._h = {})));
      let dealt = 0;
      if (h.kind === 'ent') {
        let dmg = wpn.damage;
        if (wpn.falloffEnd) {
          const f = Math.max(0, Math.min(1, (h.t - wpn.falloffStart) / (wpn.falloffEnd - wpn.falloffStart)));
          dmg *= 1 - f * (1 - wpn.falloffMin);
        }
        const crit = h.head && wpn.crit && !h.ent.decoy;
        if (crit) dmg *= wpn.crit;
        dealt = this.damage(h.ent, dmg, e, { crit });
        e.stats.hits++;
      } else if (h.kind === 'barrier') {
        h.barrier.hp -= wpn.damage; e.stats.blocked += wpn.damage;
        this.events.push({ t: 'barrierHit', barrier: h.barrier, x: ox + v.x * h.t, y: oy + v.y * h.t, z: oz + v.z * h.t });
      }
      this.events.push({ t: 'shot', ent: e, ox, oy, oz, x: ox + v.x * h.t, y: oy + v.y * h.t, z: oz + v.z * h.t, hit: h.kind, dealt });
    } else if (wpn.type === 'projectile') {
      this.projectiles.push({
        id: this.nextId++, kind: e.heroId === 'jun' ? 'cracker' : e.heroId === 'meenal' ? 'spark' : 'note',
        owner: e, team: e.team, x: ox + v.x * 0.4, y: oy + v.y * 0.4 - 0.08, z: oz + v.z * 0.4,
        vx: v.x * wpn.speed, vy: v.y * wpn.speed, vz: v.z * wpn.speed,
        gravity: 0, radius: wpn.radius, damage: wpn.damage, heal: wpn.heal || 0, life: 2.2,
      });
      this.events.push({ t: 'fire', ent: e });
    } else if (wpn.type === 'flame') {
      e.flaming = true;
      this.events.push({ t: 'fire', ent: e });
      const cosCone = Math.cos(wpn.cone * DEG);
      let any = false;
      for (const o of this.ents) {
        if (!o.alive || o.team === e.team) continue;
        const dx = o.x - ox, dy = this.chestY(o) - oy, dz = o.z - oz;
        const d = Math.hypot(dx, dy, dz);
        if (d - o.hero.radius > wpn.range) continue;
        // Wider cone when the target is close, so a big body near you still burns.
        const slack = Math.atan2(o.hero.radius, Math.max(d, 0.5));
        const dot = (dx * v.x + dy * v.y + dz * v.z) / Math.max(d, 1e-3);
        if (dot < Math.cos(Math.min(Math.PI / 2, wpn.cone * DEG + slack)) && dot < cosCone) continue;
        if (!this.world.los(ox, oy, oz, o.x, this.chestY(o), o.z, e.team)) continue;
        const bar = this.barrierBetween(ox, oy, oz, o.x, this.chestY(o), o.z, e.team);
        if (bar) { bar.hp -= wpn.damage; e.stats.blocked += wpn.damage; continue; }
        this.damage(o, wpn.damage, e, { kind: 'flame' });
        any = true;
      }
      if (any) e.stats.hits++;
    }
    if (e.ammo <= 0) this.startReload(e);
  }

  updateProjectiles() {
    const ps = this.projectiles, h = this._ph || (this._ph = {});
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= DT;
      p.vy -= p.gravity * DT;
      const dx = p.vx * DT, dy = p.vy * DT, dz = p.vz * DT;
      const d = Math.hypot(dx, dy, dz);
      let done = p.life <= 0;
      if (d > 1e-6) {
        this.trace(p.owner, p.x, p.y, p.z, dx / d, dy / d, dz / d, d, { radius: p.radius, allies: p.heal > 0 }, h);
        if (h.kind !== 'none') {
          const hx = p.x + (dx / d) * h.t, hy = p.y + (dy / d) * h.t, hz = p.z + (dz / d) * h.t;
          this.hitProjectile(p, h, hx, hy, hz);
          done = true;
        } else { p.x += dx; p.y += dy; p.z += dz; }
      }
      if (done) ps.splice(i, 1);
    }
  }

  hitProjectile(p, h, x, y, z) {
    const e = p.owner;
    if (p.onHit) { p.onHit(this, p, h, x, y, z); return; }
    if (h.kind === 'ent') {
      if (h.ent.team === p.team) this.heal(h.ent, p.heal, e, true);
      else { this.damage(h.ent, p.damage, e, {}); }
      e.stats.hits++;
    } else if (h.kind === 'barrier') {
      h.barrier.hp -= p.damage; e.stats.blocked += p.damage;
      this.events.push({ t: 'barrierHit', barrier: h.barrier, x, y, z });
    }
    this.events.push({ t: 'impact', kind: p.kind, x, y, z, hit: h.kind, team: p.team });
  }

  updateDecoy(e) {
    if (!e.alive) return;
    if (this.time >= e.expireAt) { e.alive = false; this.events.push({ t: 'decoyEnd', ent: e }); return; }
    const p = this._p;
    p.x = e.x + e.vx * DT; p.z = e.z + e.vz * DT;
    if (this.world.resolve(p, e.y, e.hero.radius, e.hero.height, e.team)) { e.vx = e.vz = 0; }
    e.x = p.x; e.z = p.z;
    e.y = this.world.groundAt(e.x, e.z, e.y);
  }

  // Enemies push each other apart. Allies walk through each other.
  separate() {
    const es = this.ents;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (!a.alive || a.decoy) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (!b.alive || b.decoy || b.team === a.team) continue;
        const dx = b.x - a.x, dz = b.z - a.z, r = a.hero.radius + b.hero.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-8 || Math.abs(a.y - b.y) > 1.6) continue;
        const d = Math.sqrt(d2), push = (r - d) * 0.5;
        a.x -= (dx / d) * push; a.z -= (dz / d) * push;
        b.x += (dx / d) * push; b.z += (dz / d) * push;
      }
    }
  }

  updatePacks() {
    for (let i = 0; i < this.packs.length; i++) {
      const p = this.packs[i];
      if (p.readyAt > this.time) continue;
      for (const e of this.ents) {
        if (!e.alive || e.decoy || e.hp >= e.maxHp) continue;
        const dx = e.x - p.x, dz = e.z - p.z;
        if (dx * dx + dz * dz > (RULES.packRadius + e.hero.radius) ** 2 || Math.abs(e.y - p.y) > 1.5) continue;
        this.heal(e, RULES.packHeal, null, true);
        e.stats.packs++;
        p.readyAt = this.time + RULES.packRespawn;
        this.events.push({ t: 'pack', index: i, ent: e });
        break;
      }
    }
  }

  updateObjective() {
    const o = this.objective, now = this.time;
    if (o.locked) {
      if (now >= RULES.unlockDelay) { o.locked = false; this.events.push({ t: 'point', kind: 'unlocked' }); }
      else return;
    }
    let n0 = 0, n1 = 0;
    for (const e of this.ents) {
      if (!e.alive || e.decoy || !this.inPoint(e)) continue;
      if (e.team === 0) n0++; else n1++;
    }
    o.count[0] = n0; o.count[1] = n1;
    const wasContested = o.contested;
    o.contested = n0 > 0 && n1 > 0;
    if (o.contested && !wasContested) this.events.push({ t: 'point', kind: 'contested' });
    const only = n0 > 0 && n1 === 0 ? 0 : n1 > 0 && n0 === 0 ? 1 : -1;
    if (only >= 0 && only !== o.owner) {
      const n = only === 0 ? n0 : n1;
      const rate = RULES.captureBonus[Math.min(n, RULES.captureBonus.length - 1)] / RULES.captureTime;
      if (o.capTeam !== only && o.cap > 0) {
        o.cap -= rate * 2 * DT;
        if (o.cap <= 0) { o.cap = 0; o.capTeam = only; }
      } else {
        o.capTeam = only;
        o.cap += rate * DT;
        if (o.cap >= 1) {
          const prev = o.owner;
          o.owner = only; o.cap = 0; o.capTeam = -1;
          this.events.push({ t: 'point', kind: 'captured', team: only, prev });
        }
      }
    } else if (!o.contested && o.cap > 0) {
      o.cap = Math.max(0, o.cap - RULES.captureDecay * DT);
      if (o.cap === 0) o.capTeam = -1;
    }
    if (o.owner >= 0) {
      const enemyOn = o.owner === 0 ? n1 > 0 : n0 > 0;
      const s = o.score[o.owner] + RULES.scoreRate * DT;
      if (s >= 100 && enemyOn) {
        o.score[o.owner] = 99.9;
        if (!o.overtime) { o.overtime = true; this.events.push({ t: 'point', kind: 'overtime' }); }
      } else {
        o.score[o.owner] = Math.min(100, s);
        if (o.overtime && !enemyOn) o.overtime = false;
      }
      if (o.score[o.owner] >= 100) return this.finish(o.owner);
    }
    if (now >= RULES.matchTime) {
      // Time is up. While the fire is fought over, play on for a short time.
      if (o.contested && now < RULES.matchTime + 45) {
        if (!o.overtime) { o.overtime = true; this.events.push({ t: 'point', kind: 'overtime' }); }
        return;
      }
      let w = o.score[0] > o.score[1] ? 0 : o.score[1] > o.score[0] ? 1 : o.owner;
      if (w < 0) w = o.capTeam >= 0 ? o.capTeam : this.rng() < 0.5 ? 0 : 1;
      this.finish(w);
    }
  }

  finish(team) {
    this.over = true;
    this.winner = team;
    this.events.push({ t: 'end', winner: team });
  }
}

// Ray against a ward (a flat upright rectangle). Returns t along (dx,dy,dz), or -1.
export function rayBarrier(b, ox, oy, oz, dx, dy, dz) {
  const den = dx * b.nx + dz * b.nz;
  if (Math.abs(den) < 1e-6) return -1;
  const t = ((b.x - ox) * b.nx + (b.z - oz) * b.nz) / den;
  if (t < 0) return -1;
  const py = oy + dy * t;
  if (py < b.y || py > b.y + b.h) return -1;
  const lat = (ox + dx * t - b.x) * b.tx + (oz + dz * t - b.z) * b.tz;
  if (Math.abs(lat) > b.w / 2) return -1;
  return t;
}

// Ray against a hero: an upright cylinder. Returns distance or Infinity.
export function rayEnt(o, ox, oy, oz, dx, dy, dz, pad) {
  const r = o.hero.radius + pad;
  const y0 = o.y - pad, y1 = o.y + o.hero.height + pad;
  const px = ox - o.x, pz = oz - o.z;
  const a = dx * dx + dz * dz;
  const b = px * dx + pz * dz;
  const c = px * px + pz * pz - r * r;
  if (a < 1e-9) {
    if (c > 0) return Infinity;
    const t = dy > 0 ? (y0 - oy) / dy : (y1 - oy) / dy;
    return t >= 0 ? t : (oy >= y0 && oy <= y1 ? 0 : Infinity);
  }
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t0 = (-b - sq) / a;
  const t1 = (-b + sq) / a;
  if (t1 < 0) return Infinity;
  if (t0 < 0) t0 = 0;
  const ya = oy + dy * t0;
  if (ya >= y0 && ya <= y1) return t0;
  // Entered above or below: try the caps.
  if (Math.abs(dy) < 1e-9) return Infinity;
  const tc = ya > y1 ? (y1 - oy) / dy : (y0 - oy) / dy;
  if (tc >= t0 && tc <= t1) return tc;
  return Infinity;
}
