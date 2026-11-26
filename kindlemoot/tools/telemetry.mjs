// Reads a telemetry export (the NDJSON file from __km.telemetry.export()) and
// prints a summary of each session: the build, the browser, the row counts of
// each stream, and for the aim stream the moves, clamps, spikes, resets, lock
// errors, the largest deltas and the lock mode.
//
//   node kindlemoot/tools/telemetry.mjs <file.ndjson>            the summary
//   node kindlemoot/tools/telemetry.mjs <file> --largest 10      list 10 largest moves (default 5)
//   node kindlemoot/tools/telemetry.mjs <file> --json            the summary as JSON
//   node kindlemoot/tools/telemetry.mjs <file> --rows aim        every row of one stream, tab-separated
//   node kindlemoot/tools/telemetry.mjs <file> --session <id>    only one session (an id prefix is enough)
import { readFileSync } from 'node:fs';
import { parseExport, summarize, streamRows, SCHEMA } from '../js/telemetry-format.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--json'));
if (!file) { console.error('usage: node kindlemoot/tools/telemetry.mjs <export.ndjson> [--json] [--largest N] [--rows <stream>] [--session <id>]'); process.exit(2); }

const parsed = parseExport(readFileSync(file, 'utf8'));
if (opt('--session')) parsed.sessions = parsed.sessions.filter((s) => s.session.id.startsWith(opt('--session')));
const h = parsed.header;
if (h && h.v > SCHEMA) console.error(`note: the file has schema ${h.v}; this tool knows ${SCHEMA}. Fields it does not know are left out.`);
if (parsed.skipped) console.error(`note: skipped ${parsed.skipped} line(s) this tool cannot read`);

if (opt('--rows')) {
  const stream = opt('--rows');
  for (const entry of parsed.sessions) {
    const rows = streamRows(entry, stream);
    if (!rows.length) continue;
    const cols = ['session', ...Object.keys(rows[0])];
    console.log(cols.join('\t'));
    for (const r of rows) console.log([entry.session.id, ...cols.slice(1).map((c) => r[c] ?? '')].join('\t'));
  }
  process.exit(0);
}

const list = summarize(parsed, +(opt('--largest') || 5));
if (args.includes('--json')) { console.log(JSON.stringify(list, null, 2)); process.exit(0); }

console.log(`${file}: ${list.length} session(s)${h ? `, exported ${h.exported}, schema ${h.v}` : ''}`);
for (const s of list) {
  console.log(`\nsession ${s.id}  ${s.start || '?'}  ${s.minutes ?? '?'} min  build ${s.build}  dpr ${s.dpr}  ${s.host}${s.switches.length ? '  ?' + s.switches.join('&') : ''}`);
  console.log(`  ${s.ua}`);
  const streams = Object.entries(s.streams).map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(`  rows ${s.rows}${s.lost ? `, lost ${s.lost}` : ''}${streams ? ': ' + streams : ''}; matches ${s.matches}`);
  const a = s.aim;
  if (!a) continue;
  const modes = (o) => Object.entries(o).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  console.log(`  aim: moves ${a.moves}, clamps ${a.clamps} (up ${a.clampUp}, down ${a.clampDown}), spikes ${a.spikes}, notFinite ${a.notFinite}, resets ${a.resets}, lock errors ${a.lockErrors}`);
  console.log(`  locks ${a.locks} (${modes(a.lockModes)}), unlocks ${a.unlocks}; moves by mode: ${modes(a.moveModes)}`);
  if (a.lockErrors) console.log(`  lock errors: ${modes(a.lockErrorReasons)}`);
  console.log(`  largest |dx| ${a.maxAbsDx}, |dy| ${a.maxAbsDy}`);
  for (const m of a.largest) console.log(`    t ${m.t} ms  dx ${m.dx}  dy ${m.dy}  pitch ${m.pitch0} -> ${m.pitch1}  ${m.flags}`);
}
