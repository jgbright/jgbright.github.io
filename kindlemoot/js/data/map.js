// Almanac Square: the one map of Kindlemoot.
// The map is data. The simulation collides with it and the renderer builds
// meshes from it. Everything is mirrored through the centre (x,z) -> (-x,-z),
// so both troupes get the same ground.

const solids = [];
const gates = [];
const decor = [];

// A box from its centre on the ground. mat is a material name for the renderer.
function box(cx, cz, sx, sz, h, mat = 'stone', y0 = 0, extra = {}) {
  const s = { x0: cx - sx / 2, x1: cx + sx / 2, y0, y1: y0 + h, z0: cz - sz / 2, z1: cz + sz / 2, mat, ...extra };
  solids.push(s);
  return s;
}
function mirror(s) {
  const m = { ...s, x0: -s.x1, x1: -s.x0, z0: -s.z1, z1: -s.z0 };
  if (s.ramp) m.ramp = s.ramp[0] + (s.ramp[1] === '+' ? '-' : '+');
  return m;
}
function both(cx, cz, sx, sz, h, mat, y0, extra) {
  const s = box(cx, cz, sx, sz, h, mat, y0, extra);
  solids.push(mirror(s));
}

export const BOUNDS = { x0: -57, x1: 57, z0: -27, z1: 27 };
const WALL_H = 9;

// Outer walls.
box(0, -26.5, 114, 1, WALL_H, 'facade');
box(0, 26.5, 114, 1, WALL_H, 'facade');
both(-56.5, 0, 1, 54, WALL_H, 'facade');

// Spawn house: x -56..-44, z -9..9. Front door and two side doors.
both(-44, -6.5, 1, 5, 5, 'plaster');           // front wall, low z part
both(-44, 6.5, 1, 5, 5, 'plaster');            // front wall, high z part
both(-44, 0, 1, 8, 1.6, 'timber', 3.4);        // lintel over the front door
both(-53.5, -9, 5, 1, 5, 'plaster');           // side wall z=-9, back part
both(-45, -9, 2, 1, 5, 'plaster');             // side wall z=-9, front part
both(-48.5, -9, 5, 1, 1.6, 'timber', 3.4);     // lintel over the side door
both(-53.5, 9, 5, 1, 5, 'plaster');
both(-45, 9, 2, 1, 5, 'plaster');
both(-48.5, 9, 5, 1, 1.6, 'timber', 3.4);

// Team gates: only the home troupe can pass or shoot through.
function gate(cx, cz, sx, sz, team) {
  gates.push({ x0: cx - sx / 2, x1: cx + sx / 2, y0: 0, y1: 3.4, z0: cz - sz / 2, z1: cz + sz / 2, team });
  gates.push({ x0: -cx - sx / 2, x1: -cx + sx / 2, y0: 0, y1: 3.4, z0: -cz - sz / 2, z1: -cz + sz / 2, team: 1 - team });
}
gate(-44, 0, 1, 8, 0);
gate(-48.5, -9, 5, 1, 0);
gate(-48.5, 9, 5, 1, 0);

// Yard cover between the spawn house and the arch wall.
both(-34, -5, 3, 2, 2.2, 'cart');
both(-33, 9, 2, 4, 2.4, 'crate');
both(-30, -16, 2.5, 2.5, 2.4, 'crate');

// Arch wall at x = -22 with three ways through.
both(-22, -24.5, 2, 3, WALL_H, 'plaster');      // z -26..-23
both(-22, -10.75, 2, 12.5, WALL_H, 'plaster');  // z -17..-4.5
both(-22, 11.75, 2, 14.5, WALL_H, 'plaster');   // z 4.5..19
both(-22, -20, 2, 6, WALL_H - 4, 'timber', 4);  // lintel over the low way
both(-22, 0, 2, 9, WALL_H - 5, 'timber', 5);    // lintel over the main arch

// High way: a ramp in the yard, a landing, then the terrace over the square.
const T_H = 3.2;
both(-33.5, 22.5, 11, 7, T_H, 'stone', 0, { ramp: 'x+' }); // x -39..-28, rises to +x
both(-19, 22.5, 18, 7, T_H, 'stone');                      // landing and back of terrace, x -28..-10, z 19..26
both(-15.5, 16, 11, 6, T_H, 'stone');                      // front of terrace, x -21..-10, z 13..19
both(-6, 23.5, 8, 5, T_H, 'stone', 0, { ramp: 'x-' });     // ramp down to the square, x -10..-2
both(-14, 15.5, 1.6, 1.6, 1.3, 'crate', T_H);              // cover on the terrace
both(-23.5, 24.8, 1.4, 1.4, 1.3, 'crate', T_H);

// The square. The Year-Fire stands on a low dais in the middle.
box(0, 0, 15, 15, 0.3, 'dais');
box(0, 0, 2.6, 2.6, 2.3, 'brazier', 0.3);

both(-13, 3.5, 2.5, 4, 2.4, 'cart');
both(-5, -13.5, 5, 2.2, 2.7, 'stall');
both(-12.5, -17, 2.2, 5, 2.7, 'stall');
both(-16, -7, 1, 1, 4.5, 'post');
both(9.5, -6.5, 1.8, 1.8, 1.4, 'crate');
both(-2, 16.5, 3, 1.6, 2.2, 'cart');

// Feast plates (health packs).
export const PACKS = [
  { x: -27, z: -22 }, { x: 27, z: 22 },
  { x: 0, z: -22 }, { x: 0, z: 22 },
];

// Where each troupe appears. Team 0 looks toward +x.
export const SPAWNS = [[], []];
for (let i = 0; i < 6; i++) {
  const x = -50.5 + (i % 2) * 3, z = -2.6 + Math.floor(i / 2) * 2.6; // in line with the front door
  SPAWNS[0].push({ x, z, yaw: -Math.PI / 2 });
  SPAWNS[1].push({ x: -x, z: -z, yaw: Math.PI / 2 });
}
export const SPAWN_ROOMS = [
  { x0: -56, x1: -44, z0: -9, z1: 9, team: 0 },
  { x0: 44, x1: 56, z0: -9, z1: 9, team: 1 },
];

// Places where a troupe waits to group up before it walks in.
export const STAGING = [
  [{ x: -29, z: 0 }, { x: -29, z: -19 }, { x: -25, z: 22 }],
  [{ x: 29, z: 0 }, { x: 29, z: 19 }, { x: 25, z: -22 }],
];

// Good long-range spots (the terraces), used by bots with long weapons.
export const PERCHES = [
  [{ x: -12.5, z: 14.5, y: T_H }, { x: -17, z: 2 }, { x: -18, z: -20 }],
  [{ x: 12.5, z: -14.5, y: T_H }, { x: 17, z: -2 }, { x: 18, z: 20 }],
];

export const POINT = { x: 0, z: 0, y: 0.3 };

export const MAP = {
  name: 'Almanac Square',
  bounds: BOUNDS,
  solids,
  gates,
  decor,
  packs: PACKS,
  spawns: SPAWNS,
  spawnRooms: SPAWN_ROOMS,
  staging: STAGING,
  perches: PERCHES,
  point: POINT,
  terraceHeight: T_H,
};
