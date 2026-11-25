// Hero figures and first-person weapons, built in code from simple shapes.
// Art direction: festival figurines. Chunky carved-toy bodies, painted wood,
// cloth and brass, with small lights (candles, lamps, lanterns) that glow.
//
// buildHero(heroId, teamColor)  -> third-person figure (origin at the feet, faces -Z)
// buildViewModel(heroId)        -> first-person weapon (child of the camera)

import * as THREE from 'three';
import { HEROES } from '../data/heroes.js';

// ----- Shared geometry and material caches -------------------------------

const GEO = new Map();
const MAT = new Map();

function geo(key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
}
const sph = () => geo('sph', () => new THREE.SphereGeometry(1, 18, 12));
const cyl = () => geo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 16));
const cone = (n = 14) => geo('cone' + n, () => new THREE.ConeGeometry(1, 1, n));
const box = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const ico = () => geo('ico', () => new THREE.IcosahedronGeometry(1, 0));
// A tapered tube: top radius rt, bottom radius 1, height 1.
const taper = (rt, n = 16) => geo(`tp:${rt}:${n}`, () => new THREE.CylinderGeometry(rt, 1, 1, n));
// A ring of radius 1 with tube radius t, in the XY plane.
const ring = (t, arc = Math.PI * 2) => geo(`rg:${t}:${arc.toFixed(3)}`, () => new THREE.TorusGeometry(1, t, 8, 22, arc));
const capsule = (r, len) => geo(`cp:${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
// Half of a ball (the +Z half), used for two-colour bodies.
const halfBall = () => geo('half', () => new THREE.SphereGeometry(1, 10, 12, 0, Math.PI));

function mat(key, props) {
  let m = MAT.get(key);
  if (!m) {
    const { physical, ...rest } = props;
    m = physical ? new THREE.MeshPhysicalMaterial(rest) : new THREE.MeshStandardMaterial(rest);
    m.name = key;
    MAT.set(key, m);
  }
  return m;
}
const cloth = (key, color, rough = 0.85) => mat(key, { color, roughness: rough, metalness: 0 });
const paint = (key, color) => mat(key, { color, roughness: 0.55, metalness: 0 });
const lacquer = (key, color) => mat(key, { physical: true, color, roughness: 0.35, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.25 });
const metal = (key, color, rough = 0.4) => mat(key, { color, roughness: rough, metalness: 0.6 });
const glow = (key, color, power = 3) => mat(key, { color, emissive: color, emissiveIntensity: power, roughness: 0.6 });
const teamMat = (color) => mat('team:' + color, { color, emissive: color, emissiveIntensity: 0.35, roughness: 0.6 });

const M = {
  flame: () => glow('flame', '#ffab3d', 3.2),
  spark: () => glow('spark', '#ffe9a8', 4),
  brass: () => metal('brass', '#d9a441', 0.3),
  gold: () => metal('gold', '#ffcf3f', 0.32),
  iron: () => metal('iron', '#3d4048', 0.45),
  wood: () => paint('wood', '#8a5a33'),
  darkWood: () => paint('darkwood', '#4a2f20'),
  black: () => paint('black', '#141318'),
  white: () => cloth('white', '#fff6e6', 0.95),
  wax: () => paint('wax', '#fff1d0'),
};

// ----- Small build helpers -----------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Add a mesh. pos [x,y,z]; scale number or [x,y,z]; rot [x,y,z,(order)].
function P(parent, g, m, pos, scale, rot, shadow) {
  const o = new THREE.Mesh(g, m);
  if (pos) o.position.set(pos[0], pos[1], pos[2]);
  if (scale !== undefined && scale !== null) {
    if (typeof scale === 'number') o.scale.setScalar(scale); else o.scale.set(scale[0], scale[1], scale[2]);
  }
  if (rot) { if (rot[3]) o.rotation.order = rot[3]; o.rotation.set(rot[0], rot[1], rot[2]); }
  o.castShadow = !!shadow;
  parent.add(o);
  return o;
}

// A rounded limb from point a to point b.
function limb(parent, m, a, b, r, shadow = true) {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]);
  const len = Math.round(_a.distanceTo(_b) * 50) / 50;
  const o = new THREE.Mesh(capsule(r, len), m);
  o.position.copy(_a).add(_b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(_up, _b.sub(_a).normalize());
  o.castShadow = shadow;
  parent.add(o);
  return o;
}

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

let seedCount = 0;

// The common skeleton of every figure.
function makeRig(hipY, legX) {
  const group = new THREE.Group();
  const body = pivot(group, 0, 0, 0);
  return {
    group, body,
    legL: pivot(group, -legX, hipY, 0),
    legR: pivot(group, legX, hipY, 0),
    head: pivot(body, 0, 0, 0),
    aim: pivot(body, 0, 0, 0),
    armL: pivot(body, 0, 0, 0),
    muzzle: new THREE.Object3D(),
    flames: [],
    legSwing: 0.75, aimFollow: 0.85, armSwing: 0.5, stride: 1.75, headY: 1.8,
    custom: null,
  };
}

function finish(rig) {
  const { group, body, legL, legR, head, aim, armL, flames } = rig;
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) { o.userData.base = o.material; o.userData.shadow = o.castShadow; meshes.push(o); } });
  const flameBase = flames.map((f) => f.scale.y);
  const st = { phase: seedCount++ * 1.7, amp: 0, air: 0, squash: 0, recoil: 0, wasGround: true, seed: seedCount * 2.3, fire: 0 };
  const aimZ = aim.position.z, armLBase = armL.rotation.x;
  let clones = null, opacity = 1;

  return {
    group,
    muzzle: rig.muzzle,
    headY: rig.headY,
    meshCount: meshes.length,
    update(dt, s) {
      const speed = s.speed || 0, ground = s.onGround !== false, time = s.time || 0, pitch = s.pitch || 0;
      st.phase += dt * Math.min(speed, 10) * rig.stride;
      const want = ground ? Math.min(1, speed / 4.5) : 0;
      st.amp += (want - st.amp) * Math.min(1, dt * 10);
      st.air += ((ground ? 0 : 1) - st.air) * Math.min(1, dt * 12);
      if (ground && !st.wasGround) st.squash = 1;
      st.wasGround = ground;
      st.squash *= Math.exp(-dt * 9);
      st.recoil *= Math.exp(-dt * 14);
      st.fire += ((s.firing ? 1 : 0) - st.fire) * Math.min(1, dt * 12);
      const sw = Math.sin(st.phase) * st.amp;
      legL.rotation.x = sw * rig.legSwing + st.air * 0.5;
      legR.rotation.x = -sw * rig.legSwing - st.air * 0.3;
      body.position.y = Math.abs(Math.cos(st.phase)) * 0.05 * st.amp + Math.sin(time * 1.7 + st.seed) * 0.012 - st.squash * 0.07;
      body.scale.y = 1 - st.squash * 0.06;
      body.rotation.z = Math.sin(st.phase) * 0.035 * st.amp;
      body.rotation.x = -0.07 * st.amp + st.air * 0.05;
      aim.rotation.x = pitch * rig.aimFollow + st.recoil * 0.2;
      aim.position.z = aimZ + st.recoil * 0.07;
      head.rotation.x = pitch * 0.55;
      head.rotation.y = Math.sin(time * 0.6 + st.seed) * 0.08 * (1 - st.amp);
      armL.rotation.x = armLBase - sw * rig.armSwing;
      for (let i = 0; i < flames.length; i++) {
        flames[i].scale.y = flameBase[i] * (1 + 0.22 * Math.sin(time * 17 + i * 2.1 + st.seed) + 0.1 * Math.sin(time * 31 + i));
      }
      if (rig.custom) rig.custom(dt, s, st, sw);
    },
    kick() { st.recoil = 1; },
    setOpacity(a) {
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      if (a === opacity) return;
      opacity = a;
      if (a >= 1) {
        for (const o of meshes) { o.material = o.userData.base; o.castShadow = o.userData.shadow; }
        return;
      }
      if (!clones) {
        clones = new Map();
        for (const o of meshes) {
          const base = o.userData.base;
          if (!clones.has(base)) { const c = base.clone(); c.transparent = true; clones.set(base, c); }
        }
      }
      for (const c of clones.values()) c.opacity = a;
      for (const o of meshes) { o.material = clones.get(o.userData.base); o.castShadow = o.userData.shadow && a > 0.5; }
    },
    dispose() {
      if (group.parent) group.parent.remove(group);
      if (clones) { for (const c of clones.values()) c.dispose(); clones = null; }
    },
  };
}

// ----- The six heroes ------------------------------------------------------

const BUILD = {
  // Midwinter: a broad Hearthwarden with a crown of candles and the Yule log.
  marta(hero, team) {
    const r = makeRig(0.6, 0.2);
    const green = cloth('m.cloak', '#2f6b45'), fur = cloth('m.fur', '#efe6d2', 1), skin = paint('m.skin', '#e8b596');
    const boot = cloth('m.boot', '#3a2a20'), bark = cloth('m.bark', '#5b3b24', 1), cut = paint('m.cut', '#d2a468');
    const leaf = cloth('m.leaf', '#2d8040'), leather = cloth('m.leather', '#5a3424');
    limb(r.legL, boot, [0, 0, 0], [0, -0.45, 0], 0.15);
    limb(r.legR, boot, [0, 0, 0], [0, -0.45, 0], 0.15);
    const b = r.body;
    P(b, taper(0.55), green, [0, 0.995, 0], [0.58, 1.15, 0.58], null, true);                 // cloak
    P(b, ring(0.09), fur, [0, 0.45, 0], 0.575, [Math.PI / 2, 0, 0]);                          // fur hem
    P(b, ring(0.3), fur, [0, 1.55, 0], [0.33, 0.33, 0.3], [Math.PI / 2, 0, 0], true);         // fur collar
    P(b, taper(0.62), team, [0, 1.38, 0], [0.47, 0.3, 0.47], null, true);                     // team mantle
    // The Yule log across the back.
    P(b, cyl(), bark, [0, 1.22, 0.44], [0.17, 1.02, 0.17], [0, 0, Math.PI / 2], true);
    P(b, cyl(), cut, [0.515, 1.22, 0.44], [0.14, 0.02, 0.14], [0, 0, Math.PI / 2]);
    P(b, cyl(), cut, [-0.515, 1.22, 0.44], [0.14, 0.02, 0.14], [0, 0, Math.PI / 2]);
    // Head, hood and the candle crown.
    r.head.position.set(0, 1.6, 0);
    P(r.head, sph(), skin, [0, 0.17, -0.05], 0.19, null, true);
    P(r.head, sph(), green, [0, 0.2, 0.04], 0.25, null, true);
    P(r.head, sph(), M.black(), [0.07, 0.2, -0.228], 0.024);
    P(r.head, sph(), M.black(), [-0.07, 0.2, -0.228], 0.024);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2, x = Math.sin(a) * 0.15, z = Math.cos(a) * 0.15 + 0.04;
      P(r.head, cyl(), M.wax(), [x, 0.46, z], [0.028, 0.13, 0.028]);
      r.flames.push(P(r.head, sph(), M.flame(), [x, 0.56, z], [0.03, 0.055, 0.03]));
    }
    // Left arm with the evergreen wreath; its bow shows the team colour.
    r.armL.position.set(-0.42, 1.42, 0);
    limb(r.armL, green, [0, 0, 0], [-0.08, -0.42, -0.22], 0.11);
    P(r.armL, ring(0.24), leaf, [-0.12, -0.36, -0.3], 0.3, null, true);
    P(r.armL, box(), team, [-0.12, -0.07, -0.33], [0.2, 0.09, 0.06], [0, 0, 0.1]);
    r.armSwing = 0.25;
    // Right arm and the bellows.
    r.aim.position.set(0, 1.42, 0);
    limb(r.aim, green, [0.4, 0, 0], [0.24, -0.26, -0.42], 0.11);
    const top = P(r.aim, box(), M.wood(), [0.2, -0.2, -0.56], [0.26, 0.03, 0.4], [0.2, 0, 0], true);
    P(r.aim, box(), M.wood(), [0.2, -0.36, -0.56], [0.26, 0.03, 0.4], [-0.2, 0, 0]);
    P(r.aim, box(), leather, [0.2, -0.28, -0.52], [0.2, 0.1, 0.3]);
    P(r.aim, cone(), M.brass(), [0.2, -0.28, -0.84], [0.05, 0.22, 0.05], [-Math.PI / 2, 0, 0]);
    const ember = P(r.aim, sph(), M.flame(), [0.2, -0.28, -0.96], 0.035);
    r.muzzle.position.set(0.2, -0.28, -1.0); r.aim.add(r.muzzle);
    r.headY = 2.2; r.stride = 1.5; r.legSwing = 0.6;
    r.custom = (dt, s, st) => {
      top.rotation.x = 0.2 - st.fire * (0.12 + 0.1 * Math.sin((s.time || 0) * 24));
      ember.scale.setScalar(0.035 * (1 + st.fire * 0.9));
    };
    return r;
  },

  // Lunar New Year: a dancer under a big red and gold lion head.
  jun(hero, team) {
    const r = makeRig(0.75, 0.17);
    const red = lacquer('j.red', '#d8322b'), gold = M.gold(), trousers = cloth('j.trousers', '#e8b93a', 0.7);
    const fringe = cloth('j.fringe', '#fff7e8', 1), eyeW = paint('j.eye', '#ffffff');
    limb(r.legL, trousers, [0, 0, 0], [0, -0.61, 0], 0.14);
    limb(r.legR, trousers, [0, 0, 0], [0, -0.61, 0], 0.14);
    const b = r.body;
    P(b, taper(0.8), red, [0, 1.05, 0], [0.3, 0.6, 0.26], null, true);                       // tunic
    P(b, ring(0.16), team, [0, 0.84, 0], [0.3, 0.27, 0.3], [Math.PI / 2, 0, 0]);             // team sash
    P(b, ring(0.2), team, [0, 1.38, 0.02], 0.3, [Math.PI / 2, 0, 0]);                        // team collar
    // The cloth lion body trails behind.
    const c1 = P(b, sph(), red, [0, 1.25, 0.3], [0.38, 0.3, 0.36], null, true);
    const c2 = P(b, sph(), red, [0, 1.07, 0.54], [0.28, 0.22, 0.27], null, true);
    const tail = P(b, cone(), fringe, [0, 1.16, 0.78], [0.07, 0.24, 0.07], [0.9, 0, 0]);
    // The lion head.
    r.head.position.set(0, 1.35, 0);
    const h = r.head;
    P(h, sph(), red, [0, 0.3, -0.1], [0.44, 0.36, 0.46], null, true);
    P(h, sph(), red, [0, 0.2, -0.48], [0.3, 0.13, 0.22], null, true);                        // upper lip
    P(h, sph(), gold, [0, 0.27, -0.68], 0.08);                                               // nose
    P(h, sph(), eyeW, [0.2, 0.45, -0.42], 0.12);
    P(h, sph(), eyeW, [-0.2, 0.45, -0.42], 0.12);
    P(h, sph(), M.black(), [0.2, 0.45, -0.53], 0.055);
    P(h, sph(), M.black(), [-0.2, 0.45, -0.53], 0.055);
    P(h, cone(), gold, [0, 0.7, -0.15], [0.08, 0.22, 0.08]);                                 // horn
    P(h, cone(), gold, [0.4, 0.52, 0], [0.1, 0.2, 0.05], [0, 0, -0.7]);                      // ears
    P(h, cone(), gold, [-0.4, 0.52, 0], [0.1, 0.2, 0.05], [0, 0, 0.7]);
    P(h, cyl(), paint('j.mirror', '#ffe9a0'), [0, 0.57, -0.43], [0.07, 0.02, 0.07], [-1.05, 0, 0]); // forehead mirror
    P(h, sph(), fringe, [0.2, 0.59, -0.4], [0.15, 0.045, 0.07], [0, 0, -0.25]);              // fringe brows
    P(h, sph(), fringe, [-0.2, 0.59, -0.4], [0.15, 0.045, 0.07], [0, 0, 0.25]);
    P(h, ring(0.2), fringe, [0, 0.28, 0.06], [0.43, 0.36, 0.43], null, true);                // mane
    const jaw = pivot(h, 0, 0.1, -0.15);
    P(jaw, sph(), red, [0, -0.03, -0.3], [0.3, 0.08, 0.26], null, true);
    P(jaw, taper(0.5, 10), fringe, [0, -0.17, -0.4], [0.16, 0.22, 0.1], [Math.PI, 0, 0]);    // beard
    // Right arm with a string of firecrackers.
    r.aim.position.set(0, 1.3, 0);
    limb(r.aim, red, [0.3, 0, 0], [0.34, -0.15, -0.42], 0.09);
    P(r.aim, cyl(), gold, [0.34, -0.42, -0.45], [0.008, 0.5, 0.008]);
    const cr = paint('j.cracker', '#e0281e');
    P(r.aim, cyl(), cr, [0.31, -0.3, -0.45], [0.04, 0.13, 0.04], [0, 0, 0.5]);
    P(r.aim, cyl(), cr, [0.37, -0.44, -0.45], [0.04, 0.13, 0.04], [0, 0, -0.5]);
    P(r.aim, cyl(), cr, [0.31, -0.58, -0.45], [0.04, 0.13, 0.04], [0, 0, 0.5]);
    r.flames.push(P(r.aim, sph(), M.spark(), [0.34, -0.69, -0.45], 0.03));
    r.muzzle.position.set(0.34, -0.15, -0.55); r.aim.add(r.muzzle);
    r.headY = 2.15; r.stride = 1.6; r.aimFollow = 0.6;
    r.custom = (dt, s, st, sw) => {
      const t = s.time || 0;
      jaw.rotation.x = -0.1 - 0.08 * Math.sin(t * 2.2 + st.seed) - st.fire * (0.2 + 0.15 * Math.sin(t * 22)) - (s.ult ? 0.2 : 0);
      c1.position.x = sw * 0.04; c2.position.x = -sw * 0.08;
      tail.rotation.z = sw * 0.5 + Math.sin(t * 3 + st.seed) * 0.15;
    };
    return r;
  },

  // Halloween: a tall thin guiser in a turnip-lantern mask.
  tamsin(hero, team) {
    const r = makeRig(0.8, 0.1);
    const dark = cloth('t.cloak', '#2b2333'), lining = cloth('t.lining', hero.color, 0.7), hat = cloth('t.hat', '#1c1722');
    const turnip = mat('t.turnip', { color: '#efe6d8', emissive: '#ff9a3c', emissiveIntensity: 0.08, roughness: 0.7 });
    const root = paint('t.root', '#9a66b8'), eye = glow('t.eye', '#ff8a1c', 1.6);
    limb(r.legL, dark, [0, 0, 0], [0, -0.73, 0], 0.065);
    limb(r.legR, dark, [0, 0, 0], [0, -0.73, 0], 0.065);
    const b = r.body;
    const cloak = P(b, taper(0.42, 7), dark, [0, 1.03, 0], [0.37, 1.0, 0.37], null, true);
    const inner = P(b, taper(0.42, 9), lining, [0, 0.96, 0], [0.34, 1.0, 0.34], [0, 0.4, 0]);
    P(b, taper(1.5, 7), dark, [0, 1.56, 0], [0.13, 0.14, 0.13], null, true);                 // collar
    P(b, ring(0.3), team, [0, 1.5, 0], 0.135, [Math.PI / 2, 0, 0]);                          // team scarf
    const scarf = P(b, box(), team, [-0.13, 1.24, 0.2], [0.1, 0.5, 0.035], [0.25, 0, 0]);
    r.head.position.set(0, 1.5, 0);
    const h = r.head;
    P(h, sph(), turnip, [0, 0.1, 0], [0.17, 0.185, 0.17], null, true);                       // mask
    P(h, cone(), root, [0, -0.1, -0.03], [0.05, 0.1, 0.05], [Math.PI, 0, 0]);                // turnip root chin
    P(h, cone(3), eye, [0.065, 0.125, -0.158], [0.036, 0.042, 0.02], [0, 0, 0]);
    P(h, cone(3), eye, [-0.065, 0.125, -0.158], [0.036, 0.042, 0.02], [0, 0, 0]);
    P(h, box(), eye, [0, 0.03, -0.163], [0.1, 0.016, 0.02]);                                 // mouth
    P(h, cyl(), hat, [0, 0.24, 0], [0.4, 0.025, 0.4], null, true);                           // brim
    P(h, taper(0.4, 10), hat, [0.01, 0.335, 0.01], [0.16, 0.17, 0.16], [0, 0, -0.08], true); // crown
    P(h, cyl(), lining, [0, 0.27, 0], [0.165, 0.035, 0.165]);                                // hat band
    P(h, sph(), M.black(), [0.26, 0.295, 0.05], [0.05, 0.045, 0.08]);                        // a crow on the brim
    P(h, cone(), lining, [0.26, 0.3, -0.045], [0.015, 0.05, 0.015], [-Math.PI / 2, 0, 0]);
    // The Candlelock, held in both hands.
    r.aim.position.set(0, 1.38, 0);
    const a = r.aim;
    limb(a, dark, [0.2, 0, 0], [0.14, -0.12, -0.3], 0.055);
    limb(a, dark, [-0.2, 0, 0], [0.1, -0.1, -0.6], 0.055);
    P(a, box(), M.darkWood(), [0.14, -0.1, -0.15], [0.05, 0.1, 0.42], [0.08, 0, 0], true);
    P(a, cyl(), M.iron(), [0.14, -0.07, -0.8], [0.018, 1.0, 0.018], [Math.PI / 2, 0, 0], true);
    P(a, cyl(), M.brass(), [0.14, -0.07, -0.5], [0.028, 0.05, 0.028], [Math.PI / 2, 0, 0]);
    r.flames.push(P(a, box(), M.flame(), [0.14, -0.135, -1.16], [0.045, 0.06, 0.045]));      // candle lantern
    r.muzzle.position.set(0.14, -0.07, -1.32); a.add(r.muzzle);
    r.headY = 1.98; r.stride = 1.9; r.armSwing = 0;
    r.custom = (dt, s, st, sw) => {
      scarf.rotation.x = 0.25 + st.amp * 0.55 + Math.sin((s.time || 0) * 2.4 + st.seed) * 0.06;
      cloak.rotation.y = sw * 0.06; inner.rotation.y = 0.4 - sw * 0.1;
    };
    return r;
  },

  // April Fools' Day: a small jester in two-colour motley.
  pip(hero, team) {
    const r = makeRig(0.58, 0.11);
    const mag = cloth('p.mag', hero.color, 0.7), teal = cloth('p.teal', hero.accent, 0.7), skin = paint('p.skin', '#f2c9a5');
    const nose = paint('p.nose', '#e8362e');
    limb(r.legL, teal, [0, 0, 0], [0, -0.49, 0], 0.085);
    limb(r.legR, mag, [0, 0, 0], [0, -0.49, 0], 0.085);
    P(r.legL, cone(), mag, [0, -0.52, -0.12], [0.07, 0.24, 0.07], [-Math.PI / 2 + 0.45, 0, 0]);   // curled shoes
    P(r.legR, cone(), teal, [0, -0.52, -0.12], [0.07, 0.24, 0.07], [-Math.PI / 2 + 0.45, 0, 0]);
    const b = r.body;
    P(b, halfBall(), teal, [0, 0.88, 0], [0.19, 0.3, 0.23], [0, Math.PI / 2, 0], true);       // right half
    P(b, halfBall(), mag, [0, 0.88, 0], [0.19, 0.3, 0.23], [0, -Math.PI / 2, 0], true);       // left half
    P(b, ring(0.16), team, [0, 0.64, 0], [0.19, 0.16, 0.19], [Math.PI / 2, 0, 0]);            // team belt
    P(b, ring(0.36), M.white(), [0, 1.16, 0], [0.17, 0.17, 0.11], [Math.PI / 2, 0, 0]);       // ruff
    // A big bow tie in the team colour.
    P(b, cone(), team, [0.12, 1.1, -0.2], [0.09, 0.18, 0.045], [0, 0, Math.PI / 2]);
    P(b, cone(), team, [-0.12, 1.1, -0.2], [0.09, 0.18, 0.045], [0, 0, -Math.PI / 2]);
    P(b, sph(), M.gold(), [0, 1.1, -0.21], 0.04);
    r.head.position.set(0, 1.18, 0);
    const h = r.head;
    P(h, sph(), skin, [0, 0.15, 0], 0.17, null, true);
    P(h, sph(), M.black(), [0.06, 0.18, -0.155], 0.022);
    P(h, sph(), M.black(), [-0.06, 0.18, -0.155], 0.022);
    P(h, sph(), nose, [0, 0.13, -0.17], 0.032);
    P(h, ring(0.2), M.gold(), [0, 0.25, 0], [0.15, 0.15, 0.2], [Math.PI / 2, 0, 0]);          // hat band
    const hats = [
      P(h, cone(), cloth('p.yellow', '#ffd23f', 0.7), [0, 0.38, 0], [0.085, 0.28, 0.085], null, true),
      P(h, cone(), mag, [-0.15, 0.33, 0], [0.085, 0.28, 0.085], [0, 0, 0.95], true),
      P(h, cone(), teal, [0.15, 0.33, 0], [0.085, 0.28, 0.085], [0, 0, -0.95], true),
    ];
    P(h, sph(), M.brass(), [0, 0.53, 0], 0.035);                                              // bells
    P(h, sph(), M.brass(), [-0.27, 0.41, 0], 0.035);
    P(h, sph(), M.brass(), [0.27, 0.41, 0], 0.035);
    // A party popper in each hand.
    r.aim.position.set(0, 1.04, 0);
    const a = r.aim;
    limb(a, mag, [0.24, 0, 0], [0.26, -0.08, -0.32], 0.06);
    limb(a, teal, [-0.24, 0, 0], [-0.26, -0.08, -0.32], 0.06);
    P(a, cone(), M.gold(), [0.26, -0.08, -0.46], [0.075, 0.22, 0.075], [Math.PI / 2, 0, 0], true);
    P(a, cone(), M.white(), [-0.26, -0.08, -0.46], [0.075, 0.22, 0.075], [Math.PI / 2, 0, 0], true);
    r.muzzle.position.set(0.26, -0.08, -0.6); a.add(r.muzzle);
    r.headY = 1.8; r.stride = 2.3; r.armSwing = 0;
    r.custom = (dt, s, st, sw) => {
      h.rotation.z = sw * 0.09;
      hats[1].rotation.z = 0.95 + sw * 0.12; hats[2].rotation.z = -0.95 + sw * 0.12;
    };
    return r;
  },

  // Diwali: a lampwright in a sari, with a tray of clay lamps and a sparkler.
  meenal(hero, team) {
    const r = makeRig(0.5, 0.12);
    const sari = cloth('me.sari', hero.color, 0.6), gold = metal('me.gold', hero.accent, 0.4), blouse = cloth('me.blouse', '#e2a233', 0.6);
    const skin = paint('me.skin', '#a86b45'), hair = paint('me.hair', '#1a1210'), clay = cloth('me.clay', '#b5562f'), bindi = paint('me.bindi', '#d81e2c');
    P(r.legL, sph(), gold, [0, -0.46, -0.36], [0.06, 0.04, 0.1]);                             // sandals under the hem
    P(r.legR, sph(), gold, [0, -0.46, -0.36], [0.06, 0.04, 0.1]);
    const b = r.body;
    const skirt = pivot(b, 0, 1.0, 0);
    P(skirt, taper(0.42, 18), sari, [0, -0.475, 0], [0.4, 0.95, 0.4], null, true);
    P(skirt, taper(0.94, 18), gold, [0, -0.905, 0], [0.412, 0.09, 0.412]);                    // gold hem
    P(b, capsule(0.15, 0.16), blouse, [0, 1.2, 0], [1, 1, 0.82], null, true);
    P(b, ring(0.25), sari, [0, 1.21, 0], [0.2, 0.17, 0.2], [Math.PI / 2, 0, 0.78, 'ZYX'], true); // sash, hip to shoulder
    P(b, ring(0.16), team, [0, 1.0, 0], [0.185, 0.165, 0.185], [Math.PI / 2, 0, 0]);          // team waistband
    const drape = pivot(b, -0.15, 1.38, 0.13);
    P(drape, box(), team, [0, -0.3, 0.02], [0.2, 0.62, 0.03], null, true);                    // team drape down the back
    drape.rotation.x = 0.1;
    r.head.position.set(0, 1.4, 0);
    const h = r.head;
    P(h, sph(), skin, [0, 0.14, 0], 0.15, null, true);
    P(h, sph(), hair, [0, 0.16, 0.035], 0.162, null, true);
    P(h, sph(), M.black(), [0.055, 0.15, -0.138], 0.02);
    P(h, sph(), M.black(), [-0.055, 0.15, -0.138], 0.02);
    P(h, sph(), bindi, [0, 0.2, -0.143], 0.014);
    const braid = pivot(h, 0, 0.1, 0.17);
    P(braid, taper(0.5, 8), hair, [0, -0.3, 0], [0.05, 0.6, 0.05], [Math.PI, 0, 0], true);
    P(braid, sph(), gold, [0, -0.62, 0], 0.04);
    braid.rotation.x = 0.12;
    // Right arm and the sparkler.
    r.aim.position.set(0, 1.33, 0);
    const a = r.aim;
    limb(a, skin, [0.2, 0, 0], [0.24, -0.12, -0.36], 0.05);
    P(a, cyl(), M.iron(), [0.24, -0.05, -0.55], [0.008, 0.4, 0.008], [-1.2, 0, 0]);
    const spark = P(a, ico(), M.spark(), [0.24, 0.02, -0.73], 0.05);
    r.muzzle.position.set(0.24, 0.02, -0.75); a.add(r.muzzle);
    // Left arm and the tray of lamps.
    r.armL.position.set(-0.2, 1.33, 0);
    limb(r.armL, skin, [0, 0, 0], [-0.06, -0.2, -0.3], 0.05);
    P(r.armL, cyl(), M.brass(), [-0.08, -0.17, -0.4], [0.15, 0.02, 0.15], null, true);
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3 + 0.5, x = -0.08 + Math.sin(ang) * 0.08, z = -0.4 + Math.cos(ang) * 0.08;
      P(r.armL, sph(), clay, [x, -0.145, z], [0.04, 0.025, 0.04]);
      r.flames.push(P(r.armL, sph(), M.flame(), [x, -0.105, z], [0.016, 0.03, 0.016]));
    }
    r.headY = 1.78; r.stride = 2.0; r.legSwing = 0.3; r.armSwing = 0;
    r.custom = (dt, s, st, sw) => {
      const t = s.time || 0;
      skirt.rotation.x = -st.amp * 0.07; skirt.rotation.z = sw * 0.05;
      drape.rotation.x = 0.1 + st.amp * 0.5 + Math.sin(t * 2.1 + st.seed) * 0.05;
      braid.rotation.x = 0.12 + st.amp * 0.3; braid.rotation.z = sw * 0.25;
      const k = 0.05 * (1 + 0.3 * Math.sin(t * 23 + st.seed) + st.fire * 0.5);
      spark.scale.setScalar(k); spark.rotation.y = t * 5; spark.rotation.x = t * 3.1;
    };
    return r;
  },

  // Day of the Dead: an old serenader with calavera face paint and a guitar.
  chema(hero, team) {
    const r = makeRig(0.8, 0.12);
    const suit = cloth('c.suit', '#1b1a20', 0.75), trim = mat('c.trim', { color: hero.color, emissive: hero.color, emissiveIntensity: 0.25, roughness: 0.6 });
    const face = paint('c.face', '#f4f0e6'), teal = paint('c.teal', hero.accent), silver = paint('c.silver', '#cfcfd4');
    const top = paint('c.guitar', '#c9853f');
    limb(r.legL, suit, [0, 0, 0], [0, -0.71, 0], 0.09);
    limb(r.legR, suit, [0, 0, 0], [0, -0.71, 0], 0.09);
    const b = r.body;
    P(b, taper(0.8, 12), suit, [0, 1.13, 0], [0.25, 0.62, 0.2], null, true);                  // jacket
    P(b, cone(), trim, [0.075, 1.4, -0.16], [0.055, 0.12, 0.03], [0, 0, Math.PI / 2]);        // bow tie
    P(b, cone(), trim, [-0.075, 1.4, -0.16], [0.055, 0.12, 0.03], [0, 0, -Math.PI / 2]);
    P(b, ring(0.32, Math.PI), team, [-0.2, 1.2, 0], [0.21, 0.27, 0.42], [0, Math.PI / 2, 0], true); // team sarape over the shoulder
    r.head.position.set(0, 1.44, 0);
    const h = r.head;
    P(h, sph(), face, [0, 0.13, 0], 0.15, null, true);
    P(h, sph(), M.black(), [0.058, 0.15, -0.13], [0.045, 0.045, 0.02]);                       // eye rings
    P(h, sph(), M.black(), [-0.058, 0.15, -0.13], [0.045, 0.045, 0.02]);
    P(h, cone(3), M.black(), [0, 0.105, -0.148], [0.018, 0.035, 0.01], [Math.PI, 0, 0]);      // nose mark
    P(h, box(), silver, [0, 0.065, -0.14], [0.12, 0.024, 0.03]);                              // moustache
    P(h, sph(), trim, [0, 0.215, -0.128], 0.022);                                             // marigold mark
    P(h, sph(), teal, [0.1, 0.085, -0.108], 0.014);
    P(h, sph(), teal, [-0.1, 0.085, -0.108], 0.014);
    // The wide hat, with marigolds on the brim.
    P(h, cyl(), suit, [0, 0.25, 0], [0.46, 0.022, 0.46], null, true);
    P(h, ring(0.055), trim, [0, 0.262, 0], 0.455, [Math.PI / 2, 0, 0]);
    P(h, taper(0.7, 14), suit, [0, 0.36, 0], [0.15, 0.2, 0.15], null, true);
    P(h, taper(0.95, 14), team, [0, 0.288, 0], [0.158, 0.05, 0.158]);                         // team hat band
    P(h, sph(), trim, [-0.2, 0.285, -0.3], 0.042);
    P(h, sph(), trim, [0, 0.285, -0.37], 0.042);
    P(h, sph(), trim, [0.2, 0.285, -0.3], 0.042);
    // The guitar, held across the body.
    r.aim.position.set(0, 1.3, 0);
    const a = r.aim;
    const strum = limb(a, suit, [0.23, 0, 0], [0.13, -0.3, -0.3], 0.06);
    limb(a, suit, [-0.23, 0, 0], [-0.38, -0.12, -0.3], 0.06);
    const g = pivot(a, 0, -0.26, -0.27);
    P(g, cyl(), top, [0.1, -0.04, 0], [0.17, 0.08, 0.17], [Math.PI / 2, 0, 0], true);
    P(g, cyl(), top, [-0.08, 0.04, 0], [0.125, 0.08, 0.125], [Math.PI / 2, 0, 0], true);
    P(g, cyl(), M.black(), [0.0, 0.0, -0.005], [0.05, 0.085, 0.05], [Math.PI / 2, 0, 0]);
    P(g, box(), M.darkWood(), [-0.3, 0.13, 0], [0.4, 0.045, 0.03], [0, 0, -0.39]);
    P(g, box(), M.darkWood(), [-0.52, 0.22, 0], [0.1, 0.07, 0.03], [0, 0, -0.39]);
    r.muzzle.position.set(0, -0.26, -0.42); a.add(r.muzzle);
    r.headY = 1.95; r.aimFollow = 0.45; r.armSwing = 0;
    const strumY = strum.position.y;
    r.custom = (dt, s, st) => {
      strum.position.y = strumY + st.fire * 0.03 * Math.sin((s.time || 0) * 20) - st.recoil * 0.04;
      g.rotation.z = st.recoil * 0.06;
    };
    return r;
  },
};

export function buildHero(heroId, teamColor) {
  const hero = HEROES[heroId];
  const rig = BUILD[heroId](hero, teamMat(teamColor || '#ffffff'));
  rig.group.name = 'hero:' + heroId;
  return finish(rig);
}

// ----- First-person weapons -----------------------------------------------

// A sleeve and hand that reach back toward the player.
function sleeve(parent, m, cuff, from, to, r) {
  limb(parent, m, from, to, r, false);
  P(parent, sph(), cuff, to, r * 1.25);
}

const VIEW = {
  marta(hero, v) {
    const g = v.group, green = cloth('m.cloak', '#2f6b45'), fur = cloth('m.fur', '#efe6d2', 1), leather = cloth('m.leather', '#5a3424');
    const top = P(g, cyl(), M.wood(), [0, 0.04, 0.02], [0.075, 0.014, 0.13], [0.2, 0, 0]);
    P(g, cyl(), M.wood(), [0, -0.04, 0.02], [0.075, 0.014, 0.13], [-0.2, 0, 0]);
    P(g, sph(), leather, [0, 0, 0.03], [0.068, 0.03, 0.115]);
    P(g, box(), M.wood(), [0, 0.066, 0.17], [0.03, 0.014, 0.1], [0.2, 0, 0]);                  // handle
    P(g, cyl(), M.brass(), [0, 0, -0.1], [0.028, 0.05, 0.028], [Math.PI / 2, 0, 0]);
    P(g, cone(), M.brass(), [0, 0, -0.23], [0.024, 0.22, 0.024], [-Math.PI / 2, 0, 0]);
    const ember = P(g, sph(), M.flame(), [0, 0, -0.345], 0.016);
    sleeve(g, green, fur, [0.08, -0.3, 0.32], [0.02, -0.03, 0.18], 0.05);
    v.muzzle.position.set(0, 0, -0.38);
    v.base.set(0.23, -0.2, -0.5);
    v.custom = (dt, s, st) => {
      const f = s.flaming || s.firing ? 1 : 0;
      st.fire += (f - st.fire) * Math.min(1, dt * 14);
      top.rotation.x = 0.2 - st.fire * (0.12 + 0.08 * Math.sin((s.time || 0) * 26));
      ember.scale.setScalar(0.016 * (1 + st.fire * 1.2 + 0.2 * Math.sin((s.time || 0) * 19)));
    };
  },
  jun(hero, v) {
    const g = v.group, red = lacquer('j.red', '#d8322b'), bamboo = paint('j.bamboo', '#c9b458'), cr = paint('j.cracker', '#e0281e');
    P(g, cyl(), bamboo, [0, 0, -0.08], [0.036, 0.46, 0.036], [Math.PI / 2, 0, 0]);
    P(g, cyl(), M.gold(), [0, 0, -0.29], [0.04, 0.03, 0.04], [Math.PI / 2, 0, 0]);
    P(g, cyl(), red, [0, 0, 0.02], [0.04, 0.05, 0.04], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) {
      P(g, cyl(), cr, [i % 2 ? 0.03 : -0.03, -0.075, -0.2 + i * 0.075], [0.02, 0.07, 0.02], [0, 0, i % 2 ? -0.5 : 0.5]);
    }
    const spark = P(g, sph(), M.spark(), [0, 0, -0.32], 0.018);
    sleeve(g, red, cloth('j.cuff', '#f2c230', 0.8), [0.08, -0.3, 0.34], [0.02, -0.05, 0.16], 0.05);
    v.muzzle.position.set(0, 0, -0.34);
    v.base.set(0.24, -0.22, -0.5);
    v.custom = (dt, s) => { spark.scale.setScalar(0.018 * (1 + 0.4 * Math.sin((s.time || 0) * 27) + (s.firing ? 0.8 : 0))); };
  },
  tamsin(hero, v) {
    const g = v.group, dark = cloth('t.cloak', '#2b2333'), lining = cloth('t.lining', hero.color, 0.7);
    P(g, box(), M.darkWood(), [0, -0.03, 0.14], [0.045, 0.085, 0.34], [0.1, 0, 0]);
    P(g, box(), M.darkWood(), [0, -0.012, -0.12], [0.04, 0.04, 0.3]);
    P(g, cyl(), M.iron(), [0, 0.012, -0.34], [0.013, 0.72, 0.013], [Math.PI / 2, 0, 0]);
    P(g, cyl(), M.brass(), [0, 0.012, -0.27], [0.02, 0.04, 0.02], [Math.PI / 2, 0, 0]);
    P(g, cyl(), M.brass(), [0, 0.012, -0.6], [0.02, 0.03, 0.02], [Math.PI / 2, 0, 0]);
    P(g, box(), M.iron(), [0, 0.04, -0.66], [0.006, 0.03, 0.006]);                             // front sight
    const flame = P(g, box(), M.flame(), [0, -0.04, -0.62], [0.028, 0.04, 0.028]);             // candle lantern
    sleeve(g, dark, lining, [0.08, -0.3, 0.26], [0.01, -0.07, 0.14], 0.045);
    v.muzzle.position.set(0, 0.012, -0.72);
    v.base.set(0.2, -0.2, -0.42);
    v.zoomPos.set(0, -0.14, -0.5);
    v.custom = (dt, s) => { flame.scale.y = 0.04 * (1 + 0.2 * Math.sin((s.time || 0) * 15)); };
  },
  pip(hero, v) {
    const g = v.group, mag = cloth('p.mag', hero.color, 0.7), teal = cloth('p.teal', hero.accent, 0.7);
    const R = pivot(g, 0, 0, 0), L = pivot(g, -0.5, 0, 0);
    P(R, cone(), M.gold(), [0, 0, -0.1], [0.05, 0.2, 0.05], [Math.PI / 2, 0, 0]);
    P(R, cyl(), mag, [0, 0, -0.2], [0.052, 0.012, 0.052], [Math.PI / 2, 0, 0]);
    sleeve(R, mag, M.white(), [0.07, -0.3, 0.28], [0, -0.02, 0.06], 0.045);
    P(L, cone(), M.white(), [0, 0, -0.1], [0.05, 0.2, 0.05], [Math.PI / 2, 0, 0]);
    P(L, cyl(), teal, [0, 0, -0.2], [0.052, 0.012, 0.052], [Math.PI / 2, 0, 0]);
    sleeve(L, teal, M.white(), [-0.07, -0.3, 0.28], [0, -0.02, 0.06], 0.045);
    v.muzzle.position.set(0, 0, -0.24);
    v.base.set(0.25, -0.2, -0.5);
    v.baseYaw = 0;
    let side = 0, rR = 0, rL = 0;
    v.onKick = () => {
      if (side === 0) rR = 1; else rL = 1;
      v.muzzle.position.x = side === 0 ? 0 : -0.5;
      side = 1 - side;
      return 0.25;       // most of the kick stays on the single popper
    };
    v.custom = (dt) => {
      const k = Math.exp(-dt * 18);
      rR *= k; rL *= k;
      R.position.z = rR * 0.06; R.rotation.x = rR * 0.25;
      L.position.z = rL * 0.06; L.rotation.x = rL * 0.25;
    };
  },
  meenal(hero, v) {
    const g = v.group, skin = paint('me.skin', '#a86b45'), gold = metal('me.gold', hero.accent, 0.4), clay = cloth('me.clay', '#b5562f');
    P(g, cyl(), M.iron(), [0, 0.05, -0.13], [0.005, 0.36, 0.005], [-1.25, 0, 0]);
    const spark = P(g, ico(), M.spark(), [0, 0.108, -0.3], 0.024);
    sleeve(g, skin, skin, [0.08, -0.3, 0.3], [0, -0.01, 0.05], 0.04);
    P(g, ring(0.2), gold, [0.02, -0.083, 0.113], 0.05, [0.86, 0.25, 0]);                       // bangles
    P(g, ring(0.2), gold, [0.028, -0.112, 0.138], 0.05, [0.86, 0.25, 0]);
    // The tray of lamps sits low on the left.
    const tray = pivot(g, -0.47, -0.1, -0.06);
    tray.scale.setScalar(0.72);
    P(tray, cyl(), M.brass(), [0, 0, 0], [0.12, 0.012, 0.12]);
    const flames = [];
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3 + 0.4, x = Math.sin(ang) * 0.06, z = Math.cos(ang) * 0.06;
      P(tray, sph(), clay, [x, 0.018, z], [0.032, 0.02, 0.032]);
      flames.push(P(tray, sph(), M.flame(), [x, 0.05, z], [0.012, 0.024, 0.012]));
    }
    v.muzzle.position.set(0, 0.108, -0.32);
    v.base.set(0.24, -0.2, -0.5);
    v.custom = (dt, s) => {
      const t = s.time || 0;
      spark.scale.setScalar(0.024 * (1 + 0.35 * Math.sin(t * 23) + (s.firing ? 0.6 : 0)));
      spark.rotation.y = t * 6; spark.rotation.x = t * 3.7;
      for (let i = 0; i < 3; i++) flames[i].scale.y = 0.024 * (1 + 0.25 * Math.sin(t * 16 + i * 2));
    };
  },
  chema(hero, v) {
    const g = v.group, suit = cloth('c.suit', '#1b1a20', 0.75), top = paint('c.guitar', '#c9853f');
    const trim = mat('c.trim', { color: hero.color, emissive: hero.color, emissiveIntensity: 0.25, roughness: 0.6 });
    const gt = pivot(g, 0, 0, 0);
    gt.rotation.set(0.1, 0.22, 0.45);
    // The sound board faces up toward the player; the neck points forward.
    P(gt, cyl(), top, [0, 0, 0.15], [0.1, 0.04, 0.1]);
    P(gt, cyl(), top, [0, 0, 0.02], [0.075, 0.04, 0.075]);
    P(gt, cyl(), M.black(), [0, 0.003, 0.07], [0.03, 0.04, 0.03]);
    P(gt, box(), M.darkWood(), [0, 0.012, -0.24], [0.03, 0.02, 0.42]);
    P(gt, box(), M.darkWood(), [0, 0.012, -0.48], [0.05, 0.02, 0.08]);
    P(gt, box(), trim, [0, 0.024, 0.19], [0.06, 0.008, 0.014]);                                // bridge
    gt.add(v.muzzle);
    v.muzzle.position.set(0, 0.02, -0.54);
    sleeve(g, suit, trim, [0.12, -0.3, 0.3], [0.07, -0.01, 0.2], 0.045);
    v.base.set(0.22, -0.2, -0.46);
    v.custom = (dt, s, st) => { gt.rotation.z = 0.45 + st.recoil * 0.08; };
  },
};

export function buildViewModel(heroId) {
  const hero = HEROES[heroId];
  const outer = new THREE.Group();
  const v = {
    group: pivot(outer, 0, 0, 0), muzzle: new THREE.Object3D(),
    base: new THREE.Vector3(0.25, -0.22, -0.52), zoomPos: new THREE.Vector3(0, -0.2, -0.46),
    baseYaw: 0.05, custom: null, onKick: null,
  };
  v.group.add(v.muzzle);
  VIEW[heroId](hero, v);
  outer.name = 'view:' + heroId;
  outer.traverse((o) => { o.frustumCulled = false; if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const st = { phase: 0, mv: 0, recoil: 0, cast: 0, castSlot: 0, air: 0, fire: 0 };
  const g = v.group;

  return {
    group: outer,
    muzzle: v.muzzle,
    update(dt, s) {
      const speed = s.speed || 0, ground = s.onGround !== false, time = s.time || 0;
      const z = s.zoom || 0, k = 1 - z;
      st.phase += dt * Math.min(speed, 10) * 1.6;
      st.mv += ((ground ? Math.min(1, speed / 6) : 0) - st.mv) * Math.min(1, dt * 10);
      st.air += ((ground ? 0 : 1) - st.air) * Math.min(1, dt * 8);
      st.recoil *= Math.exp(-dt * 16);
      if (st.cast > 0) st.cast = Math.max(0, st.cast - dt / 0.4);
      const fl = st.cast > 0 ? Math.sin(Math.PI * (1 - st.cast)) : 0;
      const rl = s.reload ? Math.sin(Math.PI * Math.min(1, s.reload)) : 0;
      const bobX = Math.cos(st.phase) * 0.011 * st.mv * k;
      const bobY = -Math.abs(Math.sin(st.phase)) * 0.013 * st.mv * k;
      const swayX = Math.sin(time * 1.1) * 0.003 * k, swayY = Math.sin(time * 1.7) * 0.003 * k;
      g.position.set(
        v.base.x + (v.zoomPos.x - v.base.x) * z + bobX + swayX,
        v.base.y + (v.zoomPos.y - v.base.y) * z + bobY + swayY - rl * 0.2 - fl * 0.05 + st.air * 0.015,
        v.base.z + (v.zoomPos.z - v.base.z) * z + st.recoil * 0.05,
      );
      const dir = st.castSlot === 1 ? -1 : 1;
      g.rotation.set(
        st.recoil * 0.1 - rl * 0.85 + (st.castSlot === 2 ? fl * 0.5 : -fl * 0.15),
        v.baseYaw * k + fl * 0.25 * dir,
        fl * 0.5 * dir + rl * 0.25,
      );
      if (v.custom) v.custom(dt, s, st);
    },
    kick() {
      const amount = v.onKick ? v.onKick() : 1;
      st.recoil = Math.max(st.recoil, amount);
    },
    cast(slot) { st.cast = 1; st.castSlot = slot | 0; },
    dispose() { if (outer.parent) outer.parent.remove(outer); },
  };
}
