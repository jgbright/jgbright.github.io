// The 3-D view of a match: renderer, camera, post-processing, hero figures,
// the objective ring and the feast plates. It reads the sim; it never changes it.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildMap } from './mapview.js';
import { buildHero, buildViewModel } from './heromodels.js';
import { Fx } from './fx.js';
import { RULES, TEAMS } from '../data/heroes.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;

export class GameView {
  constructor(canvas, map, quality, fov) {
    this.canvas = canvas; this.map = map; this.quality = quality; this.fov = fov || 74;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov, 16 / 9, 0.05, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.mapView = buildMap(map, this.scene, quality);
    this.fx = new Fx(this.scene, quality, this);
    this.heroes = new Map();
    this.viewModel = null; this.viewHero = null;
    this.sim = null; this.human = null;
    this.time = 0; this.shakeAmt = 0; this.dip = 0; this.camY = 0; this.zoom = 0;
    this.deathCam = new THREE.Vector3(); this.deathLook = new THREE.Vector3();
    this.menuHero = null; this.menuAngle = 0;

    // Environment light for the metal and lacquer materials.
    try {
      const pm = new THREE.PMREMGenerator(r);
      const es = new THREE.Scene();
      es.add(this.mapView.sky.clone());
      const warm = new THREE.Mesh(new THREE.SphereGeometry(30, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.22).multiplyScalar(3) }));
      warm.position.set(0, -20, 0); es.add(warm);
      this.scene.environment = pm.fromScene(es, 0.04).texture;
      this.scene.environmentIntensity = 0.55;
      pm.dispose();
    } catch (e) { /* environment is optional */ }

    // Objective ring.
    const pr = RULES.pointRadius, py = map.point.y;
    this.pointRing = new THREE.Mesh(new THREE.RingGeometry(pr - 0.16, pr, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.pointRing.position.set(map.point.x, 0.05, map.point.z);
    this.capRing = new THREE.Mesh(new THREE.RingGeometry(pr - 0.75, pr - 0.25, 96, 1, 0, 0.01).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.capRing.position.set(map.point.x, py + 0.03, map.point.z);
    this.capShown = -1;
    this.scene.add(this.pointRing, this.capRing);
    this.pointColor = new THREE.Color(1, 1, 1);
    this.fireColor = new THREE.Color(0xffa24a);

    // Feast plates.
    this.packs = map.packs.map((p) => {
      const g = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xf2e9d8, roughness: 0.25, metalness: 0.1 }));
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd98a3a, roughness: 0.6, emissive: 0xff8a2a, emissiveIntensity: 0.5 }));
      bun.scale.y = 0.75; bun.position.y = 0.2;
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9dff8a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.y = -0.78;
      g.add(plate, bun, halo);
      g.position.set(p.x, 0.9, p.z);
      this.scene.add(g);
      return g;
    });

    this.setQuality(quality);
    this.resize();
  }

  // ----- Quality and size ------------------------------------------------

  setQuality(q) {
    this.quality = q;
    const r = this.renderer, mv = this.mapView;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = q === 'low' ? Math.min(dpr, 1) * 0.8 : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 1.25);
    r.setPixelRatio(this.pixelRatio);
    const shadows = q !== 'low';
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows; mv.moon.castShadow = shadows;
      this.scene.traverse((o) => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); } });
    }
    const sm = q === 'high' ? 4096 : 2048;
    if (mv.moon.shadow.mapSize.x !== sm) { mv.moon.shadow.mapSize.set(sm, sm); if (mv.moon.shadow.map) { mv.moon.shadow.map.dispose(); mv.moon.shadow.map = null; } }
    for (const l of mv.fills) l.visible = q !== 'low';
    this.fx.rate = q === 'low' ? 0.5 : 1;
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (q !== 'low') {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 2 });
      const c = this.composer = new EffectComposer(r, rt);
      c.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), q === 'high' ? 0.5 : 0.42, 0.55, 0.92);
      c.addPass(this.bloom);
      c.addPass(new OutputPass());
    }
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.pixelRatio); this.composer.setSize(w, h); }
    this.w = w; this.h = h;
  }

  setFov(f) { this.fov = f; }

  // ----- Match life ------------------------------------------------------

  startMatch(sim, human) {
    this.endMatch();
    this.sim = sim; this.human = human; this.spectate = null;
    for (const e of sim.ents) this.addHero(e);
    if (human) this.setViewModel(human.heroId);
    this.camY = human ? human.y : 0;
    this.clearMenuHero();
  }

  endMatch() {
    for (const h of this.heroes.values()) { this.scene.remove(h.model.group); h.model.dispose(); }
    this.heroes.clear();
    this.fx.reset();
    this.sim = null; this.human = null;
    this.setViewModel(null);
  }

  addHero(e) {
    const model = buildHero(e.heroId, TEAMS[e.team].color);
    this.scene.add(model.group);
    const h = { ent: e, model, opacity: 1, wasGround: true };
    this.heroes.set(e.id, h);
    return h;
  }

  setViewModel(heroId) {
    if (this.viewModel) { this.camera.remove(this.viewModel.group); this.viewModel.dispose(); this.viewModel = null; }
    this.viewHero = heroId;
    if (!heroId) return;
    this.viewModel = buildViewModel(heroId);
    this.camera.add(this.viewModel.group);
  }

  // A hero on show for the hero select screen.
  showHero(heroId) {
    this.clearMenuHero();
    if (!heroId) return;
    this.menuHero = buildHero(heroId, TEAMS[0].color);
    this.menuHero.group.position.set(0, this.map.point.y, 8.6);
    this.scene.add(this.menuHero.group);
  }
  clearMenuHero() {
    if (this.menuHero) { this.scene.remove(this.menuHero.group); this.menuHero.dispose(); this.menuHero = null; }
  }

  muzzleOf(e, out) {
    if (e === this.firstPerson && this.viewModel) return this.viewModel.muzzle.getWorldPosition(out);
    const h = this.heroes.get(e.id);
    if (h) return h.model.muzzle.getWorldPosition(out);
    return out.set(e.x, e.y + e.hero.height * 0.7, e.z);
  }

  shake(x, y, z, amount) {
    const c = this.camera.position;
    const d = Math.hypot(c.x - x, c.y - y, c.z - z);
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount * Math.max(0, 1 - d / 22));
  }

  // World point to screen pixels. Returns false when it is behind the camera.
  project(x, y, z, out) {
    v1.set(x, y, z).project(this.camera);
    out.x = (v1.x * 0.5 + 0.5) * this.w; out.y = (-v1.y * 0.5 + 0.5) * this.h;
    return v1.z < 1 && v1.z > -1;
  }

  onEvent(ev) {
    const sim = this.sim, human = this.human;
    switch (ev.t) {
      case 'shot': case 'fire': {
        const h = this.heroes.get(ev.ent.id); if (h) h.model.kick();
        if (ev.ent === this.firstPerson && this.viewModel) this.viewModel.kick();
        break;
      }
      case 'cast': if (ev.ent === this.firstPerson && this.viewModel) this.viewModel.cast(ev.slot); break;
      case 'blink': this.addHero(ev.decoy); { const h = this.heroes.get(ev.ent.id); if (h) h.snap = true; } break;
      case 'decoyEnd': { const h = this.heroes.get(ev.ent.id); if (h) { this.scene.remove(h.model.group); h.model.dispose(); this.heroes.delete(ev.ent.id); } break; }
      case 'hero': {
        const h = this.heroes.get(ev.ent.id);
        if (h) { this.scene.remove(h.model.group); h.model.dispose(); this.heroes.delete(ev.ent.id); }
        this.addHero(ev.ent);
        if (ev.ent === human) this.setViewModel(ev.ent.heroId);
        break;
      }
      case 'spawn': { const h = this.heroes.get(ev.ent.id); if (h) h.snap = true; if (ev.ent === human) this.camY = ev.ent.y; break; }
      case 'land': if (ev.ent === this.firstPerson) this.dip = Math.min(0.22, ev.speed * 0.018); break;
      case 'damage': if (ev.target === this.firstPerson) this.shakeAmt = Math.min(1, this.shakeAmt + Math.min(0.35, ev.amount / 160)); break;
    }
    this.fx.handle(ev, sim, human);
  }

  // ----- Frame -----------------------------------------------------------

  frame(dt, alpha, look) {
    this.time += dt;
    const sim = this.sim, cam = this.camera, time = this.time;
    for (const f of this.mapView.anim) f(time, dt);

    let fp = null;
    if (sim) {
      const subject = this.human || this.spectate;
      fp = subject && subject.alive ? subject : null;
      this.firstPerson = fp;
      const now = sim.time;
      for (const h of this.heroes.values()) {
        const e = h.ent, g = h.model.group;
        const show = e.alive && e !== fp;
        g.visible = show;
        if (!e.alive) { h.snap = true; continue; }
        if (e.px === undefined || h.snap || Math.hypot(e.x - e.px, e.z - e.pz) > 2.5) { h.x = e.x; h.y = e.y; h.z = e.z; h.snap = false; }
        else { h.x = lerp(e.px, e.x, alpha); h.y = lerp(e.py, e.y, alpha); h.z = lerp(e.pz, e.z, alpha); }
        if (!show) continue;
        g.position.set(h.x, h.y, h.z);
        g.rotation.y = e.yaw;
        const st = h.state || (h.state = {});
        st.speed = Math.hypot(e.vx, e.vz); st.onGround = e.onGround; st.pitch = e.pitch;
        st.firing = e.flaming || now - e.lastShot < 0.18; st.time = time; st.ult = e.ultUntil > now;
        h.model.update(dt, st);
        let op = 1;
        if (sim.invisible(e)) op = subject && e.team === subject.team ? 0.35 : 0.04;
        else if (e.decoy && subject && e.team === subject.team) op = 0.6;
        if (op !== h.opacity) { h.opacity = op; h.model.setOpacity(op); }
      }

      // Objective ring.
      const o = sim.objective;
      if (o.locked) this.pointColor.setRGB(0.5, 0.5, 0.6); else if (o.owner >= 0) this.pointColor.set(TEAMS[o.owner].color); else this.pointColor.setRGB(1, 1, 1);
      this.pointRing.material.color.lerp(this.pointColor, Math.min(1, dt * 6));
      this.pointRing.material.opacity = o.contested ? 0.5 + 0.4 * Math.abs(Math.sin(time * 8)) : 0.85;
      const cap = Math.round(o.cap * 60) / 60;
      if (cap !== this.capShown) {
        this.capShown = cap;
        this.capRing.geometry.dispose();
        const pr = RULES.pointRadius;
        this.capRing.geometry = new THREE.RingGeometry(pr - 0.75, pr - 0.25, 96, 1, 0, Math.max(0.001, cap * Math.PI * 2)).rotateX(-Math.PI / 2);
        this.capRing.visible = cap > 0;
        if (o.capTeam >= 0) this.capRing.material.color.set(TEAMS[o.capTeam].color);
      }
      this.fireColor.set(o.owner >= 0 ? TEAMS[o.owner].color : 0xffa24a);
      this.mapView.fire.color.lerp(this.fireColor, Math.min(1, dt * 3));
      for (let i = 0; i < this.packs.length; i++) {
        const g = this.packs[i], p = sim.packs[i];
        g.visible = p.readyAt <= now;
        g.position.y = p.y + 0.8 + Math.sin(time * 2 + i) * 0.1; g.rotation.y = time * 0.9;
      }
    } else this.firstPerson = null;

    // Camera.
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    this.dip = Math.max(0, this.dip - dt * 0.9);
    let targetFov = this.fov;
    if (fp) {
      const e = fp;
      const x = e.px === undefined ? e.x : lerp(e.px, e.x, alpha), z = e.px === undefined ? e.z : lerp(e.pz, e.z, alpha);
      const y = e.px === undefined ? e.y : lerp(e.py, e.y, alpha);
      // Steps and ramps move the eye smoothly; big moves snap.
      if (Math.abs(y - this.camY) > 1.2 || !e.onGround) this.camY = y; else this.camY = lerp(this.camY, y, Math.min(1, dt * 22));
      const yaw = look ? look.yaw : e.yaw, pitch = look ? look.pitch : e.pitch;
      const s = this.shakeAmt * this.shakeAmt;
      cam.position.set(x + (Math.random() - 0.5) * s * 0.12, this.camY + e.hero.height - 0.18 - this.dip + (Math.random() - 0.5) * s * 0.12, z + (Math.random() - 0.5) * s * 0.12);
      cam.rotation.set(pitch + (Math.random() - 0.5) * s * 0.02, yaw + (Math.random() - 0.5) * s * 0.02, 0);
      this.zoom = lerp(this.zoom, e.zoom ? 1 : 0, Math.min(1, dt * 14));
      if (e.hero.weapon.zoom) targetFov = this.fov / lerp(1, e.hero.weapon.zoom, this.zoom);
      if (this.viewModel) {
        if (this.viewHero !== e.heroId) this.setViewModel(e.heroId);
        const vs = this.vmState || (this.vmState = {});
        const wpn = e.hero.weapon;
        vs.speed = Math.hypot(e.vx, e.vz); vs.onGround = e.onGround; vs.firing = e.flaming || sim.time - e.lastShot < 0.15;
        vs.time = time; vs.zoom = this.zoom; vs.reload = e.reloadT > 0 ? 1 - e.reloadT / wpn.reload : 0; vs.flaming = e.flaming;
        this.viewModel.group.visible = !sim.invisible(e) || true;
        this.viewModel.update(dt, vs);
      } else if (this.spectate) this.setViewModel(e.heroId);
      this.deathCam.copy(cam.position);
    } else if (sim && (this.human || this.spectate)) {
      // Death camera: rise and look at who stopped you.
      const e = this.human || this.spectate, k = e.killer;
      if (this.viewModel) this.viewModel.group.visible = false;
      v1.set(e.x, e.y + 4.2, e.z);
      if (k) { v2.set(e.x - k.x, 0, e.z - k.z); if (v2.lengthSq() > 0.01) v1.addScaledVector(v2.normalize(), 3.5); }
      this.deathCam.lerp(v1, Math.min(1, dt * 2.5));
      cam.position.copy(this.deathCam);
      if (k && k.alive) v2.set(k.x, k.y + 1.2, k.z); else v2.set(e.x, e.y + 0.5, e.z);
      this.deathLook.lerp(v2, Math.min(1, dt * 4));
      cam.lookAt(this.deathLook);
      this.zoom = 0;
    } else {
      // Menu camera.
      if (this.viewModel) this.viewModel.group.visible = false;
      if (this.menuHero) {
        this.menuHero.group.rotation.y = Math.PI + Math.sin(time * 0.5) * 0.6;
        const st = this.menuState || (this.menuState = { speed: 0, onGround: true, pitch: 0, firing: false, time: 0, ult: false });
        st.time = time; this.menuHero.update(dt, st);
        v1.set(-2.1, this.map.point.y + 1.7, 13.4);
        cam.position.lerp(v1, Math.min(1, dt * 3));
        v2.set(-1.3, this.map.point.y + 1.15, 8.6);
        this.deathLook.lerp(v2, Math.min(1, dt * 3));
        cam.lookAt(this.deathLook);
      } else {
        this.menuAngle += dt * 0.07;
        v1.set(Math.sin(this.menuAngle) * 25, 9 + Math.sin(this.menuAngle * 0.7) * 2.5, Math.cos(this.menuAngle) * 19);
        cam.position.lerp(v1, Math.min(1, dt * 2));
        this.deathLook.lerp(v2.set(0, 3, 0), Math.min(1, dt * 2));
        cam.lookAt(this.deathLook);
      }
    }
    if (fp && this.viewModel) this.viewModel.group.visible = true;
    if (Math.abs(cam.fov - targetFov) > 0.01) { cam.fov = lerp(cam.fov, targetFov, Math.min(1, dt * 16)); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    this.fx.setScale(this.h * this.pixelRatio / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    this.fx.frame(dt, alpha, sim, this.human, cam);
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, cam);
  }
}
