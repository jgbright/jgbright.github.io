// Balance runner: many bot-versus-bot matches at full speed, on all CPU cores.
// It steps the same simulation code that the browser runs. No build is needed.
//
//   node kindlemoot/tools/balance.mjs                 all suites, 240 matches each
//   node kindlemoot/tools/balance.mjs --n 400         more matches for each suite
//   node kindlemoot/tools/balance.mjs --suite mixed   one suite: mirror | mixed | swap | roles | skill
//   node kindlemoot/tools/balance.mjs --skill hard    bot skill for both troupes (easy | normal | hard)
//   node kindlemoot/tools/balance.mjs --json out.json also write the numbers to a file
//
// Suites:
//   mirror  both troupes have one of each hero. Checks that the two sides of the map are fair.
//   mixed   random troupes (each role present, at most two of a hero). Gives a win rate for each hero.
//   swap    one of each hero, but one hero is replaced by a second copy of another. Shows who is too strong.
//   roles   troupes with odd role mixes against a 2-2-2 troupe. Shows that the mix matters.
//   skill   easy and hard bots against normal bots.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { Sim, makeRng } from '../js/sim/sim.js';
import { MAP } from '../js/data/map.js';
import { HEROES, HERO_IDS, RULES } from '../js/data/heroes.js';

function runMatch(job) {
  const sim = new Sim({ seed: job.seed, map: MAP, teams: [{ heroes: job.teams[0], skill: job.skill[0] }, { heroes: job.teams[1], skill: job.skill[1] }], human: null });
  const maxTicks = (RULES.matchTime + 60) * RULES.tickRate;
  let firstCap = -1;
  while (!sim.over && sim.tick < maxTicks) {
    sim.step();
    if (firstCap < 0) for (const ev of sim.events) if (ev.t === 'point' && ev.kind === 'captured') firstCap = ev.team;
    sim.events.length = 0;
  }
  let bad = sim.over ? 0 : 1;
  const ents = sim.ents.filter((e) => !e.decoy).map((e) => {
    if (!Number.isFinite(e.x + e.y + e.z + e.hp)) bad++;
    const s = e.stats;
    return { hero: e.heroId, team: e.team, k: s.kills, d: s.deaths, a: s.assists, dmg: s.damage, heal: s.healing, ults: s.ults, c0: s.casts[0], c1: s.casts[1], shots: s.shots, hits: s.hits, point: s.pointTime, tele: e.bot.teleports, retreats: e.bot.retreats, groups: e.bot.groups, packs: s.packs };
  });
  return { id: job.id, tag: job.tag, teams: job.teams, winner: sim.winner, time: sim.time, score: sim.objective.score.slice(), firstCap, ents, bad };
}

if (!isMainThread) {
  parentPort.on('message', (job) => parentPort.postMessage(runMatch(job)));
} else {
  const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; };
  const N = +arg('n', 240), SKILL = arg('skill', 'normal'), SUITE = arg('suite', 'all'), JSON_OUT = arg('json', null);
  const rng = makeRng(+arg('seed', 12345));
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const byRole = (role) => HERO_IDS.filter((id) => HEROES[id].role === role);
  const STD = HERO_IDS.slice();
  function mixedTeam() {
    for (;;) {
      const t = [];
      while (t.length < 6) { const id = pick(HERO_IDS); if (t.filter((x) => x === id).length < 2) t.push(id); }
      if (new Set(t.map((id) => HEROES[id].role)).size === 3) return t;
    }
  }
  function roleTeam(nTank, nDamage, nSupport) {
    const t = [];
    const add = (role, n) => { const ids = byRole(role); for (let i = 0; i < n; i++) t.push(ids[i % ids.length]); };
    add('tank', nTank); add('damage', nDamage); add('support', nSupport);
    return t;
  }

  const jobs = [];
  let seed = 1;
  const add = (tag, a, b, skill = [SKILL, SKILL]) => jobs.push({ id: jobs.length, tag, seed: seed++ * 7919 + 13, teams: [a, b], skill });
  const want = (s) => SUITE === 'all' || SUITE === s;
  if (want('mirror')) for (let i = 0; i < N; i++) add('mirror', STD, STD);
  if (want('mixed')) for (let i = 0; i < N * 2; i++) add('mixed', mixedTeam(), mixedTeam());
  if (want('swap')) {
    // Replace hero "out" with a second copy of hero "in" (same role keeps the test clean). Sides alternate.
    const per = Math.max(20, Math.round(N / 3));
    for (const inId of HERO_IDS) {
      const outId = byRole(HEROES[inId].role).find((id) => id !== inId);
      const t = STD.map((id) => (id === outId ? inId : id));
      for (let i = 0; i < per; i++) (i % 2 ? add(`swap:${inId}`, STD, t) : add(`swap:${inId}`, t, STD));
    }
  }
  if (want('roles')) {
    const per = Math.max(20, Math.round(N / 3));
    for (const [name, mix] of [['3 tank 3 damage 0 support', [3, 3, 0]], ['0 tank 4 damage 2 support', [0, 4, 2]], ['2 tank 0 damage 4 support', [2, 0, 4]], ['4 tank 0 damage 2 support', [4, 0, 2]], ['1 tank 4 damage 1 support', [1, 4, 1]], ['3 tank 1 damage 2 support', [3, 1, 2]], ['2 tank 3 damage 1 support', [2, 3, 1]], ['1 tank 2 damage 3 support', [1, 2, 3]]]) {
      const t = roleTeam(...mix);
      for (let i = 0; i < per; i++) (i % 2 ? add(`roles:${name}`, STD, t) : add(`roles:${name}`, t, STD));
    }
  }
  if (want('skill')) {
    const per = Math.max(20, Math.round(N / 3));
    for (const s of ['easy', 'hard']) for (let i = 0; i < per; i++) (i % 2 ? add(`skill:${s}`, STD, STD, ['normal', s]) : add(`skill:${s}`, STD, STD, [s, 'normal']));
  }

  const threads = Math.max(1, Math.min(os.availableParallelism() - 1, jobs.length, +arg('threads', 99)));
  console.log(`${jobs.length} matches on ${threads} threads, bot skill ${SKILL}`);
  const t0 = Date.now();
  const results = new Array(jobs.length);
  let next = 0, done = 0;
  await new Promise((resolve) => {
    for (let i = 0; i < threads; i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: null });
      const feed = () => { if (next < jobs.length) w.postMessage(jobs[next++]); else w.terminate(); };
      w.on('message', (r) => { r.job = jobs[r.id]; results[r.id] = r; done++; if (done === jobs.length) resolve(); feed(); });
      w.on('error', (e) => { console.error('worker error', e); process.exit(1); });
      feed();
    }
  });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);

  const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
  const ci = (p, n) => (n ? (1.96 * Math.sqrt((p * (1 - p)) / n) * 100).toFixed(1) : '0');
  const out = { skill: SKILL, n: N };
  const bad = results.reduce((a, r) => a + r.bad, 0), tele = results.reduce((a, r) => a + r.ents.reduce((b, e) => b + e.tele, 0), 0);
  const times = results.map((r) => r.time).sort((a, b) => a - b);
  const q = (f) => times[Math.floor((times.length - 1) * f)];
  out.length = { mean: times.reduce((a, b) => a + b, 0) / times.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
  console.log(`match length: mean ${(out.length.mean / 60).toFixed(1)} min, 10% ${(q(0.1) / 60).toFixed(1)}, median ${(q(0.5) / 60).toFixed(1)}, 90% ${(q(0.9) / 60).toFixed(1)}; time-limit endings ${(results.filter((r) => r.time >= RULES.matchTime).length / results.length * 100).toFixed(0)}%`);
  console.log(`errors or endless matches: ${bad}; stuck-bot rescues: ${tele} (${(tele / results.length).toFixed(2)} per match)\n`);
  out.bad = bad; out.stuck = tele / results.length;

  const group = (tag) => results.filter((r) => r.tag === tag);
  const tags = [...new Set(results.map((r) => r.tag))];

  if (want('mirror')) {
    const g = group('mirror'), w0 = g.filter((r) => r.winner === 0).length / g.length;
    const fc = g.filter((r) => r.firstCap === r.winner).length / g.length;
    console.log(`MIRROR (${g.length} matches): Dawn side wins ${pct(w0)} ±${ci(w0, g.length)}; the troupe with the first capture wins ${pct(fc)}`);
    out.mirror = { n: g.length, dawn: w0, firstCapWins: fc };
    // Per-hero numbers from the mirror matches.
    console.log('\n  hero     stops falls  dmg/min heal/min ults  abil1 abil2  hit%  fire-time retreats group-ups plates');
    out.heroes = {};
    for (const id of HERO_IDS) {
      const es = g.flatMap((r) => r.ents.filter((e) => e.hero === id).map((e) => ({ ...e, min: r.time / 60 })));
      const m = (f) => es.reduce((a, e) => a + f(e), 0) / es.length;
      const row = { k: m((e) => e.k), d: m((e) => e.d), dmg: m((e) => e.dmg / e.min), heal: m((e) => e.heal / e.min), ults: m((e) => e.ults), c0: m((e) => e.c0), c1: m((e) => e.c1), acc: m((e) => e.hits / Math.max(1, e.shots)), point: m((e) => e.point / (e.min * 60)), retreats: m((e) => e.retreats), groups: m((e) => e.groups), packs: m((e) => e.packs) };
      out.heroes[id] = row;
      console.log(`  ${id.padEnd(8)} ${row.k.toFixed(1).padStart(5)} ${row.d.toFixed(1).padStart(5)} ${row.dmg.toFixed(0).padStart(8)} ${row.heal.toFixed(0).padStart(8)} ${row.ults.toFixed(1).padStart(4)} ${row.c0.toFixed(1).padStart(6)} ${row.c1.toFixed(1).padStart(5)} ${pct(row.acc)} ${pct(row.point)} ${row.retreats.toFixed(1).padStart(8)} ${row.groups.toFixed(1).padStart(8)} ${row.packs.toFixed(1).padStart(6)}`);
    }
    console.log('');
  }
  if (want('mixed')) {
    const g = group('mixed');
    console.log(`MIXED (${g.length} matches, random troupes): win rate of a troupe by how many copies of a hero it has`);
    out.mixed = {};
    for (const id of HERO_IDS) {
      const c = [[0, 0], [0, 0], [0, 0]];
      for (const r of g) for (const t of [0, 1]) { const n = r.teams[t].filter((x) => x === id).length; c[n][0]++; if (r.winner === t) c[n][1]++; }
      const wr = c.map(([n, w]) => (n ? w / n : 0));
      const withN = c[1][0] + c[2][0], withW = (c[1][1] + c[2][1]) / withN;
      out.mixed[id] = { none: wr[0], one: wr[1], two: wr[2], with: withW, n: withN };
      console.log(`  ${id.padEnd(8)} with ${pct(withW)} ±${ci(withW, withN)} (n=${withN})   none ${pct(wr[0])}  one ${pct(wr[1])}  two ${pct(wr[2])} (n=${c[2][0]})`);
    }
    console.log('');
  }
  for (const kind of ['swap', 'roles', 'skill']) {
    const ts = tags.filter((t) => t.startsWith(kind + ':'));
    if (!ts.length) continue;
    console.log(kind === 'swap' ? 'SWAP: a troupe with a second copy of one hero (in place of the other hero of that role) against one of each' : kind === 'roles' ? 'ROLES: a troupe with this role mix against a 2-2-2 troupe' : 'SKILL: bots of this skill against normal bots');
    out[kind] = {};
    for (const t of ts) {
      const g = group(t);
      // The test troupe is the one that differs from the standard troupe (or has the named skill).
      const wins = g.filter((r) => { const testSide = kind === 'skill' ? (r.job.skill[0] !== 'normal' ? 0 : 1) : (r.teams[0].join() === STD.join() ? 1 : 0); return r.winner === testSide; }).length / g.length;
      out[kind][t.slice(kind.length + 1)] = { n: g.length, win: wins };
      console.log(`  ${t.slice(kind.length + 1).padEnd(28)} wins ${pct(wins)} ±${ci(wins, g.length)} (n=${g.length})`);
    }
    console.log('');
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
  process.exit(bad ? 1 : 0);
}
