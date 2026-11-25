// Builds the look of Almanac Square from the map data: walls, ground, sky,
// lights and all the festival decorations. Collision lives in the sim; this
// file only draws.

import * as THREE from 'three';
import * as TX from './textures.js';
import { TEAMS } from '../data/heroes.js';

// Collects quads and triangles, then makes one mesh. Keeps draw calls low.
class Batch {
  constructor() { this.p = []; this.n = []; this.u = []; }
  quad(a, b, c, d, n, uv) {
    // a,b,c,d counter-clockwise seen from outside; uv = [[u,v] x4]
    const P = this.p, N = this.n, U = this.u;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = [a, b, c, d][i];
      P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]); U.push(uv[i][0], uv[i][1]);
    }
  }
  tri(a, b, c, n, uv) {
    [a, b, c].forEach((v, i) => { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[i][0], uv[i][1]); });
  }
  box(x0, x1, y0, y1, z0, z1, tu = 2, tv = tu, bottom = false) {
    const u = (a, b) => [a / tu, b / tv];
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [u(-z1, y0), u(-z0, y0), u(-z0, y1), u(-z1, y1)]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [u(z0, y0), u(z1, y0), u(z1, y1), u(z0, y1)]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [u(x0, y0), u(x1, y0), u(x1, y1), u(x0, y1)]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [u(-x1, y0), u(-x0, y0), u(-x0, y1), u(-x1, y1)]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [u(x0, -z1), u(x1, -z1), u(x1, -z0), u(x0, -z0)]);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [u(x0, z0), u(x1, z0), u(x1, z1), u(x0, z1)]);
  }
  ramp(s, t = 2) {
    // Map a canonical ramp (rising toward +u) into world space.
    const along = s.axis === 'x';
    const lo = along ? (s.dir > 0 ? s.x0 : s.x1) : (s.dir > 0 ? s.z0 : s.z1);
    const hi = along ? (s.dir > 0 ? s.x1 : s.x0) : (s.dir > 0 ? s.z1 : s.z0);
    const w0 = along ? s.z0 : s.x0, w1 = along ? s.z1 : s.x1;
    const P = (a, y, w) => (along ? [a, y, w] : [w, y, a]);
    const len = Math.abs(hi - lo), hgt = s.y1 - s.y0, sl = Math.hypot(len, hgt);
    const flip = (along ? 1 : -1) * (s.dir > 0 ? 1 : -1) < 0;
    const q = (a, b, c, d, n, uv) => (flip ? this.quad(a, d, c, b, n, [uv[0], uv[3], uv[2], uv[1]]) : this.quad(a, b, c, d, n, uv));
    const tr = (a, b, c, n, uv) => (flip ? this.tri(a, c, b, n, [uv[0], uv[2], uv[1]]) : this.tri(a, b, c, n, uv));
    const nd = s.dir > 0 ? 1 : -1;
    const nSlope = along ? [(-hgt / sl) * nd, len / sl, 0] : [0, len / sl, (-hgt / sl) * nd];
    const nBack = along ? [nd, 0, 0] : [0, 0, nd];
    q(P(lo, s.y0, w1), P(hi, s.y1, w1), P(hi, s.y1, w0), P(lo, s.y0, w0), nSlope, [[0, w1 / t], [sl / t, w1 / t], [sl / t, w0 / t], [0, w0 / t]]);
    q(P(hi, s.y0, w1), P(hi, s.y0, w0), P(hi, s.y1, w0), P(hi, s.y1, w1), nBack, [[w1 / t, 0], [w0 / t, 0], [w0 / t, hgt / t], [w1 / t, hgt / t]]);
    const nS1 = along ? [0, 0, 1] : [1, 0, 0], nS0 = along ? [0, 0, -1] : [-1, 0, 0];
    tr(P(lo, s.y0, w1), P(hi, s.y0, w1), P(hi, s.y1, w1), nS1, [[0, 0], [len / t, 0], [len / t, hgt / t]]);
    tr(P(hi, s.y0, w0), P(lo, s.y0, w0), P(hi, s.y1, w0), nS0, [[len / t, 0], [0, 0], [len / t, hgt / t]]);
  }
  mesh(material, shadow = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadow; m.receiveShadow = true;
    return m;
  }
}

const BULB_COLORS = [0xffc46b, 0xff5d5d, 0x6bd6ff, 0x9dff8a, 0xff8ad8, 0xffe9a8];

export function buildMap(map, scene, quality) {
  const root = new THREE.Group();
  scene.add(root);
  const anim = [];      // functions (time, dt) run every frame
  const T = {
    cobble: TX.cobble(), stone: TX.stone(), wood: TX.wood(5), darkWood: TX.wood(9, [58, 38, 26]),
    facadeA: TX.facade(1, 0.65, '#d9c9ae'), facadeB: TX.facade(2, 0.5, '#c9b8a6'), plaster: TX.facade(4, 0.45, '#e2d6c0'),
  };
  const M = {
    ground: new THREE.MeshStandardMaterial({ ...T.cobble, roughness: 0.85, metalness: 0.05, normalScale: new THREE.Vector2(1.1, 1.1) }),
    stone: new THREE.MeshStandardMaterial({ ...T.stone, roughness: 0.9 }),
    dais: new THREE.MeshStandardMaterial({ ...T.stone, roughness: 0.7, color: 0xcfc4d8 }),
    facade: new THREE.MeshStandardMaterial({ ...T.facadeA, roughness: 0.95, emissive: 0xffffff, emissiveIntensity: 1.0 }),
    plaster: new THREE.MeshStandardMaterial({ ...T.plaster, roughness: 0.95, emissive: 0xffffff, emissiveIntensity: 1.0 }),
    back: new THREE.MeshLambertMaterial({ map: T.facadeB.map, emissiveMap: T.facadeB.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.8, color: 0x8f86a0 }),
    timber: new THREE.MeshStandardMaterial({ ...T.darkWood, roughness: 0.8 }),
    crate: new THREE.MeshStandardMaterial({ ...T.wood, roughness: 0.75 }),
    cart: new THREE.MeshStandardMaterial({ ...T.wood, roughness: 0.6, color: 0xbfd8e8 }),
    stall: new THREE.MeshStandardMaterial({ ...T.wood, roughness: 0.7, color: 0xe8c9a0 }),
    brazier: new THREE.MeshStandardMaterial({ ...T.stone, color: 0xe0b890, roughness: 0.6, metalness: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd9a050, roughness: 0.35, metalness: 0.85 }),
    post: new THREE.MeshStandardMaterial({ color: 0x23202a, roughness: 0.45, metalness: 0.9 }),
    roof: new THREE.MeshLambertMaterial({ color: 0x2c2a3a }),
    snow: new THREE.MeshLambertMaterial({ color: 0xdfe8f5 }),
  };
  for (const k of ['ground']) { for (const t of [M[k].map, M[k].normalMap, M[k].roughnessMap]) t.repeat.set(1, 1); }

  // ----- Ground ----------------------------------------------------------
  const b = map.bounds;
  const ground = new Batch();
  ground.quad([b.x0 - 30, 0, b.z1 + 30], [b.x1 + 30, 0, b.z1 + 30], [b.x1 + 30, 0, b.z0 - 30], [b.x0 - 30, 0, b.z0 - 30], [0, 1, 0],
    [[(b.x0 - 30) / 3, (b.z1 + 30) / 3], [(b.x1 + 30) / 3, (b.z1 + 30) / 3], [(b.x1 + 30) / 3, (b.z0 - 30) / 3], [(b.x0 - 30) / 3, (b.z0 - 30) / 3]]);
  const gm = ground.mesh(M.ground, false);
  root.add(gm);

  // ----- Solids ----------------------------------------------------------
  const batches = {};
  const get = (k) => batches[k] || (batches[k] = new Batch());
  const tiles = { facade: [4, 4.5], plaster: [4, 4.5], stone: [2, 2], dais: [2.5, 2.5], timber: [1.5, 1.5], crate: [1.4, 1.4], cart: [1.5, 1.5], stall: [1.6, 1.6], brazier: [1, 1], post: [1, 1] };
  const stalls = [], carts = [], posts = [];
  for (const s of map.solids) {
    const key = M[s.mat] ? s.mat : 'stone';
    const t = tiles[key] || [2, 2];
    if (s.ramp) {
      const o = { ...s, axis: s.ramp[0], dir: s.ramp[1] === '+' ? 1 : -1 };
      get(key).ramp(o, t[0]);
    } else get(key).box(s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, t[0], t[1], s.y0 > 0);
    if (s.mat === 'stall') stalls.push(s);
    if (s.mat === 'cart') carts.push(s);
    if (s.mat === 'post') posts.push(s);
  }
  for (const k in batches) root.add(batches[k].mesh(M[k]));

  // ----- Roofs and skyline -----------------------------------------------
  const roof = new Batch(), back = new Batch(), snow = new Batch();
  const prism = (bt, x0, x1, z0, z1, y, h, alongX) => {
    if (alongX) {
      const zm = (z0 + z1) / 2;
      bt.quad([x0, y, z1], [x1, y, z1], [x1, y + h, zm], [x0, y + h, zm], [0, 0.6, 0.8], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      bt.quad([x1, y, z0], [x0, y, z0], [x0, y + h, zm], [x1, y + h, zm], [0, 0.6, -0.8], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      bt.tri([x0, y, z0], [x0, y, z1], [x0, y + h, zm], [-1, 0, 0], [[0, 0], [1, 0], [0.5, 1]]);
      bt.tri([x1, y, z1], [x1, y, z0], [x1, y + h, zm], [1, 0, 0], [[0, 0], [1, 0], [0.5, 1]]);
    } else {
      const xm = (x0 + x1) / 2;
      bt.quad([x1, y, z1], [x1, y, z0], [xm, y + h, z0], [xm, y + h, z1], [0.8, 0.6, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      bt.quad([x0, y, z0], [x0, y, z1], [xm, y + h, z1], [xm, y + h, z0], [-0.8, 0.6, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      bt.tri([x0, y, z1], [x1, y, z1], [xm, y + h, z1], [0, 0, 1], [[0, 0], [1, 0], [0.5, 1]]);
      bt.tri([x1, y, z0], [x0, y, z0], [xm, y + h, z0], [0, 0, -1], [[0, 0], [1, 0], [0.5, 1]]);
    }
  };
  // Houses behind the outer walls, with roofs. Some roofs carry snow.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const side of [-1, 1]) {
    let x = b.x0 - 6;
    while (x < b.x1 + 6) {
      const w = 8 + rnd() * 8, h = 9 + rnd() * 8, d = 9 + rnd() * 4;
      const z0 = side > 0 ? b.z1 : b.z0 - d, z1 = z0 + d;
      back.box(x, x + w, 0, h, z0, z1, 4, 4.5);
      const rb = rnd() < 0.5 && x < -10 ? snow : roof;
      prism(rb, x - 0.4, x + w + 0.4, z0 - 0.4, z1 + 0.4, h, 3 + rnd() * 2.5, rnd() < 0.5);
      x += w;
    }
    let z = b.z0 - 4;
    while (z < b.z1 + 4) {
      const w = 8 + rnd() * 7, h = 10 + rnd() * 7, d = 9;
      const x0 = side > 0 ? b.x1 : b.x0 - d;
      back.box(x0, x0 + d, 0, h, z, z + w, 4, 4.5);
      prism(side < 0 && rnd() < 0.6 ? snow : roof, x0 - 0.4, x0 + d + 0.4, z - 0.4, z + w + 0.4, h, 3 + rnd() * 2, false);
      z += w;
    }
  }
  // Small roofs over the spawn houses and the arch walls.
  for (const sgn of [-1, 1]) {
    prism(sgn < 0 ? snow : roof, sgn * 50 - 6.6, sgn * 50 + 6.6, -9.8, 9.8, 5, 2.6, false);
    prism(roof, sgn * 22 - 1.5, sgn * 22 + 1.5, sgn > 0 ? -19 : -26.5, sgn > 0 ? 26.5 : 19, 9, 1.4, false);
  }
  root.add(back.mesh(M.back, false), roof.mesh(M.roof, false), snow.mesh(M.snow, false));

  // The clock tower. Its clock is wrong on purpose: this is Pip's doing.
  {
    const tower = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 30, 7), M.back);
    body.position.set(0, 15, b.z1 + 8);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(6, 8, 4), M.roof);
    cap.position.set(0, 34, b.z1 + 8); cap.rotation.y = Math.PI / 4;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff3d6'; c.beginPath(); c.arc(128, 128, 122, 0, 6.283); c.fill();
    c.strokeStyle = '#3b2a20'; c.lineWidth = 8; c.stroke();
    c.fillStyle = '#3b2a20'; c.font = 'bold 30px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const nums = [13, 2, 7, 4, 1, 6, 5, 8, 11, 10, 9, 3];
    nums.forEach((n, i) => { const a = (i / 12) * 6.283 - 1.571; c.fillText(String(n), 128 + Math.cos(a) * 94, 128 + Math.sin(a) * 94); });
    c.lineWidth = 7; c.beginPath(); c.moveTo(128, 128); c.lineTo(128, 52); c.moveTo(128, 128); c.lineTo(182, 150); c.stroke();
    const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(2.6, 32), new THREE.MeshStandardMaterial({ map: ct, emissiveMap: ct, emissive: 0xffffff, emissiveIntensity: 1.1 }));
    face.position.set(0, 25, b.z1 + 4.45); face.rotation.y = Math.PI;
    tower.add(body, cap, face);
    root.add(tower);
  }

  // ----- Stall awnings, cart loads, lamp posts ---------------------------
  const cloth = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const awnColors = [0xd8322b, 0xffb300, 0x2f9e6e, 0x7c4dff];
  stalls.forEach((s, i) => {
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    const aw = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.16, d + 0.9), cloth(awnColors[i % awnColors.length]));
    aw.position.set((s.x0 + s.x1) / 2, s.y1 + 0.5, (s.z0 + s.z1) / 2);
    aw.rotation.z = 0.12 * (i % 2 ? 1 : -1);
    aw.castShadow = true;
    root.add(aw);
    for (const [px, pz] of [[s.x0 - 0.3, s.z0 - 0.3], [s.x1 + 0.3, s.z0 - 0.3], [s.x0 - 0.3, s.z1 + 0.3], [s.x1 + 0.3, s.z1 + 0.3]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), M.post);
      p.position.set(px, s.y1 + 0.2, pz); root.add(p);
    }
  });
  const pumpkinMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, emissive: 0xff5a00, emissiveIntensity: 0.35 });
  const pumpkinGeo = new THREE.SphereGeometry(0.34, 12, 8);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffb347, emissiveIntensity: 3 });
  carts.forEach((s, i) => {
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    for (let k = 0; k < 5; k++) {
      const p = new THREE.Mesh(pumpkinGeo, i % 2 ? pumpkinMat : M.snow);
      const sc = 0.7 + ((k * 37) % 10) / 14;
      p.scale.set(sc, sc * 0.78, sc);
      p.position.set(cx + ((k % 3) - 1) * (s.x1 - s.x0) * 0.28, s.y1 + 0.22 * sc, cz + ((k % 2) - 0.5) * (s.z1 - s.z0) * 0.4);
      p.castShadow = true; root.add(p);
    }
  });
  const postLights = [];
  posts.forEach((s) => {
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), lampMat);
    l.position.set(cx, s.y1 + 0.35, cz); root.add(l);
    const pl = new THREE.PointLight(0xffb866, 30, 22, 2);
    pl.position.set(cx, s.y1 + 0.4, cz); root.add(pl); postLights.push(pl);
  });

  // ----- String lights and paper flags -----------------------------------
  const strings = [];
  const addString = (ax, ay, az, bx, by, bz, sag) => strings.push([ax, ay, az, bx, by, bz, sag]);
  for (const s of [-1, 1]) {
    addString(s * 21, 8.6, s * 4, 0, 6.2, 0, 2.2);
    addString(s * 21, 8.6, -s * 4, 0, 6.2, 0, 2.2);
    addString(s * 4, 8.6, s * 26, 0, 6.2, 0, 2.6);
    addString(-s * 9, 8.6, s * 26, 0, 6.2, 0, 2.6);
    addString(s * 43.5, 4.8, -9, s * 23, 8.2, -17, 1.5);
    addString(s * 43.5, 4.8, 9, s * 23, 8.2, 12, 1.5);
    addString(s * 43.5, 4.8, 0, s * 23, 8.6, 0, 2);
  }
  const bulbs = [], flags = [];
  for (const [ax, ay, az, bx, by, bz, sag] of strings) {
    const len = Math.hypot(bx - ax, by - ay, bz - az), n = Math.floor(len / 0.85);
    for (let i = 1; i < n; i++) {
      const t = i / n, y = ay + (by - ay) * t - Math.sin(t * Math.PI) * sag;
      const p = [ax + (bx - ax) * t, y, az + (bz - az) * t];
      if (i % 3 === 0) flags.push([...p, Math.atan2(bx - ax, bz - az)]); else bulbs.push(p);
    }
  }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  bulbs.forEach((p, i) => {
    dummy.position.set(p[0], p[1], p[2]); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
    bulbMesh.setMatrixAt(i, dummy.matrix);
    bulbMesh.setColorAt(i, col.setHex(BULB_COLORS[i % BULB_COLORS.length]).multiplyScalar(1.7));
  });
  bulbMesh.frustumCulled = false;
  root.add(bulbMesh);
  const flagTex = TX.paperFlag();
  const flagMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshStandardMaterial({ map: flagTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, emissive: 0xffffff, emissiveMap: flagTex, emissiveIntensity: 0.25 }), flags.length);
  const flagColors = [0xff3d7f, 0xffb300, 0x00c2a8, 0x7c4dff, 0xff6a3d, 0x3d9bff];
  flags.forEach((p, i) => {
    dummy.position.set(p[0], p[1] - 0.36, p[2]); dummy.rotation.set(0, p[3] + Math.PI / 2, 0); dummy.updateMatrix();
    flagMesh.setMatrixAt(i, dummy.matrix); flagMesh.setColorAt(i, col.setHex(flagColors[i % flagColors.length]));
  });
  flagMesh.frustumCulled = false;
  root.add(flagMesh);

  // ----- Festival dressing by side ---------------------------------------
  // Dawn side (x < 0): midwinter trees and Halloween lanterns.
  // Dusk side (x > 0): red lanterns for the new year, lamps and marigolds.
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x1f5a3a, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 1 });
  const tree = (x, z, h) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, h * 0.25, 6), trunkMat);
    trunk.position.y = h * 0.125; g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(h * 0.26 - i * h * 0.06, h * 0.38, 8), treeMat);
      c.position.y = h * 0.36 + i * h * 0.22; c.castShadow = true; g.add(c);
      const sn = new THREE.Mesh(new THREE.ConeGeometry((h * 0.26 - i * h * 0.06) * 0.6, h * 0.16, 8), M.snow);
      sn.position.y = h * 0.47 + i * h * 0.22; g.add(sn);
    }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), lampMat);
    star.position.y = h * 1.02; g.add(star);
    g.position.set(x, 0, z); root.add(g);
  };
  tree(-41.5, 24.2, 6); tree(-24.5, -12, 5); tree(-42.5, -24.5, 7); tree(-25, 13.5, 4.5); tree(-55, 12, 5.5); tree(-55, -12, 5.5);
  const turnipGeo = new THREE.SphereGeometry(0.3, 10, 8);
  const turnipMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.55, emissive: 0xff6a00, emissiveIntensity: 1.2 });
  for (const [x, z] of [[-43, 11], [-43, -11], [-23.6, 5.4], [-23.6, -5.4], [-37, 25], [-31, -25], [-20.3, -16.6], [-9.6, 12.6], [-55, 0]]) {
    const p = new THREE.Mesh(turnipGeo, turnipMat); p.scale.y = 0.8; p.position.set(x, 0.24, z); p.castShadow = true; root.add(p);
    const q = new THREE.Mesh(turnipGeo, pumpkinMat); q.scale.set(1.5, 1.2, 1.5); q.position.set(x + 0.55, 0.36, z + 0.2); q.castShadow = true; root.add(q);
  }
  // Red lanterns in rows.
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xff2a1a, roughness: 0.5, emissive: 0xff2200, emissiveIntensity: 1.6 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.3, metalness: 0.9 });
  const lanternGeo = new THREE.SphereGeometry(0.42, 12, 10), capGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 10);
  const lanterns = [];
  const lantern = (x, y, z) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(lanternGeo, lanternMat); body.scale.y = 0.85;
    const c1 = new THREE.Mesh(capGeo, goldMat); c1.position.y = 0.36;
    const c2 = new THREE.Mesh(capGeo, goldMat); c2.position.y = -0.36;
    g.add(body, c1, c2); g.position.set(x, y, z); root.add(g); lanterns.push(g);
  };
  for (let z = -15; z <= 17; z += 3.2) if (Math.abs(z) > 5.5) lantern(20.7, 6.4, z);
  for (let x = 26; x <= 42; x += 4) { lantern(x, 6.6, 25.6); lantern(x, 6.6, -25.6); }
  for (const z of [-7, 7, -3.4, 3.4]) lantern(43.2, 4.4, z);
  // Clay lamps (diyas) in rows, and marigold garlands.
  const diyaPts = [];
  for (let x = 10.4; x <= 20.6; x += 0.8) diyaPts.push([x, map.terraceHeight + 0.06, -13.3]);
  for (let z = -18.6; z <= -13.4; z += 0.8) diyaPts.push([10.3, map.terraceHeight + 0.06, z]);
  for (let i = 0; i < 44; i++) { const a = (i / 44) * 6.283; diyaPts.push([Math.cos(a) * 7.25, 0.36, Math.sin(a) * 7.25]); }
  for (let z = -8; z <= 8; z += 1) diyaPts.push([43.2, 0.06, z < -4.2 || z > 4.2 ? z : 99]);
  const diyas = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb347).multiplyScalar(2) }), diyaPts.length);
  diyaPts.forEach((p, i) => { dummy.position.set(p[0], p[1], p[2]); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); diyas.setMatrixAt(i, dummy.matrix); });
  diyas.frustumCulled = false; root.add(diyas);
  const mariPts = [];
  const garland = (ax, ay, az, bx, by, bz, sag) => {
    const n = Math.floor(Math.hypot(bx - ax, by - ay, bz - az) / 0.22);
    for (let i = 0; i <= n; i++) { const t = i / n; mariPts.push([ax + (bx - ax) * t, ay + (by - ay) * t - Math.sin(t * Math.PI) * sag, az + (bz - az) * t]); }
  };
  for (let z = -24; z < -19.5; z += 2.2) garland(20.9, 8.2, z, 20.9, 8.2, z + 2.2, 0.8);
  for (let z = 5; z < 18; z += 3.2) garland(20.9, 4.6, z, 20.9, 4.6, z + 3.2, 0.9);
  for (let x = 24; x < 42; x += 3) { garland(x, 3.3, 9.6, x + 3, 3.3, 9.6, 0.5); }
  garland(43.4, 3.3, -4, 43.4, 3.3, 4, 0.7);
  const mari = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: 0xff9a1f, roughness: 0.7, emissive: 0xff6a00, emissiveIntensity: 0.35 }), mariPts.length);
  mariPts.forEach((p, i) => { dummy.position.set(p[0], p[1], p[2]); dummy.rotation.set(i, i * 2, 0); dummy.updateMatrix(); mari.setMatrixAt(i, dummy.matrix); mari.setColorAt(i, col.setHex(i % 5 === 0 ? 0xffd23f : 0xff9a1f)); });
  mari.frustumCulled = false; root.add(mari);

  // Rangoli on the dais.
  const rangoliTex = TX.rangoli();
  const inlay = new THREE.Mesh(new THREE.CircleGeometry(6.6, 48), new THREE.MeshStandardMaterial({ map: rangoliTex, transparent: true, opacity: 0.42, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  inlay.rotation.x = -Math.PI / 2; inlay.position.set(0, map.point.y + 0.012, 0); inlay.receiveShadow = true;
  root.add(inlay);

  // The Year-Fire bowl.
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 0.9, 0.7, 20, 1, true), M.brass);
  bowl.material.side = THREE.DoubleSide;
  bowl.position.set(0, 2.95, 0); bowl.castShadow = true; root.add(bowl);
  const coals = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a1a).multiplyScalar(2.5) }));
  coals.rotation.x = -Math.PI / 2; coals.position.set(0, 3.1, 0); root.add(coals);

  // Team banners on the spawn houses.
  for (const t of [0, 1]) {
    const s = t === 0 ? -1 : 1;
    const mat = new THREE.MeshStandardMaterial({ color: TEAMS[t].color, roughness: 0.8, side: THREE.DoubleSide, emissive: TEAMS[t].color, emissiveIntensity: 0.25 });
    for (const z of [-6.5, 6.5]) {
      const bn = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.6), mat);
      bn.position.set(s * 43.4, 2.9, z); bn.rotation.y = s * -Math.PI / 2; root.add(bn);
    }
  }
  // Gate curtains: a soft veil in the team colour.
  const gateMats = [0, 1].map((t) => new THREE.MeshBasicMaterial({ color: TEAMS[t].color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  for (const g of map.gates) {
    const w = g.x1 - g.x0, d = g.z1 - g.z0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, d), g.y1), gateMats[g.team]);
    m.position.set((g.x0 + g.x1) / 2, g.y1 / 2, (g.z0 + g.z1) / 2);
    if (d > w) m.rotation.y = Math.PI / 2;
    root.add(m);
  }

  // ----- Sky -------------------------------------------------------------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { moonDir: { value: new THREE.Vector3(-0.35, 0.5, -0.6).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 moonDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 top = vec3(0.012,0.02,0.07), mid = vec3(0.10,0.06,0.20), hor = vec3(0.62,0.26,0.22);
        vec3 c = mix(hor, mid, smoothstep(-0.02, 0.22, h));
        c = mix(c, top, smoothstep(0.15, 0.75, h));
        float m = max(dot(normalize(vDir), moonDir), 0.0);
        c += vec3(0.5,0.55,0.75) * pow(m, 40.0) * 0.5;
        c += vec3(1.3,1.25,1.1) * smoothstep(0.9993, 0.9996, m);
        vec3 g = floor(normalize(vDir) * 190.0);
        float s = step(0.9972, hash(g)) * smoothstep(0.1, 0.5, h);
        c += vec3(s) * (0.6 + 0.6 * hash(g + 3.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  sky.renderOrder = 10; // drawn after the walls, so hidden sky costs nothing
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0x2a2038, 0.0105);

  // Floating paper lanterns.
  const NL = quality === 'low' ? 50 : 140;
  const skyL = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.36, 0.9, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(1.5), fog: false }), NL);
  const lp = [];
  for (let i = 0; i < NL; i++) lp.push([(rnd() - 0.5) * 320, 14 + rnd() * 80, (rnd() - 0.5) * 240, 0.5 + rnd() * 0.9, rnd() * 6.28]);
  skyL.frustumCulled = false; scene.add(skyL);
  anim.push((time) => {
    for (let i = 0; i < NL; i++) {
      const p = lp[i];
      const y = 14 + ((p[1] + time * p[3]) % 90);
      dummy.position.set(p[0] + Math.sin(time * 0.2 + p[4]) * 3, y, p[2] + Math.cos(time * 0.17 + p[4]) * 3);
      dummy.rotation.set(0, p[4], Math.sin(time * 0.5 + p[4]) * 0.1); dummy.scale.setScalar(1); dummy.updateMatrix();
      skyL.setMatrixAt(i, dummy.matrix);
    }
    skyL.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < lanterns.length; i++) lanterns[i].rotation.z = Math.sin(time * 1.3 + i) * 0.08;
  });

  // ----- Lights ----------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x9aa6ff, 0x5a4034, 1.5);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xbfd0ff, 2.1);
  moon.position.set(-38, 62, -50);
  moon.target.position.set(0, 0, 0);
  scene.add(moon, moon.target);
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = -62; sc.right = 62; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 160;
  moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.05;
  const fire = new THREE.PointLight(0xffa24a, 150, 50, 1.7);
  fire.position.set(0, 5.4, 0);
  scene.add(fire);
  const fills = [];
  {
    for (const [x, y, z, c, i] of [[-33, 6, 0, 0xffb070, 70], [33, 6, 0, 0xff5a3a, 70], [0, 5, 20, 0xffc890, 45], [0, 5, -20, 0xffc890, 45]]) {
      const l = new THREE.PointLight(c, i, 34, 2); l.position.set(x, y, z); scene.add(l); fills.push(l);
    }
  }
  anim.push((time) => { fire.intensity = fire.userData.base * (0.88 + 0.12 * Math.sin(time * 11) * Math.sin(time * 7.3) + 0.06 * Math.sin(time * 23)); });
  fire.userData.base = 150;

  return { root, sky, moon, hemi, fire, fills, posts: postLights, anim, materials: M, rangoliTex };
}
