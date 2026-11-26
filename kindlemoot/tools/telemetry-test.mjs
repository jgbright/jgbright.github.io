// Tests for the telemetry: the host check that gates ?otel, the stored rows,
// the export file, the OTLP format and the size limit. Plain Node, no browser.
//
//   node kindlemoot/tools/telemetry-test.mjs     (npm test)
//
// Node has no IndexedDB, so the runtime here uses its memory store. The
// IndexedDB store is checked in the browser.
import assert from 'node:assert/strict';
import { AimLog, KIND, FLAG, AIM_FIELDS } from '../js/aimlog.js';
import { SCHEMA, OTEL_URL, isLocalHost, otelAllowed, hostClass, planTrim, toOtlpLogs, unixNano, parseExport, summarize } from '../js/telemetry-format.js';
import { Telemetry } from '../js/telemetry.js';

let ok = 0, bad = 0;
async function test(name, fn) {
  try { await fn(); ok++; console.log('ok  ', name); } catch (e) { bad++; console.log('BAD ', name, '\n     ', e && e.stack || e); }
}

// A fake browser environment. `calls` records every fetch the runtime makes.
function fakeEnv(href, extra = {}) {
  const u = new URL(href);
  const calls = [];
  const env = {
    location: { search: u.search, hostname: u.hostname, pathname: u.pathname },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; },
    indexedDB: undefined,
    userAgent: 'test-agent/1.0', devicePixelRatio: 1.25, timeOrigin: 1_764_000_000_000,
    ...extra,
  };
  return { env, calls };
}

function aimRows(aim, n) {
  for (let i = 0; i < n; i++) aim.add(KIND.move, FLAG.locked | (i % 10 === 0 ? FLAG.clampUp : 0), i, -i, 1, 0.0013, 0, 0.1, 0.2);
}

function newTel(href, opts = {}) {
  const { env, calls } = fakeEnv(href, opts.env);
  const tel = new Telemetry({ env, build: 'test', limits: opts.limits, timer: false });
  const aim = new AimLog(false);
  tel.source('aim', AIM_FIELDS, (c) => aim.drain(c));
  return { tel, aim, calls };
}

// ----- The host check ------------------------------------------------------

await test('isLocalHost accepts only the three local names', () => {
  for (const h of ['127.0.0.1', 'localhost', '[::1]', '::1']) assert.equal(isLocalHost(h), true, h);
  for (const h of ['jgbright.com', 'www.jgbright.com', 'localhost.evil.com', '127.0.0.1.evil.com', 'evil.com.localhost.x', '127.0.0.2', '0.0.0.0',
    '192.168.1.20', '10.0.0.5', '', 'LOCALHOST.', 'jgbright.github.io', undefined, null]) {
    assert.equal(isLocalHost(h), false, String(h));
  }
});

await test('otelAllowed needs both ?otel and a local host', () => {
  assert.equal(otelAllowed('?otel', '127.0.0.1'), true);
  assert.equal(otelAllowed('?nolock&otel', 'localhost'), true);
  assert.equal(otelAllowed('?otel=1', '[::1]'), true);
  assert.equal(otelAllowed('', '127.0.0.1'), false);
  assert.equal(otelAllowed('?nolock', 'localhost'), false);
  assert.equal(otelAllowed('?otel', 'jgbright.com'), false);
  assert.equal(otelAllowed('?otel', '192.168.1.20'), false);
  assert.equal(otelAllowed('?otel', 'localhost.evil.com'), false);
  assert.equal(OTEL_URL, 'http://127.0.0.1:4318/v1/logs');
});

await test('hostClass stores public or local, never the host name', () => {
  assert.equal(hostClass('127.0.0.1'), 'local');
  assert.equal(hostClass('jgbright.com'), 'public');
  assert.equal(hostClass('192.168.1.20'), 'public');
});

await test('the runtime sends nothing with ?otel on a public host', async () => {
  for (const href of ['https://jgbright.com/kindlemoot/?otel', 'http://192.168.1.20:8377/kindlemoot/?otel&nolock', 'http://localhost.evil.com/kindlemoot/?otel']) {
    const { tel, aim, calls } = newTel(href);
    await tel.start();
    aimRows(aim, 50);
    await tel.flush('test');
    assert.equal(calls.length, 0, href);
    assert.equal(tel.status().otel, false, href);
  }
});

await test('the runtime sends nothing on a local host without ?otel', async () => {
  const { tel, aim, calls } = newTel('http://127.0.0.1:8377/kindlemoot/?nolock');
  await tel.start();
  aimRows(aim, 50);
  await tel.flush('test');
  assert.equal(calls.length, 0);
});

await test('the runtime sends one OTLP batch with ?otel on a local host', async () => {
  const { tel, aim, calls } = newTel('http://127.0.0.1:8377/kindlemoot/?nolock&otel');
  await tel.start();
  aimRows(aim, 50);
  const match = tel.events('match', ['event', 'match']);
  match.add({ event: 'start', match: 'm1' });
  await tel.flush('test');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OTEL_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(calls[0].init.body);
  const recs = body.resourceLogs[0].scopeLogs[0].logRecords;
  assert.equal(recs.length, 51);
  await tel.flush('test'); // nothing new: no second request
  assert.equal(calls.length, 1);
});

// ----- The aim log as a stream ---------------------------------------------

await test('AimLog.drain gives new rows once, and counts rows lost to the ring', () => {
  const aim = new AimLog(false);
  aimRows(aim, 10);
  let d = aim.drain(0);
  assert.equal(d.rows.length, 10); assert.equal(d.first, 0); assert.equal(d.next, 10); assert.equal(d.lost, 0);
  assert.equal(d.rows[3][AIM_FIELDS.indexOf('kind')], 'move');
  assert.equal(d.rows[0][AIM_FIELDS.indexOf('flags')], 'clampUp locked');
  d = aim.drain(d.next);
  assert.equal(d.rows.length, 0);
  aimRows(aim, 5000);
  d = aim.drain(10);
  assert.equal(d.rows.length, 4096); assert.equal(d.lost, 5000 - 4096); assert.equal(d.first, 5010 - 4096);
});

await test('AimLog.clear empties the console view but not the stream', () => {
  const aim = new AimLog(false);
  aimRows(aim, 20);
  aim.clear();
  assert.equal(aim.summary().rows, 0);
  assert.equal(aim.dump().length, 0);
  aimRows(aim, 3);
  assert.equal(aim.dump().length, 3);
  assert.equal(aim.summary().rows, 3);
  assert.equal(aim.dump()[0].dx, 0);
  assert.equal(aim.drain(0).rows.length, 23);
  assert.ok(aim.text().split('\n').length === 4);
});

// ----- The export file -----------------------------------------------------

await test('the export is NDJSON with a header, sessions and batches, each with a schema version', async () => {
  const { tel, aim } = newTel('https://jgbright.com/kindlemoot/?nolock');
  await tel.start();
  aimRows(aim, 30);
  await tel.flush('a');
  aimRows(aim, 12);
  aim.add(KIND.lockError, 0, 0, 0, 1, 0, 0, 0, 0, 'raw refused: NotSupportedError');
  await tel.flush('b');
  const text = await tel.exportText();
  const lines = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].type, 'header');
  assert.equal(lines[0].format, 'kindlemoot-telemetry');
  assert.equal(lines[0].v, SCHEMA);
  for (const l of lines) assert.equal(l.v, SCHEMA);
  const sessions = lines.filter((l) => l.type === 'session');
  const batches = lines.filter((l) => l.type === 'batch');
  assert.equal(sessions.length, 1);
  assert.equal(batches.length, 2);
  const s = sessions[0];
  assert.equal(s.build, 'test'); assert.equal(s.ua, 'test-agent/1.0'); assert.equal(s.dpr, 1.25); assert.equal(s.host, 'public');
  assert.deepEqual(s.switches, ['nolock']);
  assert.equal(s.rows, 43);
  assert.match(s.id, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(lines).includes('jgbright.com'), 'no host name in the export');
  assert.deepEqual(batches[0].fields, AIM_FIELDS);
  assert.equal(batches[0].first, 0); assert.equal(batches[1].first, 30);
  const parsed = parseExport(text);
  assert.equal(parsed.sessions.length, 1);
  const sum = summarize(parsed)[0];
  assert.equal(sum.aim.moves, 42);
  assert.equal(sum.aim.clamps, 5); // rows 0, 10, 20 of the first 30 and 0, 10 of the next 12
  assert.equal(sum.aim.lockErrors, 1);
  assert.equal(sum.aim.maxAbsDx, 29);
  assert.equal(sum.aim.largest[0].dx, 29);
});

await test('parseExport skips lines it does not know and keeps going', () => {
  const text = [
    JSON.stringify({ type: 'header', format: 'kindlemoot-telemetry', v: SCHEMA + 1 }),
    JSON.stringify({ type: 'session', v: SCHEMA + 1, id: 'abc', start: 1, newField: true }),
    JSON.stringify({ type: 'somethingNew', v: SCHEMA + 1 }),
    'not json',
    JSON.stringify({ type: 'batch', v: SCHEMA + 1, session: 'abc', stream: 'frames', fields: ['t', 'ms'], rows: [[1, 16.6], [2, 17]], first: 0, lost: 0 }),
    '',
  ].join('\n');
  const p = parseExport(text);
  assert.equal(p.sessions.length, 1);
  assert.equal(p.skipped, 2);
  const sum = summarize(p)[0];
  assert.equal(sum.streams.frames, 2);
  assert.equal(sum.aim, null);
});

// ----- OTLP ----------------------------------------------------------------

await test('unixNano keeps full precision as a string', () => {
  assert.equal(unixNano(1_764_000_000_000, 0), '1764000000000000000');
  assert.equal(unixNano(1_764_000_000_000, 1234.5), '1764000001234500000');
  assert.equal(unixNano(1_764_000_000_000.25, 0.0005), '1764000000000250500');
});

await test('toOtlpLogs writes one log record for each row, with distinct bodies and typed attributes', () => {
  const session = { id: 'abcd', build: 'b1', ua: 'ua', dpr: 2, host: 'local', origin: 1_764_000_000_000 };
  const batches = [{ v: SCHEMA, session: 'abcd', stream: 'aim', fields: ['t', 'kind', 'dx', 'flags'], first: 7, rows: [[1, 'move', 3, 'locked'], [1, 'move', 3, 'locked spike']], lost: 0 }];
  const out = toOtlpLogs(session, batches);
  const res = out.resourceLogs[0].resource.attributes;
  const attr = (list, key) => list.find((a) => a.key === key)?.value;
  assert.equal(attr(res, 'service.name').stringValue, 'kindlemoot');
  assert.equal(attr(res, 'service.version').stringValue, 'b1');
  assert.equal(attr(res, 'service.instance.id'), undefined, 'the session id must not become a Loki label');
  const recs = out.resourceLogs[0].scopeLogs[0].logRecords;
  assert.equal(recs.length, 2);
  assert.notEqual(recs[0].body.stringValue, recs[1].body.stringValue);
  assert.equal(recs[0].timeUnixNano, '1764000000001000000');
  assert.equal(attr(recs[0].attributes, 'km.stream').stringValue, 'aim');
  assert.equal(attr(recs[0].attributes, 'km.session').stringValue, 'abcd');
  assert.equal(attr(recs[0].attributes, 'km.row').intValue, '7');
  assert.equal(attr(recs[0].attributes, 'km.schema').intValue, String(SCHEMA));
  assert.equal(attr(recs[0].attributes, 'aim.dx').doubleValue, 3);
  assert.equal(attr(recs[0].attributes, 'aim.kind').stringValue, 'move');
  assert.equal(attr(recs[0].attributes, 'aim.t'), undefined, 'the time is the record time, not an attribute');
  assert.equal(recs[0].severityText, 'INFO');
  assert.equal(recs[1].severityText, 'WARN'); // a dropped spike
});

// ----- The size limit ------------------------------------------------------

await test('planTrim drops the oldest sessions first, then the oldest batches of this session', () => {
  const sessions = [
    { id: 'old', start: 1, rows: 100 }, { id: 'mid', start: 2, rows: 100 }, { id: 'cur', start: 3, rows: 100 },
  ];
  assert.deepEqual(planTrim(sessions, 'cur', [], { maxRows: 1000, maxSessions: 5 }), { sessions: [], batches: [] });
  assert.deepEqual(planTrim(sessions, 'cur', [], { maxRows: 250, maxSessions: 5 }), { sessions: ['old'], batches: [] });
  assert.deepEqual(planTrim(sessions, 'cur', [], { maxRows: 1000, maxSessions: 2 }), { sessions: ['old'], batches: [] });
  const written = [{ key: 1, rows: 40 }, { key: 2, rows: 40 }, { key: 3, rows: 20 }];
  assert.deepEqual(planTrim(sessions, 'cur', written, { maxRows: 50, maxSessions: 5 }), { sessions: ['old', 'mid'], batches: [1, 2] });
  // The newest batch is always kept.
  assert.deepEqual(planTrim(sessions, 'cur', written, { maxRows: 1, maxSessions: 1 }), { sessions: ['old', 'mid'], batches: [1, 2] });
});

await test('the memory store keeps to the limit and drops the oldest rows first', async () => {
  const { tel, aim } = newTel('https://jgbright.com/kindlemoot/', { limits: { maxRows: 100, maxSessions: 3 } });
  await tel.start();
  for (let i = 0; i < 6; i++) { aimRows(aim, 30); await tel.flush('t'); }
  const p = parseExport(await tel.exportText());
  const b = p.sessions[0].batches;
  assert.equal(p.sessions[0].session.rows, 90);
  assert.equal(b.length, 3);
  assert.equal(b[0].first, 90); // the first three batches went
});

await test('a pagehide flush writes at once and sends with keepalive', async () => {
  const { tel, aim, calls } = newTel('http://localhost:8377/kindlemoot/?otel');
  await tel.start();
  aimRows(aim, 9);
  tel.flush('pagehide');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.keepalive, true);
  const p = parseExport(await tel.exportText());
  assert.equal(p.sessions[0].session.rows, 9);
  assert.equal(p.sessions[0].batches[0].reason, 'pagehide');
});

await test('a page load with no rows stores no session', async () => {
  const { tel } = newTel('https://jgbright.com/kindlemoot/');
  await tel.start();
  await tel.flush('t');
  assert.equal(parseExport(await tel.exportText()).sessions.length, 0);
});

await test('a store that throws leaves the game running on memory', async () => {
  const brokenIdb = { open() { throw new Error('blocked'); } };
  const { env } = fakeEnv('https://jgbright.com/kindlemoot/', { indexedDB: brokenIdb });
  const tel = new Telemetry({ env, build: 'test', timer: false });
  const aim = new AimLog(false);
  tel.source('aim', AIM_FIELDS, (c) => aim.drain(c));
  await tel.start();
  aimRows(aim, 5);
  await tel.flush('t');
  assert.equal(tel.status().store, 'memory');
  assert.equal(parseExport(await tel.exportText()).sessions[0].session.rows, 5);
});

console.log(`ok ${ok}, bad ${bad}`);
process.exit(bad ? 1 : 0);
