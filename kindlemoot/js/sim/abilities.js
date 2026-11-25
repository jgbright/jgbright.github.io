// Ability rules. Every number comes from the hero data file; this file only
// holds what each ability does.

import { aimDir } from './sim.js';

const DEG = Math.PI / 180;
const v = { x: 0, y: 0, z: 0 };

function addZone(sim, e, type, def, follow, extra) {
  const z = {
    id: sim.nextId++, type, owner: e, team: e.team, follow,
    x: e.x, y: e.y, z: e.z, radius: def.radius, born: sim.time, until: sim.time + def.duration, def, ...extra,
  };
  sim.zones.push(z);
  sim.events.push({ t: 'zone', zone: z });
  return z;
}

function lob(sim, e, kind, def, onHit) {
  aimDir(e.yaw, e.pitch, v);
  const p = {
    id: sim.nextId++, kind, owner: e, team: e.team,
    x: e.x + v.x * 0.5, y: sim.eyeY(e) + v.y * 0.5 - 0.1, z: e.z + v.z * 0.5,
    vx: v.x * def.speed, vy: v.y * def.speed + 2.5, vz: v.z * def.speed,
    gravity: def.gravity, radius: 0.25, damage: 0, heal: 0, life: 6, def, onHit,
  };
  sim.projectiles.push(p);
  return p;
}

function inRadius(sim, x, y, z, r, o) {
  return Math.hypot(o.x - x, o.z - z) - o.hero.radius <= r && Math.abs(o.y - y) < 4;
}

export const ABILITIES = {
  // ----- Marta ---------------------------------------------------------
  ward: {
    cast(sim, e, def) {
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      const b = {
        id: sim.nextId++, team: e.team, owner: e,
        x: e.x + fx * def.distance, z: e.z + fz * def.distance, y: e.y - 0.2,
        nx: fx, nz: fz, tx: -fz, tz: fx, yaw: e.yaw,
        w: def.width, h: def.height + 0.2, hp: def.hp, maxHp: def.hp, born: sim.time, until: sim.time + def.duration,
      };
      sim.barriers.push(b);
      sim.events.push({ t: 'barrier', barrier: b });
      return true;
    },
  },
  slam: {
    cast(sim, e, def) {
      sim.events.push({ t: 'explode', kind: 'slam', x: e.x, y: e.y, z: e.z, radius: def.radius, team: e.team });
      for (const o of sim.ents) {
        if (!o.alive || o.team === e.team || !inRadius(sim, e.x, e.y, e.z, def.radius, o)) continue;
        if (!sim.clearTo(e.x, sim.chestY(e), e.z, o, e.team)) continue;
        const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot(dx, dz) || 1;
        sim.damage(o, def.damage, e, { kind: 'slam' });
        sim.knock(o, (dx / d) * def.knockback, def.lift, (dz / d) * def.knockback, 0.45);
      }
      return true;
    },
  },
  longnight: {
    cast(sim, e, def) { addZone(sim, e, 'longnight', def, true); return true; },
  },

  // ----- Jun -----------------------------------------------------------
  pounce: {
    cast(sim, e, def) {
      aimDir(e.yaw, Math.max(-0.2, Math.min(0.9, e.pitch)), v);
      const hl = Math.hypot(v.x, v.z) || 1;
      e.vx = (v.x / hl) * def.speed * Math.max(0.55, hl);
      e.vz = (v.z / hl) * def.speed * Math.max(0.55, hl);
      e.vy = def.lift + Math.max(0, v.y) * 5;
      e.onGround = false; e.airT = 1; e.pounce = true;
      e.staggerUntil = sim.time + 0.15;
      return true;
    },
    land(sim, e) {
      e.pounce = false;
      const def = e.hero.abilities[0];
      sim.events.push({ t: 'explode', kind: 'pounce', x: e.x, y: e.y, z: e.z, radius: def.radius, team: e.team });
      for (const o of sim.ents) {
        if (!o.alive || o.team === e.team || !inRadius(sim, e.x, e.y, e.z, def.radius, o)) continue;
        if (!sim.clearTo(e.x, sim.chestY(e), e.z, o, e.team)) continue;
        const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot(dx, dz) || 1;
        sim.damage(o, def.damage, e, { kind: 'pounce' });
        sim.knock(o, (dx / d) * def.knockback, 3.5, (dz / d) * def.knockback, 0.35);
      }
    },
  },
  luckyred: {
    cast(sim, e, def) {
      for (const o of sim.ents) {
        if (!o.alive || o.decoy || o.team !== e.team) continue;
        if (o !== e && !inRadius(sim, e.x, e.y, e.z, def.radius, o)) continue;
        const amount = o === e ? def.self : def.allies;
        o.shield = Math.max(o.shield, amount);
        o.shieldUntil = sim.time + def.duration;
        sim.events.push({ t: 'buff', kind: 'luckyred', ent: o, src: e });
      }
      return true;
    },
  },
  drums: {
    cast(sim, e, def) {
      e.drums = { left: def.beats, next: sim.time + 0.25 };
      sim.status(e, 'resist', def.resist, def.beats * def.interval + 0.3);
      return true;
    },
    tick(sim, e) {
      const d = e.drums, def = e.hero.ult;
      if (sim.time < d.next) return;
      d.left--; d.next += def.interval;
      sim.events.push({ t: 'explode', kind: 'drum', x: e.x, y: e.y, z: e.z, radius: def.radius, team: e.team });
      for (const o of sim.ents) {
        if (!o.alive || o.team === e.team || !inRadius(sim, e.x, e.y, e.z, def.radius, o)) continue;
        if (!sim.clearTo(e.x, sim.chestY(e), e.z, o, e.team)) continue;
        sim.damage(o, def.damage, e, { kind: 'drum' });
        sim.status(o, 'slow', 1 - def.slow, def.slowTime);
      }
      if (d.left <= 0) e.drums = null;
    },
  },

  // ----- Tamsin --------------------------------------------------------
  guise: {
    cast(sim, e, def) {
      e.invisUntil = sim.time + def.duration;
      sim.status(e, 'haste', def.speed, def.duration);
      return true;
    },
  },
  jackobomb: {
    cast(sim, e, def) {
      lob(sim, e, 'bomb', def, (s, p, h, x, y, z) => {
        s.events.push({ t: 'explode', kind: 'bomb', x, y, z, radius: def.radius, team: p.team });
        s.explode(x, y, z, def.radius, def.damage, def.minDamage, p.owner, { kind: 'bomb' });
      });
      return true;
    },
  },
  crows: {
    cast(sim, e, def) {
      let n = 0;
      for (const o of sim.ents) {
        if (!o.alive || o.team === e.team || sim.invisible(o)) continue;
        if (sim.dist(e, o) > def.range || !sim.canSee(e, o)) continue;
        o.dots.push({ dps: def.damage / def.duration, until: sim.time + def.duration, src: e, acc: 0, kind: 'crow' });
        sim.events.push({ t: 'crow', src: e, target: o, duration: def.duration });
        n++;
      }
      return n > 0;
    },
  },

  // ----- Pip -----------------------------------------------------------
  gotcha: {
    cast(sim, e, def) {
      let dx = e.cmd.moveX, dz = e.cmd.moveZ;
      const l = Math.hypot(dx, dz);
      if (l < 0.2) { dx = -Math.sin(e.yaw); dz = -Math.cos(e.yaw); } else { dx /= l; dz /= l; }
      const w = sim.world, hero = e.hero;
      const sx = e.x, sy = e.y, sz = e.z;
      let x = e.x, y = e.y, z = e.z;
      const n = Math.ceil(def.distance / 0.3);
      for (let i = 1; i <= n; i++) {
        const nx = sx + (dx * def.distance * i) / n, nz = sz + (dz * def.distance * i) / n;
        if (w.blocked(nx, nz, y, hero.radius, hero.height)) break;
        const b = sim.map.bounds;
        if (nx < b.x0 + 1 || nx > b.x1 - 1 || nz < b.z0 + 1 || nz > b.z1 - 1) break;
        let stop = false;
        for (const g of sim.map.gates) {
          if (g.team !== e.team && nx > g.x0 - hero.radius && nx < g.x1 + hero.radius && nz > g.z0 - hero.radius && nz < g.z1 + hero.radius) stop = true;
        }
        if (stop) break;
        x = nx; z = nz; y = Math.max(w.groundAt(nx, nz, y), Math.min(y, sy));
      }
      // The copy stays behind and walks on the way you faced.
      const d = sim.makeEnt(e.team, e.slot, e.heroId);
      d.decoy = true; d.owner = e; d.x = sx; d.y = sy; d.z = sz; d.yaw = e.yaw; d.pitch = 0;
      d.hp = d.maxHp = def.decoyHp; d.expireAt = sim.time + def.decoyTime;
      d.vx = -Math.sin(e.yaw) * 2.2; d.vz = -Math.cos(e.yaw) * 2.2;
      sim.ents.push(d);
      e.x = x; e.z = z; e.y = y;
      if (y > w.groundAt(x, z, y) + 0.05) { e.onGround = false; e.airT = 1; }
      sim.events.push({ t: 'blink', ent: e, fx: sx, fy: sy, fz: sz, x, y, z, decoy: d });
      return true;
    },
  },
  whoopee: {
    cast(sim, e, def) {
      lob(sim, e, 'whoopee', def, (s, p, h, x, y, z) => {
        for (let i = s.deployables.length - 1; i >= 0; i--) {
          const o = s.deployables[i];
          if (o.type === 'whoopee' && o.owner === p.owner) { s.deployables.splice(i, 1); s.events.push({ t: 'deployEnd', dep: o }); }
        }
        const dep = { id: s.nextId++, type: 'whoopee', owner: p.owner, team: p.team, x, y: s.world.groundAt(x, z, y + 0.3), z, armAt: s.time + def.arm, until: s.time + def.life, def };
        s.deployables.push(dep);
        s.events.push({ t: 'deploy', dep });
      });
      return true;
    },
  },
  jackbox: {
    cast(sim, e, def) {
      lob(sim, e, 'jackbox', def, (s, p, h, x, y, z) => {
        const dep = { id: s.nextId++, type: 'jackbox', owner: p.owner, team: p.team, x, y: s.world.groundAt(x, z, y + 0.3), z, popAt: s.time + def.fuse, until: s.time + def.fuse + 1, def };
        s.deployables.push(dep);
        s.events.push({ t: 'deploy', dep });
      });
      return true;
    },
  },

  // ----- Meenal --------------------------------------------------------
  rangoli: {
    cast(sim, e, def) { addZone(sim, e, 'rangoli', def, false); return true; },
  },
  sweetbox: {
    cast(sim, e, def) {
      aimDir(e.yaw, e.pitch, v);
      const ox = e.x, oy = sim.eyeY(e), oz = e.z;
      let best = null, bs = Math.cos(def.cone * DEG);
      for (const o of sim.ents) {
        if (o === e || !o.alive || o.decoy || o.team !== e.team) continue;
        const dx = o.x - ox, dy = sim.chestY(o) - oy, dz = o.z - oz;
        const d = Math.hypot(dx, dy, dz);
        if (d > def.range) continue;
        const dot = (dx * v.x + dy * v.y + dz * v.z) / Math.max(d, 1e-3);
        if (dot <= bs || !sim.canSee(e, o)) continue;
        bs = dot; best = o;
      }
      const target = best || e;
      sim.heal(target, def.heal, e, true);
      sim.status(target, 'haste', def.speed, def.duration);
      sim.events.push({ t: 'buff', kind: 'sweetbox', ent: target, src: e });
      return true;
    },
  },
  lights: {
    cast(sim, e, def) { addZone(sim, e, 'lights', def, true); return true; },
  },

  // ----- Don Chema -----------------------------------------------------
  marigold: {
    // A straight strip of petals on the ground, from just behind Don Chema to where he looks.
    cast(sim, e, def) {
      const dx = -Math.sin(e.yaw), dz = -Math.cos(e.yaw);
      const sx = e.x - dx * 1.5, sz = e.z - dz * 1.5;
      addZone(sim, e, 'marigold', def, false, {
        strip: true, sx, sz, dx, dz, len: def.length, halfW: def.width / 2,
        x: sx + dx * def.length / 2, z: sz + dz * def.length / 2, radius: def.length / 2,
      });
      return true;
    },
  },
  rattle: {
    cast(sim, e, def) {
      aimDir(e.yaw, e.pitch, v);
      const ox = e.x, oy = sim.eyeY(e), oz = e.z, cos = Math.cos(def.cone * DEG);
      sim.events.push({ t: 'cone', kind: 'rattle', ent: e, range: def.range, cone: def.cone });
      for (const o of sim.ents) {
        if (!o.alive || o.team === e.team) continue;
        const dx = o.x - ox, dy = sim.chestY(o) - oy, dz = o.z - oz;
        const d = Math.hypot(dx, dy, dz);
        if (d > def.range) continue;
        if ((dx * v.x + dy * v.y + dz * v.z) / Math.max(d, 1e-3) < cos || !sim.canSee(e, o)) continue;
        sim.status(o, 'amp', def.amp, def.duration);
        sim.events.push({ t: 'buff', kind: 'rattle', ent: o, src: e });
      }
      return true;
    },
  },
  lastsong: {
    cast(sim, e, def) { addZone(sim, e, 'lastsong', def, false); return true; },
  },
};

function allies(sim, z, fn) {
  for (const o of sim.ents) {
    if (!o.alive || o.decoy || o.team !== z.team) continue;
    if (inRadius(sim, z.x, z.y, z.z, z.radius, o)) fn(o);
  }
}
function enemies(sim, z, fn) {
  for (const o of sim.ents) {
    if (!o.alive || o.decoy || o.team === z.team) continue;
    if (inRadius(sim, z.x, z.y, z.z, z.radius, o)) fn(o);
  }
}

// True when a hero stands on a strip zone (Marigold Path).
export function onStrip(z, o) {
  const px = o.x - z.sx, pz = o.z - z.sz, r = o.hero.radius;
  const t = px * z.dx + pz * z.dz;
  if (t < -r || t > z.len + r) return false;
  return Math.abs(pz * z.dx - px * z.dz) <= z.halfW + r && Math.abs(o.y - z.y) < 3;
}

export const ZONES = {
  longnight(sim, z) {
    enemies(sim, z, (o) => { sim.status(o, 'slow', 1 - z.def.slow, 0.25); sim.status(o, 'weak', z.def.weaken, 0.25); });
  },
  rangoli(sim, z, dt) {
    allies(sim, z, (o) => sim.heal(o, z.def.heal * dt, z.owner, false));
  },
  lights(sim, z, dt) {
    allies(sim, z, (o) => { sim.heal(o, z.def.heal * dt, z.owner, false); sim.status(o, 'resist', z.def.resist, 0.25); });
  },
  marigold(sim, z, dt) {
    for (const o of sim.ents) {
      if (!o.alive || o.decoy || o.team !== z.team || !onStrip(z, o)) continue;
      sim.heal(o, z.def.heal * dt, z.owner, false);
      sim.status(o, 'haste', z.def.speed, 0.25);
    }
  },
  lastsong(sim, z) {
    allies(sim, z, (o) => { sim.status(o, 'boost', z.def.boost, 0.25); sim.status(o, 'steal', z.def.lifesteal, 0.25); });
  },
};

// Returns false when the deployable is finished.
export function updateDeployable(sim, d) {
  if (sim.time >= d.until) { sim.events.push({ t: 'deployEnd', dep: d }); return false; }
  const def = d.def;
  if (d.type === 'whoopee') {
    if (sim.time < d.armAt) return true;
    for (const o of sim.ents) {
      if (!o.alive || o.decoy || o.team === d.team) continue;
      if (Math.hypot(o.x - d.x, o.y - d.y, o.z - d.z) - o.hero.radius > def.trigger) continue;
      sim.events.push({ t: 'explode', kind: 'whoopee', x: d.x, y: d.y, z: d.z, radius: def.radius, team: d.team });
      sim.explode(d.x, d.y + 0.2, d.z, def.radius, def.damage, def.damage, d.owner, {
        kind: 'whoopee', each: (t) => sim.status(t, 'slow', 1 - def.slow, def.slowTime),
      });
      sim.events.push({ t: 'deployEnd', dep: d });
      return false;
    }
  } else if (d.type === 'jackbox') {
    if (sim.time < d.popAt) return true;
    sim.events.push({ t: 'explode', kind: 'jackbox', x: d.x, y: d.y, z: d.z, radius: def.radius, team: d.team });
    sim.explode(d.x, d.y + 0.5, d.z, def.radius, def.damage, def.damage, d.owner, {
      kind: 'jackbox',
      each: (t) => {
        const dx = t.x - d.x, dz = t.z - d.z, l = Math.hypot(dx, dz) || 1;
        sim.knock(t, (dx / l) * def.knockback, def.lift, (dz / l) * def.knockback, 1.3);
      },
    });
    sim.events.push({ t: 'deployEnd', dep: d });
    return false;
  }
  return true;
}
