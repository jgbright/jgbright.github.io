// Procedural textures drawn on canvases. No image files.

import * as THREE from 'three';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function speckle(ctx, w, h, r, n, alpha, dark = true) {
  for (let i = 0; i < n; i++) {
    const v = dark ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    const s = 1 + r() * 3;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

// Build a normal map from a grey height canvas.
function normalFrom(height, strength) {
  const w = height.width, h = height.height;
  const src = height.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), octx = out.getContext('2d');
  const img = octx.createImageData(w, h), d = img.data;
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function tex(c, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rr(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rad);
  ctx.fill();
}

// Cobblestones for the square. Returns { map, normalMap, roughnessMap }.
export function cobble() {
  const S = 512, r = rng(11);
  const col = canvas(S, S), hgt = canvas(S, S), rough = canvas(S, S);
  const c = col.getContext('2d'), hc = hgt.getContext('2d'), rc = rough.getContext('2d');
  c.fillStyle = '#17141a'; c.fillRect(0, 0, S, S);
  hc.fillStyle = '#000'; hc.fillRect(0, 0, S, S);
  rc.fillStyle = '#d8d8d8'; rc.fillRect(0, 0, S, S);
  const rows = 8, cols = 8, cw = S / cols, ch = S / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = -1; i < cols; i++) {
      const off = (j % 2) * cw * 0.5;
      const x = i * cw + off + 3 + r() * 3, y = j * ch + 3 + r() * 3;
      const w = cw - 7 - r() * 4, h = ch - 7 - r() * 4;
      const tone = 58 + r() * 34, warm = r() * 14;
      // Stones that cross the right edge are drawn again on the left, so the tile repeats.
      const wrapX = x + w > S;
      c.fillStyle = `rgb(${tone + warm},${tone + warm * 0.4},${tone + 6})`;
      rr(c, x, y, w, h, 9);
      if (wrapX) rr(c, x - S, y, w, h, 9);
      const g = hc.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, '#fff'); g.addColorStop(0.7, '#bbb'); g.addColorStop(1, '#555');
      hc.fillStyle = g; rr(hc, x, y, w, h, 9);
      if (wrapX) { hc.save(); hc.translate(-S, 0); rr(hc, x, y, w, h, 9); hc.restore(); }
      const rv = 70 + r() * 60;
      rc.fillStyle = `rgb(${rv},${rv},${rv})`; rr(rc, x, y, w, h, 9);
      if (wrapX) rr(rc, x - S, y, w, h, 9);
    }
  }
  speckle(c, S, S, r, 5000, 0.22);
  speckle(c, S, S, r, 1500, 0.08, false);
  speckle(hc, S, S, r, 3000, 0.15);
  return { map: tex(col), normalMap: tex(normalFrom(hgt, 3.2), true, false), roughnessMap: tex(rough, true, false) };
}

// Stone blocks for the terraces and the dais.
export function stone() {
  const S = 256, r = rng(23);
  const col = canvas(S, S), hgt = canvas(S, S);
  const c = col.getContext('2d'), hc = hgt.getContext('2d');
  c.fillStyle = '#2a2630'; c.fillRect(0, 0, S, S);
  hc.fillStyle = '#222'; hc.fillRect(0, 0, S, S);
  const rows = 4, bh = S / rows;
  for (let j = 0; j < rows; j++) {
    const n = 2, bw = S / n, off = (j % 2) * bw * 0.5;
    for (let i = -1; i <= n; i++) {
      const t = 96 + r() * 30;
      c.fillStyle = `rgb(${t + 8},${t + 2},${t + 12})`;
      c.fillRect(i * bw + off + 2, j * bh + 2, bw - 4, bh - 4);
      hc.fillStyle = `rgb(${200 + r() * 40},0,0)`;
      hc.fillStyle = '#ddd';
      hc.fillRect(i * bw + off + 3, j * bh + 3, bw - 6, bh - 6);
    }
  }
  speckle(c, S, S, r, 3500, 0.25);
  speckle(hc, S, S, r, 2500, 0.3);
  return { map: tex(col), normalMap: tex(normalFrom(hgt, 2.2), true, false) };
}

// Plaster wall with timber beams. One tile is 4 m wide and 4.5 m tall.
// lit: chance that a window glows. Returns { map, emissiveMap, normalMap }.
export function facade(seed, lit = 0.6, tint = '#d9c9ae') {
  const W = 512, H = 512, r = rng(seed);
  const col = canvas(W, H), emi = canvas(W, H), hgt = canvas(W, H);
  const c = col.getContext('2d'), e = emi.getContext('2d'), hc = hgt.getContext('2d');
  c.fillStyle = tint; c.fillRect(0, 0, W, H);
  speckle(c, W, H, r, 6000, 0.12);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  hc.fillStyle = '#777'; hc.fillRect(0, 0, W, H);
  const beam = '#3b2a20';
  c.fillStyle = beam; hc.fillStyle = '#aaa';
  for (const ctx of [c, hc]) {
    ctx.fillRect(0, 0, W, 18); ctx.fillRect(0, H / 2 - 9, W, 18); ctx.fillRect(0, H - 18, W, 18);
    for (let i = 0; i <= 2; i++) ctx.fillRect((i * W) / 2 - 9, 0, 18, H);
  }
  c.strokeStyle = beam; c.lineWidth = 12;
  c.beginPath(); c.moveTo(12, H / 2 + 12); c.lineTo(W / 2 - 12, H - 16); c.moveTo(W - 12, H / 2 + 12); c.lineTo(W / 2 + 12, H - 16); c.stroke();
  // Two windows in the upper half.
  for (let i = 0; i < 2; i++) {
    const x = i * (W / 2) + 70, y = 60, w = W / 2 - 140, h = 150;
    const on = r() < lit;
    c.fillStyle = '#2b2118'; c.fillRect(x - 8, y - 8, w + 16, h + 16);
    const glow = ['#ffcf7a', '#ffb65c', '#ffe1a6'][Math.floor(r() * 3)];
    c.fillStyle = on ? glow : '#1a2030'; c.fillRect(x, y, w, h);
    if (on) { e.fillStyle = glow; e.fillRect(x, y, w, h); }
    c.fillStyle = '#2b2118'; e.fillStyle = '#000';
    for (const ctx of [c, e]) { ctx.fillRect(x + w / 2 - 3, y, 6, h); ctx.fillRect(x, y + h / 2 - 3, w, 6); }
    hc.fillStyle = '#333'; hc.fillRect(x, y, w, h);
  }
  return { map: tex(col), emissiveMap: tex(emi), normalMap: tex(normalFrom(hgt, 1.6), true, false) };
}

export function wood(seed = 5, base = [96, 62, 38]) {
  const S = 256, r = rng(seed);
  const col = canvas(S, S), hgt = canvas(S, S);
  const c = col.getContext('2d'), hc = hgt.getContext('2d');
  hc.fillStyle = '#999'; hc.fillRect(0, 0, S, S);
  const n = 4, pw = S / n;
  for (let i = 0; i < n; i++) {
    const k = 0.8 + r() * 0.4;
    c.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
    c.fillRect(i * pw, 0, pw, S);
    for (let g = 0; g < 26; g++) {
      c.strokeStyle = `rgba(30,15,5,${0.08 + r() * 0.15})`; c.lineWidth = 1 + r();
      const x = i * pw + r() * pw;
      c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + r() * 8 - 4, S / 3, x + r() * 8 - 4, (S * 2) / 3, x + r() * 6 - 3, S); c.stroke();
    }
    hc.fillStyle = '#222'; hc.fillRect(i * pw, 0, 3, S);
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(i * pw, 0, 3, S);
  }
  return { map: tex(col), normalMap: tex(normalFrom(hgt, 1.5), true, false) };
}

// A rangoli: a bright round pattern, used on the dais and for Meenal's ability.
export function rangoli(colors = ['#ff3d7f', '#ffb300', '#00c2a8', '#ffffff', '#7c4dff'], seed = 3) {
  const S = 512, c0 = canvas(S, S), c = c0.getContext('2d'), r = rng(seed);
  c.translate(S / 2, S / 2);
  const petals = 12;
  for (let ring = 5; ring >= 1; ring--) {
    const rad = (S / 2 - 8) * (ring / 5);
    c.fillStyle = colors[ring % colors.length];
    for (let i = 0; i < petals; i++) {
      c.save(); c.rotate((i / petals) * Math.PI * 2 + (ring % 2) * (Math.PI / petals));
      c.beginPath(); c.moveTo(0, -rad * 0.45);
      c.quadraticCurveTo(rad * 0.22, -rad * 0.8, 0, -rad);
      c.quadraticCurveTo(-rad * 0.22, -rad * 0.8, 0, -rad * 0.45);
      c.fill(); c.restore();
    }
    c.strokeStyle = colors[(ring + 2) % colors.length]; c.lineWidth = 5;
    c.beginPath(); c.arc(0, 0, rad * 0.47, 0, Math.PI * 2); c.stroke();
  }
  c.fillStyle = '#fff';
  for (let i = 0; i < 60; i++) { const a = r() * 6.283, d = r() * (S / 2 - 12); c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, 2.2, 0, 6.283); c.fill(); }
  return tex(c0, false);
}

// Soft round sprite for particles.
export function glow() {
  const S = 64, c0 = canvas(S, S), c = c0.getContext('2d');
  const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  return tex(c0, false);
}

// Cut-paper flags (papel picado) with holes, for the banner strings.
export function paperFlag() {
  const S = 128, c0 = canvas(S, S), c = c0.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, S, S * 0.86);
  for (let i = 0; i < 8; i++) { c.beginPath(); c.arc(8 + i * 16, S * 0.86, 8, 0, Math.PI); c.fill(); }
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.arc(S / 2, S * 0.42, 20, 0, 6.283); c.fill();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; c.beginPath(); c.ellipse(S / 2 + Math.cos(a) * 36, S * 0.42 + Math.sin(a) * 36, 7, 12, a, 0, 6.283); c.fill(); }
  for (let i = 0; i < 6; i++) { c.fillRect(10 + i * 20, 6, 8, 8); }
  return tex(c0, false);
}

// Ward pattern for Marta's Evergreen Ward: a holly and bough lattice.
export function wardPattern() {
  const S = 256, c0 = canvas(S, S), c = c0.getContext('2d');
  c.clearRect(0, 0, S, S);
  c.strokeStyle = 'rgba(190,255,200,0.9)'; c.lineWidth = 3;
  for (let i = -1; i < 5; i++) {
    c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64 + 128, S); c.stroke();
    c.beginPath(); c.moveTo(i * 64 + 128, 0); c.lineTo(i * 64, S); c.stroke();
  }
  c.fillStyle = 'rgba(255,90,90,0.95)';
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(i * 64 + (j % 2) * 32, j * 64 + 32, 5, 0, 6.283); c.fill(); }
  return tex(c0, true);
}
