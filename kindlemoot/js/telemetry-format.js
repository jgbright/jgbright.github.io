// The telemetry formats, with no browser code: the host check for ?otel, the
// size limit, the export file, the OTLP/JSON log records and the summary.
// The game (telemetry.js), the analysis tool (tools/telemetry.mjs) and the
// tests (tools/telemetry-test.mjs) all use this file.
//
// Stored records and export lines all carry `v`, the schema version. Raise it
// when the meaning of a field changes. A new stream or a new column needs no
// new version: each batch names its stream and lists its columns.
//
// The export file is NDJSON, one JSON object on each line:
//   {"type":"header","format":"kindlemoot-telemetry","v":1,"exported":"…","build":"…"}
//   {"type":"session","v":1,"id":"…","start":…,"origin":…,"end":…,"build":"…","ua":"…","dpr":1.25,
//    "host":"public","switches":["nolock"],"rows":…,"batches":…}
//   {"type":"batch","v":1,"session":"…","stream":"aim","sv":1,"first":0,"lost":0,
//    "fields":["t","kind",…],"rows":[[12.5,"move",…],…]}
// `t` in a row is milliseconds since the page loaded; the session's `origin`
// is that moment as epoch milliseconds. `first` is the stream's row number of
// the batch's first row, so a gap shows lost rows.

export const SCHEMA = 1;
export const FORMAT = 'kindlemoot-telemetry';
// The OpenTelemetry collector on this machine. It is fixed: the switch never takes an address.
export const OTEL_URL = 'http://127.0.0.1:4318/v1/logs';
export const LIMITS = { maxRows: 250_000, maxSessions: 40 };

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// True only for this machine's own names. location.hostname gives "[::1]" for IPv6.
export function isLocalHost(hostname) {
  return typeof hostname === 'string' && LOCAL_HOSTS.has(hostname);
}

// The OpenTelemetry export runs only with ?otel in the address on a local host.
export function otelAllowed(search, hostname) {
  return new URLSearchParams(search || '').has('otel') && isLocalHost(hostname);
}

// The session record keeps this, not the host name or an address.
export const hostClass = (hostname) => (isLocalHost(hostname) ? 'local' : 'public');

// What to delete to keep the store under its limits. The oldest sessions go
// first, whole; this session is never one of them. If this session alone is
// still too big, its oldest batches go, but never its newest one.
//   sessions: [{ id, start, rows }]   written: this session's batches, oldest first, [{ key, rows }]
export function planTrim(sessions, current, written, limits) {
  const others = sessions.filter((s) => s.id !== current).sort((a, b) => a.start - b.start);
  let total = sessions.reduce((a, s) => a + (s.rows || 0), 0);
  let count = others.length + 1;
  const drop = [], batches = [];
  while (others.length && (count > limits.maxSessions || total > limits.maxRows)) {
    const s = others.shift();
    drop.push(s.id); total -= s.rows || 0; count--;
  }
  for (let i = 0; i < written.length - 1 && total > limits.maxRows; i++) {
    batches.push(written[i].key); total -= written[i].rows;
  }
  return { sessions: drop, batches };
}

// ----- Export file ---------------------------------------------------------

export function exportLines(sessions, batches, build, exported = new Date().toISOString()) {
  const lines = [JSON.stringify({ type: 'header', format: FORMAT, v: SCHEMA, exported, build })];
  for (const s of sessions) lines.push(JSON.stringify({ type: 'session', ...s }));
  for (const b of batches) lines.push(JSON.stringify({ type: 'batch', ...b }));
  return lines.join('\n') + '\n';
}

// Reads an export file. Lines it cannot read or does not know are counted in
// `skipped`, so an old tool can still read a newer file.
export function parseExport(text) {
  const out = { header: null, sessions: [], skipped: 0 };
  const byId = new Map();
  const session = (id) => {
    let s = byId.get(id);
    if (!s) { s = { session: { id }, batches: [] }; byId.set(id, s); out.sessions.push(s); }
    return s;
  };
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { out.skipped++; continue; }
    if (o && o.type === 'header') out.header = o;
    else if (o && o.type === 'session' && o.id) Object.assign(session(o.id).session, o);
    else if (o && o.type === 'batch' && o.session && Array.isArray(o.fields) && Array.isArray(o.rows)) session(o.session).batches.push(o);
    else out.skipped++;
  }
  for (const s of out.sessions) s.batches.sort((a, b) => a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : a.first - b.first);
  return out;
}

// Each row of one stream as an object, oldest first.
export function streamRows(entry, stream) {
  const rows = [];
  for (const b of entry.batches) {
    if (b.stream !== stream) continue;
    for (const r of b.rows) { const o = {}; b.fields.forEach((f, i) => { o[f] = r[i]; }); rows.push(o); }
  }
  return rows;
}

// ----- Summary -------------------------------------------------------------

// For each session: its facts, the row count of each stream, and for the aim
// stream the counts, the largest moves and the lock modes.
export function summarize(parsed, largest = 5) {
  return parsed.sessions.map((entry) => {
    const s = entry.session, streams = {};
    let lost = 0;
    for (const b of entry.batches) { streams[b.stream] = (streams[b.stream] || 0) + b.rows.length; lost += b.lost || 0; }
    const matches = streamRows(entry, 'match').filter((r) => r.event === 'start').length;
    return {
      id: s.id, start: s.start ? new Date(s.start).toISOString() : null, minutes: s.end && s.start ? Math.round((s.end - s.start) / 6000) / 10 : null,
      build: s.build, ua: s.ua, dpr: s.dpr, host: s.host, switches: s.switches || [], v: s.v,
      rows: Object.values(streams).reduce((a, n) => a + n, 0), lost, streams, matches,
      aim: streams.aim ? aimSummary(streamRows(entry, 'aim'), largest) : null,
    };
  });
}

function aimSummary(rows, largest) {
  const a = { moves: 0, clampUp: 0, clampDown: 0, clamps: 0, spikes: 0, notFinite: 0, resets: 0, locks: 0, unlocks: 0, lockErrors: 0,
    maxAbsDx: 0, maxAbsDy: 0, lockModes: {}, moveModes: { raw: 0, plain: 0, drag: 0 }, largest: [], lockErrorReasons: {} };
  const moves = [];
  for (const r of rows) {
    const f = ` ${r.flags || ''} `;
    const has = (name) => f.includes(` ${name} `);
    if (r.kind === 'move') {
      a.moves++;
      if (has('spike')) a.spikes++;
      if (has('notFinite')) a.notFinite++;
      if (has('drag')) a.moveModes.drag++; else if (has('raw')) a.moveModes.raw++; else if (has('locked')) a.moveModes.plain++;
      if (Number.isFinite(r.dx) && Number.isFinite(r.dy)) {
        a.maxAbsDx = Math.max(a.maxAbsDx, Math.abs(r.dx)); a.maxAbsDy = Math.max(a.maxAbsDy, Math.abs(r.dy));
        moves.push(r);
      }
    } else if (r.kind === 'reset') a.resets++;
    else if (r.kind === 'lock') { a.locks++; const m = r.reason || 'unknown'; a.lockModes[m] = (a.lockModes[m] || 0) + 1; }
    else if (r.kind === 'unlock') a.unlocks++;
    else if (r.kind === 'lockError') { a.lockErrors++; const m = r.reason || ''; a.lockErrorReasons[m] = (a.lockErrorReasons[m] || 0) + 1; }
    if (has('clampUp')) a.clampUp++;
    if (has('clampDown')) a.clampDown++;
  }
  a.clamps = a.clampUp + a.clampDown;
  const size = (r) => Math.max(Math.abs(r.dx), Math.abs(r.dy));
  a.largest = moves.sort((x, y) => size(y) - size(x)).slice(0, largest)
    .map((r) => ({ t: r.t, dx: r.dx, dy: r.dy, pitch0: r.pitch0, pitch1: r.pitch1, flags: r.flags }));
  return a;
}

// ----- OTLP/JSON -----------------------------------------------------------

// Epoch nanoseconds as a decimal string. A double cannot hold them exactly.
// The whole and the fractional milliseconds are added apart, so no precision is lost.
export function unixNano(originMs, tMs) {
  const oi = Math.floor(originMs), ti = Math.floor(tMs);
  let ms = oi + ti, ns = Math.round((originMs - oi + tMs - ti) * 1e6);
  if (ns >= 1e6) { ms += Math.floor(ns / 1e6); ns %= 1e6; }
  return String(ms) + String(ns).padStart(6, '0');
}

const attr = (key, v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? { key, value: { doubleValue: v } } : { key, value: { stringValue: String(v) } };
  if (typeof v === 'boolean') return { key, value: { boolValue: v } };
  return { key, value: { stringValue: v == null ? '' : String(v) } };
};
const intAttr = (key, v) => ({ key, value: { intValue: String(v) } });
const WARN_FLAGS = /\b(spike|notFinite|clampUp|clampDown)\b/;

// The batches as one OTLP logs request. Each row is one log record: the
// stream and the session are attributes, and each column is an attribute
// named <stream>.<column>. The session id is a plain attribute, not
// service.instance.id, so Loki does not make it a label.
export function toOtlpLogs(session, batches) {
  const logRecords = [];
  for (const b of batches) {
    const ti = b.fields.indexOf('t');
    const kindField = b.fields.includes('kind') ? 'kind' : b.fields.includes('event') ? 'event' : null;
    const ki = kindField ? b.fields.indexOf(kindField) : -1;
    const fi = b.fields.indexOf('flags');
    b.rows.forEach((r, j) => {
      const row = b.first + j;
      const t = ti >= 0 ? r[ti] : 0;
      const warn = (fi >= 0 && WARN_FLAGS.test(r[fi])) || (ki >= 0 && r[ki] === 'lockError');
      const attributes = [attr('km.stream', b.stream), attr('km.session', session.id), intAttr('km.row', row), intAttr('km.schema', b.v)];
      b.fields.forEach((f, i) => { if (i !== ti) attributes.push(attr(`${b.stream}.${f}`, r[i])); });
      const time = unixNano(session.origin, t);
      logRecords.push({
        timeUnixNano: time, observedTimeUnixNano: time,
        severityNumber: warn ? 13 : 9, severityText: warn ? 'WARN' : 'INFO',
        body: { stringValue: `${b.stream}${ki >= 0 ? ' ' + r[ki] : ''} #${row}` },
        attributes,
      });
    });
  }
  return {
    resourceLogs: [{
      resource: { attributes: [
        attr('service.name', 'kindlemoot'), attr('service.version', session.build),
        attr('km.session', session.id), attr('user_agent.original', session.ua), attr('km.dpr', session.dpr), attr('km.host', session.host),
      ] },
      scopeLogs: [{ scope: { name: 'kindlemoot.telemetry', version: String(SCHEMA) }, logRecords }],
    }],
  };
}
