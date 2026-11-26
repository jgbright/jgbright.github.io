// Aim telemetry: a fixed ring buffer of mouse-look events, for finding aim bugs.
// It records each mouse move (raw deltas, sensitivity, the radians for each count,
// pitch before and after, and flags for clamps and rejected moves), each reset of
// the view, and each pointer-lock change. It allocates nothing for each event.
//
// In the browser console:
//   __km.aim.summary()        counts, the biggest deltas, and the lock mode
//   copy(__km.aim.text())     the whole log as tab-separated text, to paste
//   __km.aim.dump(50)         the last 50 rows as objects
//   __km.aim.clear()
// ?aimlog in the address also prints clamps, rejects, resets and lock changes
// to the console as they happen.

export const KIND = { move: 1, reset: 2, lock: 3, unlock: 4, lockError: 5 };
const KIND_NAME = ['', 'move', 'reset', 'lock', 'unlock', 'lockError'];

export const FLAG = {
  clampUp: 1, clampDown: 2, // pitch hit the top or bottom limit
  spike: 4,                 // move dropped: one sudden jump, much larger than the moves before it
  notFinite: 8,             // move dropped: a delta or the factor was not a number
  zoom: 16, invertY: 32,
  locked: 64,               // the pointer was locked to the canvas
  raw: 128,                 // the lock asked for raw input (no OS acceleration)
  drag: 256,                // a ?nolock drag, not a pointer-lock move
};
const FLAG_NAMES = Object.keys(FLAG);

const SIZE = 4096;

export class AimLog {
  constructor(live) {
    this.live = !!live;
    this.t = new Float64Array(SIZE);
    this.kind = new Uint8Array(SIZE);
    this.flags = new Uint16Array(SIZE);
    this.dx = new Float32Array(SIZE);
    this.dy = new Float32Array(SIZE);
    this.sens = new Float32Array(SIZE);
    this.k = new Float32Array(SIZE);
    this.pitch0 = new Float32Array(SIZE);
    this.pitch1 = new Float32Array(SIZE);
    this.yaw1 = new Float32Array(SIZE);
    this.reason = new Array(SIZE).fill('');
    this.clear();
  }

  clear() {
    this.n = 0; // rows written since the last clear; the buffer keeps the last SIZE
    this.counts = { move: 0, reset: 0, lock: 0, unlock: 0, lockError: 0, clamp: 0, spike: 0, notFinite: 0 };
    this.maxAbsDx = 0; this.maxAbsDy = 0;
  }

  add(kind, flags, dx, dy, sens, k, pitch0, pitch1, yaw1, reason) {
    const i = this.n % SIZE;
    this.t[i] = performance.now(); this.kind[i] = kind; this.flags[i] = flags;
    this.dx[i] = dx; this.dy[i] = dy; this.sens[i] = sens; this.k[i] = k;
    this.pitch0[i] = pitch0; this.pitch1[i] = pitch1; this.yaw1[i] = yaw1;
    this.reason[i] = reason || '';
    this.n++;
    const c = this.counts;
    c[KIND_NAME[kind]]++;
    if (flags & (FLAG.clampUp | FLAG.clampDown)) c.clamp++;
    if (flags & FLAG.spike) c.spike++;
    if (flags & FLAG.notFinite) c.notFinite++;
    if (kind === KIND.move && Number.isFinite(dx) && Number.isFinite(dy)) {
      if (Math.abs(dx) > this.maxAbsDx) this.maxAbsDx = Math.abs(dx);
      if (Math.abs(dy) > this.maxAbsDy) this.maxAbsDy = Math.abs(dy);
    }
    if (this.live && (kind !== KIND.move || (flags & (FLAG.clampUp | FLAG.clampDown | FLAG.spike | FLAG.notFinite)))) {
      console.info('[aim]', this.row(i));
    }
  }

  row(i) {
    const f = this.flags[i];
    return {
      t: Math.round(this.t[i] * 10) / 10, kind: KIND_NAME[this.kind[i]],
      dx: this.dx[i], dy: this.dy[i], sens: +this.sens[i].toFixed(3), k: +this.k[i].toPrecision(4),
      pitchBefore: +this.pitch0[i].toFixed(4), pitchAfter: +this.pitch1[i].toFixed(4), yawAfter: +this.yaw1[i].toFixed(4),
      flags: FLAG_NAMES.filter((name) => f & FLAG[name]).join(' '), reason: this.reason[i],
    };
  }

  // The last `count` rows, oldest first.
  dump(count = SIZE) {
    const have = Math.min(this.n, SIZE), take = Math.min(have, count), out = [];
    for (let j = this.n - take; j < this.n; j++) out.push(this.row(j % SIZE));
    return out;
  }

  text(count) {
    const rows = this.dump(count);
    const cols = ['t', 'kind', 'dx', 'dy', 'sens', 'k', 'pitchBefore', 'pitchAfter', 'yawAfter', 'flags', 'reason'];
    return [cols.join('\t'), ...rows.map((r) => cols.map((c) => r[c]).join('\t'))].join('\n');
  }

  summary(extra) {
    return { rows: this.n, kept: Math.min(this.n, SIZE), ...this.counts, maxAbsDx: this.maxAbsDx, maxAbsDy: this.maxAbsDy, ...extra };
  }
}
