// Effects: particles, tracers, shock rings, projectiles, zones, wards and
// deployables. Everything is pooled, so a match does not allocate per frame.

import * as THREE from 'three';
import * as TX from './textures.js';
import { TEAMS, HEROES } from '../data/heroes.js';
import { DT } from '../sim/sim.js';

const R = Math.random;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const colA = new THREE.Color(), colB = new THREE.Color();

class Particles {
  constructor(max, additive, tex) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    this.base = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uTex: { value: tex }, uSoft: { value: additive ? 1 : 0 } },
      vertexShader: `attribute vec4 aColor; attribute float aSize; varying vec4 vC; uniform float uScale;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aColor.a <= 0.0 ? 0.0 : min(aSize * uScale / max(-mv.z, 0.1), 220.0); }`,
      fragmentShader: `varying vec4 vC; uniform sampler2D uTex; uniform float uSoft;
        void main(){ float a = texture2D(uTex, gl_PointCoord).a; a = mix(step(0.35, a), a, uSoft);
          if (a * vC.a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a * vC.a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, grav = 0, drag = 0, grow = 0) {
    const i = this.i; this.i = (i + 1) % this.max;
    const p = i * 3, c = i * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = 1;
    this.size[i] = size; this.base[i] = size; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }
  update(dt) {
    const { pos, vel, col, life, maxLife, grav, drag, size, base, grow, max } = this;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      const l = (life[i] -= dt);
      const p = i * 3;
      if (l <= 0) { col[i * 4 + 3] = 0; continue; }
      const k = 1 - drag[i] * dt;
      vel[p] *= k; vel[p + 1] = vel[p + 1] * k - grav[i] * dt; vel[p + 2] *= k;
      pos[p] += vel[p] * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += vel[p + 2] * dt;
      if (pos[p + 1] < 0.02 && grav[i] > 0) { pos[p + 1] = 0.02; vel[p] = vel[p + 1] = vel[p + 2] = 0; }
      const t = l / maxLife[i];
      col[i * 4 + 3] = t < 0.5 ? t * 2 : 1;
      size[i] = base[i] * (1 + grow[i] * (1 - t));
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}

const ZONE_LOOK = {
  rangoli: { color: 0xffc247, rim: 0xff3d7f },
  marigold: { color: 0xff9a1f, rim: 0xffd23f },
  lights: { color: 0xffd98a, rim: 0xffb347 },
  longnight: { color: 0x3a6cff, rim: 0x9fd0ff },
  lastsong: { color: 0x35c2d6, rim: 0xff9a1f },
};

export class Fx {
  constructor(scene, quality, view) {
    this.scene = scene; this.view = view;
    const glowTex = this.glowTex = TX.glow();
    const n = quality === 'low' ? 2200 : quality === 'medium' ? 4500 : 7000;
    this.glow = new Particles(n, true, glowTex);
    this.solid = new Particles(Math.floor(n * 0.6), false, glowTex);
    scene.add(this.glow.points, this.solid.points);
    this.time = 0;

    // Tracers.
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    tg.rotateX(Math.PI / 2);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.tracers.push({ m, life: 0, max: 1, w: 0.02 });
    }
    this.tracerI = 0;

    // Shock rings.
    this.rings = [];
    const rg = new THREE.RingGeometry(0.86, 1, 48);
    rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; scene.add(m);
      this.rings.push({ m, life: 0, max: 1, r: 1 });
    }
    this.ringI = 0;

    // Flash lights.
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 2);
      scene.add(l); this.flashes.push({ l, life: 0, max: 1, power: 0 });
    }
    this.flashI = 0;
    this.setQuality(quality);

    // Projectile meshes by kind.
    const basic = (hex, mul = 2.5) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(mul) });
    this.projKinds = {
      cracker: { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.34, 6).rotateX(Math.PI / 2), mat: basic(0xff3322, 2), trail: [1, 0.7, 0.25] },
      spark: { geo: new THREE.IcosahedronGeometry(0.13, 0), mat: basic(0xffd060, 4), trail: [1, 0.8, 0.35] },
      note: { geo: new THREE.OctahedronGeometry(0.15, 0), mat: basic(0x35e0f0, 3), trail: [0.3, 0.85, 1] },
      bomb: { geo: new THREE.SphereGeometry(0.28, 10, 8), mat: basic(0xff7a1a, 1.8), trail: [1, 0.5, 0.1] },
      whoopee: { geo: new THREE.SphereGeometry(0.26, 10, 8).scale(1, 0.45, 1), mat: basic(0xff5fa8, 1.3), trail: [1, 0.5, 0.8] },
      jackbox: { geo: new THREE.BoxGeometry(0.5, 0.5, 0.5), mat: basic(0x2fd6c3, 1.5), trail: [0.3, 1, 0.9] },
    };
    this.projMeshes = new Map();
    this.projPool = {};
    this.zones = new Map();
    this.barriers = new Map();
    this.deps = new Map();
    this.crows = [];
    this.wardTex = TX.wardPattern();
    this.rangoliTex = TX.rangoli();
    this.discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.ringGeo = rg;
    this.rimGeo = new THREE.RingGeometry(0.975, 1, 72).rotateX(-Math.PI / 2);
    this.domeGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    this.fireColor = new THREE.Color(1, 0.75, 0.4);
    this.fireTarget = new THREE.Color(1, 0.75, 0.4);
  }

  setQuality(q) {
    this.rate = q === 'low' ? 0.5 : 1;
    this.flashN = q === 'low' ? 0 : q === 'medium' ? 1 : 3;
    this.flashes.forEach((f, i) => { f.l.visible = i < this.flashN; f.life = 0; });
  }

  // A count for this frame from a rate per second. The fraction is rounded by chance,
  // so the result does not depend on the frame rate.
  n(perSecond, dt) {
    const x = perSecond * dt * this.rate, k = Math.floor(x);
    return k + (R() < x - k ? 1 : 0);
  }

  setScale(px) { this.glow.mat.uniforms.uScale.value = px; this.solid.mat.uniforms.uScale.value = px; }

  // ----- Small helpers ---------------------------------------------------

  burst(ps, x, y, z, n, speed, life, size, color, grav = 0, drag = 1.5, up = 0, grow = 0) {
    n = Math.ceil(n * this.rate);
    colA.set(color);
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, u = R() * 2 - 1, s = Math.sqrt(1 - u * u), v = speed * (0.35 + R() * 0.65);
      const k = 0.7 + R() * 0.6;
      ps.spawn(x, y, z, Math.cos(a) * s * v, u * v + up, Math.sin(a) * s * v, life * (0.6 + R() * 0.6), size * (0.6 + R() * 0.8), colA.r * k, colA.g * k, colA.b * k, grav, drag, grow);
    }
  }
  confetti(x, y, z, n, colors, speed = 6) {
    n = Math.ceil(n * this.rate);
    for (let i = 0; i < n; i++) {
      colA.set(colors[i % colors.length]);
      const a = R() * 6.283, v = speed * (0.3 + R() * 0.7);
      this.solid.spawn(x, y, z, Math.cos(a) * v, 2 + R() * speed, Math.sin(a) * v, 1.6 + R() * 1.4, 0.07 + R() * 0.07, colA.r, colA.g, colA.b, 7, 1.6);
    }
  }
  ring(x, y, z, radius, color, life = 0.45) {
    const r = this.rings[this.ringI]; this.ringI = (this.ringI + 1) % this.rings.length;
    r.m.position.set(x, y + 0.08, z); r.m.material.color.set(color); r.m.visible = true;
    r.life = r.max = life; r.r = radius;
  }
  flash(x, y, z, color, power, life = 0.25) {
    if (!this.flashN) return;
    const f = this.flashes[this.flashI % this.flashN]; this.flashI++;
    f.l.position.set(x, y, z); f.l.color.set(color); f.power = power; f.life = f.max = life;
  }
  tracer(ax, ay, az, bx, by, bz, color, width, life) {
    const t = this.tracers[this.tracerI]; this.tracerI = (this.tracerI + 1) % this.tracers.length;
    const m = t.m;
    tmp.set(bx - ax, by - ay, bz - az);
    const len = tmp.length();
    if (len < 0.3) return;
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.lookAt(bx, by, bz);
    m.scale.set(width, width, len);
    m.material.color.set(color); m.material.opacity = 1; m.visible = true;
    t.life = t.max = life; t.w = width;
  }

  // ----- Sim events ------------------------------------------------------

  handle(ev, sim, human) {
    const view = this.view;
    switch (ev.t) {
      case 'shot': {
        const m = view.muzzleOf(ev.ent, tmp);
        const pip = ev.ent.heroId === 'pip';
        const near = ev.ent === view.firstPerson ? 0.3 : 1; // your own flash is close to the eye: keep it small
        this.tracer(m.x, m.y, m.z, ev.x, ev.y, ev.z, pip ? [0xff5fa8, 0x2fd6c3, 0xffe066][(Math.random() * 3) | 0] : 0xffa040, pip ? 0.018 : 0.05, pip ? 0.07 : 0.16);
        this.burst(this.glow, m.x, m.y, m.z, pip ? 3 : 8, (pip ? 3 : 5) * near, 0.12, (pip ? 0.25 : 0.5) * near, pip ? 0xffd0e8 : 0xffb050);
        if (pip && near === 1) this.confetti(m.x, m.y, m.z, 2, [0xff5fa8, 0x2fd6c3, 0xffe066], 2);
        if (ev.hit === 'world') this.burst(this.glow, ev.x, ev.y, ev.z, pip ? 4 : 10, 4, 0.25, 0.14, 0xffc070, 9, 2);
        if (ev.hit === 'ent') this.burst(this.glow, ev.x, ev.y, ev.z, 6, 3.5, 0.2, 0.2, 0xffffff, 0, 3);
        if (!pip) this.flash(m.x, m.y, m.z, 0xffa040, 40 * near, 0.08);
        break;
      }
      case 'fire': {
        if (ev.ent.heroId === 'marta') break;
        const m = view.muzzleOf(ev.ent, tmp);
        const c = ev.ent.heroId === 'jun' ? 0xff6a3a : ev.ent.heroId === 'meenal' ? 0xffd060 : 0x35e0f0;
        const near = ev.ent === view.firstPerson ? 0.3 : 1;
        this.burst(this.glow, m.x, m.y, m.z, 4, 2.5 * near, 0.12, 0.3 * near, c);
        break;
      }
      case 'impact': {
        const c = ev.kind === 'cracker' ? 0xff7040 : ev.kind === 'spark' ? 0xffd060 : 0x35e0f0;
        this.burst(this.glow, ev.x, ev.y, ev.z, ev.kind === 'cracker' ? 7 : 10, 4.5, 0.3, 0.16, c, 6, 2);
        if (ev.kind === 'cracker') this.flash(ev.x, ev.y, ev.z, 0xff7040, 14, 0.07);
        break;
      }
      case 'damage': {
        const t = ev.target;
        if (ev.kind === 'flame') { if (R() < 0.5) this.burst(this.glow, t.x, t.y + t.hero.height * 0.6, t.z, 2, 2, 0.3, 0.3, 0xff7a20, -3); }
        else if (ev.kind === 'crow') this.burst(this.solid, t.x, t.y + t.hero.height * 0.8, t.z, 5, 3, 0.7, 0.09, 0x1a1024, 5);
        break;
      }
      case 'heal': {
        const t = ev.target;
        for (let i = 0; i < 8; i++) this.glow.spawn(t.x + (R() - 0.5) * 0.8, t.y + 0.4 + R() * 1.2, t.z + (R() - 0.5) * 0.8, 0, 1.4 + R(), 0, 0.7, 0.18, 1, 0.85, 0.4);
        break;
      }
      case 'kill': {
        const t = ev.target, h = t.hero;
        this.confetti(t.x, t.y + h.height * 0.6, t.z, 70, [h.color, h.accent, TEAMS[t.team].color, '#ffffff'], 7);
        this.burst(this.glow, t.x, t.y + h.height * 0.6, t.z, 26, 6, 0.5, 0.35, h.accent, 0, 2);
        this.ring(t.x, t.y, t.z, 3, h.color, 0.4);
        break;
      }
      case 'decoyEnd': {
        const t = ev.ent;
        this.confetti(t.x, t.y + 1, t.z, 30, ['#e23fa0', '#2fd6c3', '#ffe066'], 4);
        break;
      }
      case 'spawn': {
        const t = ev.ent;
        this.burst(this.glow, t.x, t.y + 1, t.z, 18, 3, 0.6, 0.25, TEAMS[t.team].color, -2);
        break;
      }
      case 'explode': this.explode(ev); break;
      case 'cast': this.cast(ev, sim); break;
      case 'buff': {
        const t = ev.ent, y = t.y + t.hero.height * 0.6;
        if (ev.kind === 'luckyred') this.confetti(t.x, y, t.z, 14, ['#ff2a1a', '#ffcf3f'], 3);
        else if (ev.kind === 'sweetbox') { this.burst(this.glow, t.x, y, t.z, 16, 3, 0.6, 0.25, 0xffc247, -2); this.confetti(t.x, y, t.z, 8, ['#ff3d7f', '#ffc247'], 2); }
        else if (ev.kind === 'rattle') this.burst(this.glow, t.x, y + 0.4, t.z, 12, 2.5, 0.6, 0.22, 0xff9a1f, -1);
        break;
      }
      case 'cone': {
        const e = ev.ent, y = sim.eyeY(e) - 0.2;
        const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
        for (let i = 0; i < 46 * this.rate; i++) {
          const a = (R() - 0.5) * 2 * ev.cone * (Math.PI / 180), ca = Math.cos(a), sa = Math.sin(a);
          const dx = fx * ca - fz * sa, dz = fz * ca + fx * sa, v = 18 + R() * 16;
          this.glow.spawn(e.x + dx, y, e.z + dz, dx * v, (R() - 0.5) * 3, dz * v, 0.5, 0.22, 1, 0.6 + R() * 0.3, 0.15, 0, 2.2);
        }
        break;
      }
      case 'blink': {
        this.burst(this.glow, ev.fx, ev.fy + 1, ev.fz, 16, 3, 0.4, 0.3, 0xe23fa0);
        this.burst(this.glow, ev.x, ev.y + 1, ev.z, 16, 3, 0.4, 0.3, 0x2fd6c3);
        this.tracer(ev.fx, ev.fy + 1, ev.fz, ev.x, ev.y + 1, ev.z, 0xff8ad8, 0.12, 0.22);
        this.confetti(ev.x, ev.y + 1, ev.z, 12, ['#e23fa0', '#2fd6c3', '#ffe066'], 3);
        break;
      }
      case 'crow': this.crows.push({ src: ev.src, target: ev.target, t: 0, life: ev.duration, a: R() * 6.28 }); break;
      case 'pack': {
        const p = sim.packs[ev.index];
        this.burst(this.glow, p.x, p.y + 0.6, p.z, 20, 3, 0.6, 0.25, 0xfff0b0, -2);
        break;
      }
      case 'point': {
        if (ev.kind === 'captured') {
          const c = TEAMS[ev.team].color;
          this.burst(this.glow, 0, 3.6, 0, 120, 12, 1.1, 0.5, c, 3, 1.2, 6);
          this.ring(0, 0.3, 0, 12, c, 0.9);
          this.flash(0, 5, 0, c, 500, 0.6);
        } else if (ev.kind === 'unlocked') { this.ring(0, 0.3, 0, 9, 0xffffff, 0.8); this.burst(this.glow, 0, 3.6, 0, 60, 8, 0.9, 0.4, 0xffe0a0, 2, 1.2, 5); }
        break;
      }
      case 'barrier': this.addBarrier(ev.barrier, human); break;
      case 'barrierHit': {
        this.burst(this.glow, ev.x, ev.y, ev.z, 6, 2.5, 0.25, 0.2, 0x9dffb0);
        const b = this.barriers.get(ev.barrier.id); if (b) b.hit = 1;
        break;
      }
      case 'barrierEnd': {
        const b = this.barriers.get(ev.barrier.id);
        if (b) {
          if (ev.broken) for (let i = 0; i < 40; i++) { const u = (R() - 0.5) * ev.barrier.w; this.solid.spawn(ev.barrier.x + ev.barrier.tx * u, ev.barrier.y + R() * ev.barrier.h, ev.barrier.z + ev.barrier.tz * u, (R() - 0.5) * 4, R() * 4, (R() - 0.5) * 4, 1.2, 0.1, 0.15, 0.5 + R() * 0.3, 0.25, 8, 1); }
          this.scene.remove(b.m); b.m.material.dispose(); this.barriers.delete(ev.barrier.id);
        }
        break;
      }
      case 'zone': this.addZone(ev.zone, human); break;
      case 'zoneEnd': {
        const z = this.zones.get(ev.zone.id);
        if (z) { this.scene.remove(z.g); z.g.traverse((o) => o.material && o.material.dispose()); this.zones.delete(ev.zone.id); }
        break;
      }
      case 'deploy': this.addDeploy(ev.dep); break;
      case 'deployEnd': {
        const d = this.deps.get(ev.dep.id);
        if (d) { this.scene.remove(d.m); this.deps.delete(ev.dep.id); }
        break;
      }
    }
  }

  explode(ev) {
    const { x, y, z, radius } = ev;
    switch (ev.kind) {
      case 'slam':
        this.ring(x, y, z, radius, 0xffb060); this.burst(this.glow, x, y + 0.3, z, 50, 9, 0.5, 0.4, 0xff8a30, 6, 2, 3);
        this.burst(this.solid, x, y + 0.2, z, 24, 6, 0.9, 0.12, 0x5a3a22, 12, 1, 4); this.flash(x, y + 1, z, 0xff8a30, 120);
        this.view.shake(x, y, z, 0.5);
        break;
      case 'pounce':
        this.ring(x, y, z, radius, 0xffcf3f); this.burst(this.glow, x, y + 0.3, z, 36, 8, 0.4, 0.35, 0xff5a2a, 5, 2, 2);
        this.confetti(x, y + 0.5, z, 20, ['#d8322b', '#ffcf3f'], 5); this.view.shake(x, y, z, 0.4);
        break;
      case 'drum':
        this.ring(x, y, z, radius, 0xff3a2a, 0.5); this.ring(x, y, z, radius * 0.6, 0xffcf3f, 0.35);
        this.burst(this.glow, x, y + 1.2, z, 40, 11, 0.4, 0.3, 0xffb030, 4, 2);
        this.confetti(x, y + 1.5, z, 18, ['#d8322b', '#ffcf3f'], 7); this.flash(x, y + 2, z, 0xff5a2a, 160, 0.2);
        this.view.shake(x, y, z, 0.6);
        break;
      case 'bomb':
        this.ring(x, y, z, radius, 0xff8a1c); this.burst(this.glow, x, y + 0.2, z, 70, 10, 0.55, 0.5, 0xff7a1a, 4, 2, 2);
        this.burst(this.glow, x, y + 0.2, z, 20, 5, 0.8, 0.9, 0x9d6bff, -1, 1.5); this.flash(x, y + 1, z, 0xff8a1c, 220);
        this.view.shake(x, y, z, 0.6);
        break;
      case 'whoopee':
        this.ring(x, y, z, radius, 0xff5fa8); this.burst(this.solid, x, y + 0.3, z, 30, 5, 0.9, 0.22, 0xc8e86a, -1, 2, 0, 2);
        this.confetti(x, y + 0.3, z, 24, ['#ff5fa8', '#2fd6c3', '#ffe066'], 5);
        break;
      case 'jackbox':
        this.ring(x, y, z, radius, 0x2fd6c3, 0.6); this.ring(x, y, z, radius * 0.5, 0xe23fa0, 0.4);
        this.confetti(x, y + 0.5, z, 120, ['#e23fa0', '#2fd6c3', '#ffe066', '#ffffff'], 11);
        this.burst(this.glow, x, y + 0.5, z, 60, 12, 0.6, 0.45, 0xffe066, 5, 1.5, 8); this.flash(x, y + 1.5, z, 0xff8ad8, 260, 0.3);
        this.view.shake(x, y, z, 0.8);
        break;
    }
  }

  cast(ev, sim) {
    const e = ev.ent, y = e.y + e.hero.height * 0.6;
    switch (ev.id) {
      case 'guise': this.burst(this.glow, e.x, y, e.z, 30, 3.5, 0.7, 0.6, 0x9d6bff, -0.5, 2); this.burst(this.solid, e.x, y, e.z, 14, 2, 0.8, 0.25, 0x241830, -1, 2); break;
      case 'luckyred': this.ring(e.x, e.y, e.z, e.hero.abilities[1].radius, 0xff2a1a, 0.5); break;
      case 'crows': this.burst(this.solid, e.x, y + 1, e.z, 30, 6, 0.8, 0.12, 0x140c1c, 2, 1, 4); this.ring(e.x, e.y, e.z, 6, 0x9d6bff, 0.6); break;
      case 'rangoli': case 'lights': case 'marigold': case 'lastsong': case 'longnight':
        this.ring(e.x, e.y, e.z, (ev.slot === 2 ? e.hero.ult : e.hero.abilities[ev.slot]).radius, ZONE_LOOK[ev.id].rim, 0.6); break;
      case 'ward': this.burst(this.glow, e.x - Math.sin(e.yaw) * 2.6, y, e.z - Math.cos(e.yaw) * 2.6, 24, 4, 0.5, 0.25, 0x7dff9a); break;
    }
    if (ev.slot === 2) { this.burst(this.glow, e.x, y, e.z, 40, 7, 0.7, 0.4, e.hero.accent, 0, 2); this.flash(e.x, y + 1, e.z, e.hero.accent, 200, 0.4); }
  }

  addBarrier(b, human) {
    const friendly = !human || human.team === b.team;
    const tex = this.wardTex.clone(); tex.needsUpdate = true; tex.repeat.set(b.w / 1.6, b.h / 1.6);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: friendly ? 0x66ffa0 : 0xff7a5a, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), mat);
    m.position.set(b.x, b.y + b.h / 2, b.z); m.rotation.y = b.yaw; m.renderOrder = 4;
    const back = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color: friendly ? 0x1f8f5a : 0xb0402a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    m.add(back);
    this.scene.add(m);
    this.barriers.set(b.id, { m, b, back, hit: 0 });
  }

  addZone(z, human) {
    const look = ZONE_LOOK[z.type], g = new THREE.Group();
    const friendly = !human || human.team === z.team;
    const rimColor = friendly ? look.rim : 0xff3030;
    const disc = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({
      color: look.color, map: z.type === 'rangoli' ? this.rangoliTex : null, transparent: true, opacity: z.type === 'rangoli' ? 0.8 : 0.12,
      depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3,
    }));
    disc.scale.setScalar(z.radius); disc.position.y = 0.06;
    const rim = new THREE.Mesh(this.rimGeo, new THREE.MeshBasicMaterial({ color: rimColor, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    rim.scale.setScalar(z.radius); rim.position.y = 0.08;
    g.add(disc, rim);
    if (z.type === 'longnight' || z.type === 'lights') {
      const dome = new THREE.Mesh(this.domeGeo, new THREE.MeshBasicMaterial({ color: z.type === 'longnight' ? 0x1a2f7a : 0xffc060, transparent: true, opacity: z.type === 'longnight' ? 0.22 : 0.07, side: THREE.DoubleSide, depthWrite: false, blending: z.type === 'longnight' ? THREE.NormalBlending : THREE.AdditiveBlending }));
      dome.scale.setScalar(z.radius); g.add(dome);
    }
    g.position.set(z.x, z.y, z.z); g.renderOrder = 3;
    this.scene.add(g);
    this.zones.set(z.id, { g, z, disc, rim });
  }

  addDeploy(d) {
    let m;
    if (d.type === 'whoopee') { m = new THREE.Mesh(this.projKinds.whoopee.geo, new THREE.MeshStandardMaterial({ color: 0xff5fa8, roughness: 0.4, emissive: 0xff2a80, emissiveIntensity: 0.5 })); m.scale.setScalar(1.5); }
    else {
      m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x2fd6c3, roughness: 0.4, emissive: 0xe23fa0, emissiveIntensity: 1.2 }));
    }
    m.position.set(d.x, d.y + (d.type === 'whoopee' ? 0.12 : 0.45), d.z); m.castShadow = true;
    this.scene.add(m);
    this.deps.set(d.id, { m, d });
  }

  reset() {
    for (const z of this.zones.values()) this.scene.remove(z.g);
    for (const b of this.barriers.values()) this.scene.remove(b.m);
    for (const d of this.deps.values()) this.scene.remove(d.m);
    for (const p of this.projMeshes.values()) { p.m.visible = false; (this.projPool[p.kind] || (this.projPool[p.kind] = [])).push(p.m); }
    this.zones.clear(); this.barriers.clear(); this.deps.clear(); this.projMeshes.clear(); this.crows.length = 0;
    this.glow.life.fill(0); this.glow.col.fill(0); this.solid.life.fill(0); this.solid.col.fill(0);
  }

  // ----- Per frame -------------------------------------------------------

  frame(dt, alpha, sim, human, camera) {
    this.time += dt;
    const time = this.time;

    // The Year-Fire. Its colour shows who holds it.
    if (sim) {
      const o = sim.objective;
      if (o.owner >= 0) this.fireTarget.set(TEAMS[o.owner].color); else this.fireTarget.setRGB(1, 0.8, 0.45);
      if (o.owner === 1) this.fireTarget.setRGB(0.6, 0.45, 1.6); // violet needs more blue to read as a flame
      if (o.locked) this.fireTarget.setRGB(0.55, 0.7, 1.3);
    }
    this.fireColor.lerp(this.fireTarget, Math.min(1, dt * 3));
    const fc = this.fireColor;
    const nFire = this.n(95, dt);
    for (let i = 0; i < nFire; i++) {
      const a = R() * 6.283, d = Math.sqrt(R()) * 1.2;
      this.glow.spawn(Math.cos(a) * d, 3.15, Math.sin(a) * d, (R() - 0.5) * 0.8, 2.6 + R() * 3.2, (R() - 0.5) * 0.8, 0.5 + R() * 0.4, 0.5 + R() * 0.4, fc.r * 0.55, fc.g * 0.2, fc.b * 0.07, -1.2, 0.6, -0.8);
    }
    for (let i = this.n(22, dt); i > 0; i--) this.glow.spawn((R() - 0.5) * 2, 3.6, (R() - 0.5) * 2, (R() - 0.5) * 2, 4 + R() * 4, (R() - 0.5) * 2, 2 + R(), 0.09, 1, 0.7, 0.3, -0.5, 0.3);

    if (sim) {
      // Marta's bellows.
      for (const e of sim.ents) {
        if (!e.flaming || !e.alive) continue;
        const m = this.view.muzzleOf(e, tmp);
        const cp = Math.cos(e.pitch), dx = -Math.sin(e.yaw) * cp, dy = Math.sin(e.pitch), dz = -Math.cos(e.yaw) * cp;
        const n = this.n(300, dt);
        const size = e === this.view.firstPerson ? 0.07 : 0.3, grow = e === this.view.firstPerson ? 16 : 3.5;
        for (let i = 0; i < n; i++) {
          const v = 24 + R() * 8, s = 0.16;
          this.glow.spawn(m.x, m.y, m.z, dx * v + (R() - 0.5) * v * s + e.vx, dy * v + (R() - 0.5) * v * s, dz * v + (R() - 0.5) * v * s + e.vz, 0.34 + R() * 0.1, size, 0.5, 0.26 + R() * 0.14, 0.05, -2, 0.8, grow);
        }
      }
      // Projectiles.
      const seen = this._seen || (this._seen = new Set());
      seen.clear();
      for (const p of sim.projectiles) {
        seen.add(p.id);
        let pm = this.projMeshes.get(p.id);
        const kind = this.projKinds[p.kind];
        if (!pm) {
          const pool = this.projPool[p.kind] || (this.projPool[p.kind] = []);
          const m = pool.pop() || new THREE.Mesh(kind.geo, kind.mat);
          if (!m.parent) this.scene.add(m);
          m.visible = true;
          pm = { m, kind: p.kind }; this.projMeshes.set(p.id, pm);
        }
        const ex = alpha * DT;
        const x = p.x + p.vx * ex, y = p.y + p.vy * ex, z = p.z + p.vz * ex;
        pm.m.position.set(x, y, z);
        if (p.kind === 'cracker') pm.m.lookAt(x + p.vx, y + p.vy, z + p.vz); else { pm.m.rotation.x += dt * 9; pm.m.rotation.y += dt * 7; }
        const tr = kind.trail;
        for (let i = this.n(50, dt); i > 0; i--) this.glow.spawn(x, y, z, (R() - 0.5) * 1.2, (R() - 0.5) * 1.2, (R() - 0.5) * 1.2, 0.22, p.kind === 'spark' ? 0.2 : 0.14, tr[0], tr[1], tr[2], p.kind === 'spark' ? 4 : 0, 1);
      }
      for (const [id, pm] of this.projMeshes) {
        if (seen.has(id)) continue;
        pm.m.visible = false; this.projPool[pm.kind].push(pm.m); this.projMeshes.delete(id);
      }
      // Zones.
      for (const zv of this.zones.values()) {
        const z = zv.z;
        zv.g.position.set(z.x, z.y, z.z);
        const age = time, r = z.radius;
        zv.disc.rotation.y = age * 0.3;
        const left = z.until - sim.time;
        zv.rim.material.opacity = left < 1 ? 0.3 + 0.55 * Math.abs(Math.sin(sim.time * 12)) : 0.85;
        for (let i = this.n(z.type === 'rangoli' ? 90 : 150, dt); i > 0; i--) {
          const a = R() * 6.283, d = Math.sqrt(R()) * r, px = z.x + Math.cos(a) * d, pz = z.z + Math.sin(a) * d;
          if (z.type === 'longnight') this.solid.spawn(px, z.y + 2 + R() * 5, pz, (R() - 0.5), -1.5 - R(), (R() - 0.5), 1.6, 0.07, 0.85, 0.92, 1, 0, 0);
          else if (z.type === 'marigold') this.solid.spawn(px, z.y + 0.1, pz, (R() - 0.5), 1 + R() * 1.5, (R() - 0.5), 1, 0.09, 1, 0.55 + R() * 0.2, 0.08, 1.5, 0.5);
          else if (z.type === 'lastsong') this.glow.spawn(px, z.y + 0.2, pz, 0, 1.5 + R() * 2, 0, 1, 0.16, R() < 0.5 ? 0.2 : 1, 0.75, R() < 0.5 ? 1 : 0.15);
          else this.glow.spawn(px, z.y + 0.1, pz, 0, 0.8 + R() * 1.6, 0, 1.1, z.type === 'lights' ? 0.2 : 0.13, 1, 0.75, 0.3);
        }
      }
      // Wards.
      for (const bv of this.barriers.values()) {
        const b = bv.b;
        bv.hit = Math.max(0, bv.hit - dt * 5);
        const left = b.until - sim.time;
        bv.m.material.opacity = (0.25 + 0.35 * (b.hp / b.maxHp) + bv.hit * 0.5) * (left < 1 ? 0.5 + 0.5 * Math.abs(Math.sin(sim.time * 14)) : 1);
        bv.m.material.map.offset.y = time * 0.08;
      }
      // Deployables.
      for (const dv of this.deps.values()) {
        const d = dv.d;
        if (d.type === 'jackbox') {
          const k = 1 - Math.max(0, d.popAt - sim.time) / d.def.fuse;
          dv.m.rotation.y = Math.sin(time * 40) * 0.15 * k; dv.m.scale.setScalar(1 + k * 0.5 + Math.sin(time * 50) * 0.05 * k);
        } else dv.m.scale.y = 1.5 * (0.85 + 0.15 * Math.sin(time * 4 + d.id));
      }
      // Crows: dark flecks that fly from Tamsin to each target and circle it.
      for (let i = this.crows.length - 1; i >= 0; i--) {
        const c = this.crows[i];
        c.t += dt;
        if (c.t > c.life || !c.target.alive) { this.crows.splice(i, 1); continue; }
        const k = Math.min(1, c.t / 0.35), t = c.target;
        const tx = t.x + Math.cos(c.a + c.t * 9) * 0.9, ty = t.y + t.hero.height + 0.3 + Math.sin(c.t * 13) * 0.3, tz = t.z + Math.sin(c.a + c.t * 9) * 0.9;
        const x = c.src.x + (tx - c.src.x) * k, y = c.src.y + 2.5 + (ty - c.src.y - 2.5) * k, z = c.src.z + (tz - c.src.z) * k;
        for (let j = this.n(60, dt); j > 0; j--) this.solid.spawn(x, y, z, (R() - 0.5), (R() - 0.5), (R() - 0.5), 0.25, 0.26, 0.06, 0.03, 0.1);
        for (let j = this.n(18, dt); j > 0; j--) this.glow.spawn(x, y, z, 0, 0, 0, 0.2, 0.12, 0.6, 0.4, 1);
      }
    }

    this.glow.update(dt); this.solid.update(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.m.visible = false; continue; }
      const k = t.life / t.max;
      t.m.material.opacity = k; t.m.scale.x = t.m.scale.y = t.w * (0.4 + 0.6 * k);
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.life / r.max;
      r.m.scale.setScalar(r.r * (0.15 + 0.85 * Math.sqrt(k))); r.m.material.opacity = 1 - k;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) { f.l.intensity = 0; continue; }
      f.life -= dt;
      f.l.intensity = f.power * Math.max(0, f.life / f.max);
    }
  }
}
