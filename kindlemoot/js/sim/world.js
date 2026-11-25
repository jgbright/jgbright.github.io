// Static world: collision, ray casts and the navigation grid.
// Plain JavaScript with no DOM and no renderer, so it runs the same in the
// browser and in Node.

const EPS = 1e-6;

export class World {
  constructor(map, rules) {
    this.map = map;
    this.step = rules.stepHeight;
    this.solids = map.solids.map((s) => {
      const o = { ...s };
      if (o.ramp) {
        o.axis = o.ramp[0];
        o.dir = o.ramp[1] === '+' ? 1 : -1;
        o.len = o.axis === 'x' ? o.x1 - o.x0 : o.z1 - o.z0;
        o.k = (o.y1 - o.y0) / o.len;
      }
      return o;
    });
    this.gates = map.gates;
    this.nav = null;
  }

  // Top surface of a solid at a point inside its footprint.
  topAt(s, x, z) {
    if (!s.ramp) return s.y1;
    let t;
    if (s.axis === 'x') t = (x - s.x0) / s.len; else t = (z - s.z0) / s.len;
    if (s.dir < 0) t = 1 - t;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return s.y0 + (s.y1 - s.y0) * t;
  }

  // Highest floor at (x,z) that a hero whose feet are at feetY can stand on.
  groundAt(x, z, feetY) {
    let g = 0;
    const lim = feetY + this.step + EPS;
    const ss = this.solids;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const top = this.topAt(s, x, z);
      if (top <= lim && top > g) g = top;
    }
    return g;
  }

  // Lowest ceiling above the head at (x,z), or Infinity.
  ceilingAt(x, z, headY) {
    let c = Infinity;
    const ss = this.solids;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (s.y0 <= 0 || x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      if (s.y0 >= headY - 0.3 && s.y0 < c) c = s.y0;
    }
    return c;
  }

  // Push a standing cylinder out of walls. Changes p.x and p.z. Returns true on contact.
  resolve(p, feetY, r, h, team) {
    let hit = false;
    const lo = feetY + this.step + EPS, hi = feetY + h;
    const ss = this.solids;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < ss.length; i++) {
        const s = ss[i];
        if (p.x < s.x0 - r || p.x > s.x1 + r || p.z < s.z0 - r || p.z > s.z1 + r) continue;
        if (s.y0 >= hi) continue;
        const cx = p.x < s.x0 ? s.x0 : p.x > s.x1 ? s.x1 : p.x;
        const cz = p.z < s.z0 ? s.z0 : p.z > s.z1 ? s.z1 : p.z;
        const top = this.topAt(s, cx, cz);
        if (top <= lo) continue;
        if (this._push(p, s, cx, cz, r)) hit = true;
      }
      if (team !== undefined) {
        const gs = this.gates;
        for (let i = 0; i < gs.length; i++) {
          const s = gs[i];
          if (s.team === team) continue;
          if (p.x < s.x0 - r || p.x > s.x1 + r || p.z < s.z0 - r || p.z > s.z1 + r) continue;
          if (s.y0 >= hi || s.y1 <= lo) continue;
          const cx = p.x < s.x0 ? s.x0 : p.x > s.x1 ? s.x1 : p.x;
          const cz = p.z < s.z0 ? s.z0 : p.z > s.z1 ? s.z1 : p.z;
          if (this._push(p, s, cx, cz, r)) hit = true;
        }
      }
      if (!hit) break;
    }
    return hit;
  }

  _push(p, s, cx, cz, r) {
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) return false;
    if (d2 > EPS) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r;
      p.z = cz + (dz / d) * r;
    } else {
      // Centre is inside the box: leave through the nearest side.
      const l = p.x - s.x0, rr = s.x1 - p.x, n = p.z - s.z0, f = s.z1 - p.z;
      const m = Math.min(l, rr, n, f);
      if (m === l) p.x = s.x0 - r; else if (m === rr) p.x = s.x1 + r;
      else if (m === n) p.z = s.z0 - r; else p.z = s.z1 + r;
    }
    return true;
  }

  // True when a cylinder at this place touches a wall.
  blocked(x, z, feetY, r, h) {
    const lo = feetY + this.step + EPS, hi = feetY + h;
    const ss = this.solids;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (x < s.x0 - r || x > s.x1 + r || z < s.z0 - r || z > s.z1 + r) continue;
      if (s.y0 >= hi) continue;
      const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x;
      const cz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
      if (this.topAt(s, cx, cz) <= lo) continue;
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  // Ray against the static world. Returns the distance to the first hit, or
  // maxT when nothing is hit. team: gates of other teams also block.
  raycast(ox, oy, oz, dx, dy, dz, maxT, team) {
    let best = maxT;
    // The ground plane.
    if (dy < -EPS) {
      const t = -oy / dy;
      if (t >= 0 && t < best) best = t;
    }
    const ss = this.solids;
    for (let i = 0; i < ss.length; i++) {
      const t = rayBox(ss[i], ox, oy, oz, dx, dy, dz, best);
      if (t < best) best = t;
    }
    if (team !== undefined) {
      const gs = this.gates;
      for (let i = 0; i < gs.length; i++) {
        if (gs[i].team === team) continue;
        const t = rayBox(gs[i], ox, oy, oz, dx, dy, dz, best);
        if (t < best) best = t;
      }
    }
    return best;
  }

  // Line of sight between two points.
  los(ax, ay, az, bx, by, bz, team) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < EPS) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, team) >= d - 0.05;
  }

  // Walk in a straight line from a to b on the ground. Returns the end height,
  // or NaN when a wall is in the way.
  walk(ax, ay, az, bx, bz, r, h) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(1, Math.ceil(d / 0.3));
    let y = ay;
    for (let i = 1; i <= n; i++) {
      const x = ax + (dx * i) / n, z = az + (dz * i) / n;
      if (this.blocked(x, z, y, r, h)) return NaN;
      y = this.groundAt(x, z, y);
    }
    return y;
  }

  // ----- Navigation grid -------------------------------------------------

  buildNav(cell = 1.5, r = 0.66, h = 2.1) {
    const b = this.map.bounds;
    const nx = Math.floor((b.x1 - b.x0) / cell) + 1, nz = Math.floor((b.z1 - b.z0) / cell) + 1;
    const nodes = [];
    const grid = new Array(nx * nz);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = b.x0 + i * cell, z = b.z0 + j * cell;
        const hs = [0];
        for (const s of this.solids) {
          if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
          const top = this.topAt(s, x, z);
          if (top < 7) hs.push(top);
        }
        hs.sort((p, q) => p - q);
        const list = [];
        let last = -99;
        for (const y of hs) {
          if (y - last < 0.3) continue;
          if (Math.abs(this.groundAt(x, z, y - this.step + 0.01) - y) > 0.01) continue;
          if (this.blocked(x, z, y, r, h)) continue;
          if (this.ceilingAt(x, z, y + h) < y + h) continue;
          last = y;
          const node = { id: nodes.length, x, y, z, i, j, links: [], costs: [], room: -1 };
          for (const room of this.map.spawnRooms) {
            if (x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1) node.room = room.team;
          }
          nodes.push(node);
          list.push(node);
        }
        grid[i * nz + j] = list;
      }
    }
    for (const a of nodes) {
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          if (!di && !dj) continue;
          const i = a.i + di, j = a.j + dj;
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          for (const bn of grid[i * nz + j]) {
            const dy = bn.y - a.y;
            if (dy > 1.0 || dy < -4.5) continue;
            const end = this.walk(a.x, a.y, a.z, bn.x, bn.z, r, h);
            if (!(Math.abs(end - bn.y) < 0.2)) continue;
            const flat = Math.hypot(bn.x - a.x, bn.z - a.z);
            a.links.push(bn.id);
            a.costs.push(flat + (dy < -1 ? 2 : 0));
          }
        }
      }
    }
    // Keep only nodes that can reach the centre of the map (drop sealed pockets).
    const centre = nearest(nodes, 0, 0, this.map.point.y);
    const rev = nodes.map(() => []);
    for (const a of nodes) for (const id of a.links) rev[id].push(a.id);
    const seen = new Uint8Array(nodes.length);
    const stack = [centre.id];
    seen[centre.id] = 1;
    while (stack.length) {
      const id = stack.pop();
      for (const p of rev[id]) if (!seen[p]) { seen[p] = 1; stack.push(p); }
    }
    for (const n of nodes) n.dead = !seen[n.id];
    this.nav = { nodes, grid, nx, nz, cell, r, h };
    return this.nav;
  }

  nearestNode(x, y, z) {
    const nav = this.nav, b = this.map.bounds;
    const ci = Math.round((x - b.x0) / nav.cell), cj = Math.round((z - b.z0) / nav.cell);
    let best = null, bd = Infinity;
    for (let ring = 0; ring <= 4 && !best; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) {
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (i < 0 || j < 0 || i >= nav.nx || j >= nav.nz) continue;
          for (const n of nav.grid[i * nav.nz + j]) {
            if (n.dead) continue;
            const dy = n.y - y;
            const d = (n.x - x) ** 2 + (n.z - z) ** 2 + dy * dy * 4;
            if (d < bd) { bd = d; best = n; }
          }
        }
      }
    }
    return best || nearest(nav.nodes, x, z, y);
  }

  // A* over the grid. Returns a list of {x,y,z}, without the start node.
  findPath(sx, sy, sz, tx, ty, tz, team) {
    const nav = this.nav;
    const start = this.nearestNode(sx, sy, sz), goal = this.nearestNode(tx, ty, tz);
    if (!start || !goal) return [];
    if (start === goal) return [{ x: tx, y: goal.y, z: tz }];
    const N = nav.nodes.length;
    if (!this._g) {
      this._g = new Float32Array(N); this._f = new Float32Array(N);
      this._from = new Int32Array(N); this._mark = new Int32Array(N); this._stamp = 0;
    }
    const g = this._g, f = this._f, from = this._from, mark = this._mark;
    const stamp = ++this._stamp;
    const heap = [];
    const push = (id) => {
      heap.push(id);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (f[heap[p]] <= f[heap[c]]) break;
        const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let p = 0;
        for (;;) {
          let l = p * 2 + 1, r = l + 1, m = p;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === p) break;
          const t = heap[p]; heap[p] = heap[m]; heap[m] = t; p = m;
        }
      }
      return top;
    };
    g[start.id] = 0; f[start.id] = 0; from[start.id] = -1; mark[start.id] = stamp;
    push(start.id);
    let found = false;
    while (heap.length) {
      const id = pop();
      if (id === goal.id) { found = true; break; }
      const n = nav.nodes[id];
      const gi = g[id];
      for (let k = 0; k < n.links.length; k++) {
        const to = n.links[k];
        const m = nav.nodes[to];
        if (m.room >= 0 && m.room !== team && team !== undefined) continue;
        const ng = gi + n.costs[k];
        if (mark[to] === stamp && ng >= g[to]) continue;
        g[to] = ng; from[to] = id; mark[to] = stamp;
        f[to] = ng + Math.hypot(m.x - goal.x, m.z - goal.z) + Math.abs(m.y - goal.y);
        push(to);
      }
    }
    if (!found) return [];
    const path = [];
    for (let id = goal.id; id !== start.id && id >= 0; id = from[id]) {
      const n = nav.nodes[id];
      path.push({ x: n.x, y: n.y, z: n.z });
    }
    path.reverse();
    if (path.length) { const l = path[path.length - 1]; if (Math.hypot(l.x - tx, l.z - tz) < nav.cell) { l.x = tx; l.z = tz; } }
    return path;
  }
}

function nearest(nodes, x, z, y) {
  let best = null, bd = Infinity;
  for (const n of nodes) {
    if (n.dead) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2 + (n.y - y) ** 2 * 4;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// Ray against an axis-aligned box or ramp (a box cut by its sloped top).
// Returns the entry distance, or best when there is no closer hit.
export function rayBox(s, ox, oy, oz, dx, dy, dz, best) {
  let t0 = 0, t1 = best;
  if (Math.abs(dx) < EPS) { if (ox < s.x0 || ox > s.x1) return best; }
  else {
    let a = (s.x0 - ox) / dx, b = (s.x1 - ox) / dx;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return best;
  }
  if (Math.abs(dy) < EPS) { if (oy < s.y0 || oy > s.y1) return best; }
  else {
    let a = (s.y0 - oy) / dy, b = (s.y1 - oy) / dy;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return best;
  }
  if (Math.abs(dz) < EPS) { if (oz < s.z0 || oz > s.z1) return best; }
  else {
    let a = (s.z0 - oz) / dz, b = (s.z1 - oz) / dz;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return best;
  }
  if (s.ramp) {
    // Keep only the part under the slope: y <= y0 + k * u, u measured from the low end.
    let f0, fd;
    if (s.axis === 'x') {
      if (s.dir > 0) { f0 = oy - s.y0 - s.k * (ox - s.x0); fd = dy - s.k * dx; }
      else { f0 = oy - s.y0 - s.k * (s.x1 - ox); fd = dy + s.k * dx; }
    } else {
      if (s.dir > 0) { f0 = oy - s.y0 - s.k * (oz - s.z0); fd = dy - s.k * dz; }
      else { f0 = oy - s.y0 - s.k * (s.z1 - oz); fd = dy + s.k * dz; }
    }
    if (Math.abs(fd) < EPS) { if (f0 > 0) return best; }
    else {
      const t = -f0 / fd;
      if (fd > 0) { if (t < t1) t1 = t; } else if (t > t0) t0 = t;
      if (t0 > t1) return best;
    }
  }
  return t0;
}
