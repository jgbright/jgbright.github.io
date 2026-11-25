// Quick health check: run a few bot matches and fail on errors, NaN, stuck bots or endless matches.
import { Sim } from '../js/sim/sim.js';
import { MAP } from '../js/data/map.js';
import { HERO_IDS, RULES } from '../js/data/heroes.js';

const n = +(process.argv[2] || 10);
let bad = 0;
const t0 = Date.now();
const lens = [];
for (let i = 0; i < n; i++) {
  const sim = new Sim({ seed: 1000 + i, map: MAP, teams: [{ heroes: HERO_IDS, skill: 'normal' }, { heroes: HERO_IDS, skill: 'normal' }], human: null });
  if (i === 0) { const nav = sim.world.nav; console.log('nav nodes', nav.nodes.length, 'dead', nav.nodes.filter((x) => x.dead).length, 'links', nav.nodes.reduce((a, x) => a + x.links.length, 0)); }
  const maxTicks = (RULES.matchTime + 60) * RULES.tickRate;
  while (!sim.over && sim.tick < maxTicks) {
    sim.step();
    sim.events.length = 0;
    if (sim.tick % 600 === 0) for (const e of sim.ents) if (!Number.isFinite(e.x + e.y + e.z + e.hp)) { console.log('NaN', e.heroId, sim.time); bad++; }
  }
  const tele = sim.ents.reduce((a, e) => a + (e.bot ? e.bot.teleports : 0), 0);
  if (!sim.over) { bad++; console.log('match did not end', i); }
  if (tele > 0) { console.log('stuck teleports', tele, 'in match', i); }
  lens.push(sim.time);
  const o = sim.objective;
  console.log(`#${i} winner ${sim.winner} time ${sim.time.toFixed(0)}s score ${o.score.map((s) => s.toFixed(0)).join('-')} tele ${tele} | ` +
    sim.ents.map((e) => `${e.heroId[0]}${e.team}:${e.stats.kills}/${e.stats.deaths}/${Math.round(e.stats.damage)}/${Math.round(e.stats.healing)}/u${e.stats.ults}`).join(' '));
}
console.log(`avg length ${(lens.reduce((a, b) => a + b, 0) / n).toFixed(0)}s, ${((Date.now() - t0) / n).toFixed(0)} ms per match, bad ${bad}`);
process.exit(bad ? 1 : 0);
