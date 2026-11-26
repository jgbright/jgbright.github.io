// Kindlemoot telemetry: named streams of rows, kept across page loads.
//
// Streams. A stream is a name and a list of columns. There are two kinds:
//   tel.source(name, fields, drain)   a fast stream that keeps its own ring
//                                     buffer, such as the aim log. drain(cursor)
//                                     returns the new rows (see AimLog.drain).
//   tel.events(name, fields)          a slow stream, such as match events.
//                                     .add({ ... }) queues one row; `t` is filled in.
// Adding a stream is one of these calls in main.js. No other file changes.
//
// Every few seconds, on pause and on pagehide, flush() drains every stream
// into batches and writes them to IndexedDB in one transaction. Nothing here
// runs in the input path. If IndexedDB is blocked, the store is memory only,
// and the game goes on. The store keeps to a fixed size (LIMITS) and drops the
// oldest rows first.
//
// With ?otel in the address on a local host, flush() also posts the batches
// as OTLP/JSON log records to the collector on this machine. On any other host
// nothing is sent.
//
// In the browser console:
//   __km.telemetry.summary()        a summary of each stored session
//   __km.telemetry.export()         download every stored session as an NDJSON file
//   __km.telemetry.status()         this session's id, the store and the export state
//   __km.telemetry.clear()          delete every stored session

import { SCHEMA, OTEL_URL, LIMITS, otelAllowed, hostClass, planTrim, exportLines, parseExport, summarize, toOtlpLogs } from './telemetry-format.js';

const FLUSH_MS = 5000;
const DB_NAME = 'kindlemoot-telemetry';

// A random id. getRandomValues works on a plain-http LAN address too, where randomUUID does not.
export function randomId(env = globalThis) {
  const b = new Uint8Array(8);
  try { env.crypto.getRandomValues(b); } catch { for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// ----- Stores --------------------------------------------------------------
// Both stores have the same methods. Each returns a promise.

class MemoryStore {
  constructor() { this.kind = 'memory'; this.sess = new Map(); this.list = []; this.key = 0; }
  async write(session, batches) {
    this.sess.set(session.id, { ...session });
    return batches.map((b) => { const key = ++this.key; this.list.push({ key, b }); return key; });
  }
  async sessions() { return [...this.sess.values()]; }
  async batches() { return this.list.map((x) => x.b); }
  async remove(sessionIds, batchKeys) {
    const ids = new Set(sessionIds), keys = new Set(batchKeys);
    for (const id of ids) this.sess.delete(id);
    this.list = this.list.filter((x) => !ids.has(x.b.session) && !keys.has(x.key));
  }
  async clear() { this.sess.clear(); this.list = []; }
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || new Error('transaction aborted')); });

class IdbStore {
  constructor(db) { this.kind = 'indexeddb'; this.db = db; }
  static async open(idb) {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('sessions', { keyPath: 'id' });
      db.createObjectStore('batches', { autoIncrement: true }).createIndex('session', 'session');
    };
    const db = await new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('blocked'));
    });
    return new IdbStore(db);
  }
  async write(session, batches) {
    const tx = this.db.transaction(['sessions', 'batches'], 'readwrite');
    tx.objectStore('sessions').put(session);
    const store = tx.objectStore('batches');
    const keys = batches.map((b) => req(store.add(b)));
    await done(tx);
    return Promise.all(keys);
  }
  async sessions() { return req(this.db.transaction('sessions').objectStore('sessions').getAll()); }
  async batches() { return req(this.db.transaction('batches').objectStore('batches').getAll()); }
  async remove(sessionIds, batchKeys) {
    const tx = this.db.transaction(['sessions', 'batches'], 'readwrite');
    const sessions = tx.objectStore('sessions'), batches = tx.objectStore('batches');
    for (const id of sessionIds) {
      sessions.delete(id);
      const c = batches.index('session').openKeyCursor(IDBKeyRange.only(id));
      c.onsuccess = () => { const cur = c.result; if (cur) { batches.delete(cur.primaryKey); cur.continue(); } };
    }
    for (const k of batchKeys) batches.delete(k);
    await done(tx);
  }
  async clear() {
    const tx = this.db.transaction(['sessions', 'batches'], 'readwrite');
    tx.objectStore('sessions').clear(); tx.objectStore('batches').clear();
    await done(tx);
  }
}

// ----- The runtime ---------------------------------------------------------

export class Telemetry {
  // env: the browser parts it uses, so the tests can give fakes. limits: LIMITS.
  // timer: false stops the flush timer and the page listeners (for tests).
  constructor({ env, build = 'unknown', limits = LIMITS, timer = true } = {}) {
    const g = globalThis;
    this.env = env || {
      location: g.location, fetch: g.fetch && g.fetch.bind(g), indexedDB: g.indexedDB,
      userAgent: g.navigator && g.navigator.userAgent, devicePixelRatio: g.devicePixelRatio, timeOrigin: g.performance && g.performance.timeOrigin,
      crypto: g.crypto,
    };
    const loc = this.env.location || {};
    this.limits = limits;
    this.otel = otelAllowed(loc.search, loc.hostname);
    this.streams = [];
    this.written = []; // this session's batches in the store, oldest first: { key, rows }
    this.session = {
      v: SCHEMA, id: randomId(this.env), start: Date.now(), origin: Math.round((this.env.timeOrigin || Date.now()) * 1000) / 1000, end: Date.now(),
      build, ua: this.env.userAgent || '', dpr: this.env.devicePixelRatio || 1, host: hostClass(loc.hostname),
      switches: [...new URLSearchParams(loc.search || '').keys()], rows: 0, batches: 0,
    };
    this.store = new MemoryStore();
    this.error = '';
    this.sent = { requests: 0, records: 0, failed: 0, lastError: '' };
    this.queue = Promise.resolve();
    this.timer = timer;
  }

  source(name, fields, drain, version = 1) {
    this.streams.push({ name, fields, version, drain, cursor: 0 });
  }

  events(name, fields, version = 1) {
    const all = fields.includes('t') ? fields : ['t', ...fields];
    let pending = [], w = 0;
    const now = () => (globalThis.performance ? Math.round(performance.now() * 10) / 10 : 0);
    const drain = (cursor) => { const rows = pending; pending = []; return { rows, first: cursor, next: w, lost: 0 }; };
    this.streams.push({ name, fields: all, version, drain, cursor: 0 });
    return {
      add: (row) => {
        if (pending.length >= 4096) return; // a runaway stream must not grow without end
        pending.push(all.map((f) => (f === 't' ? (row.t ?? now()) : row[f] ?? null))); w++;
      },
    };
  }

  // Open the store and trim the old sessions. Call once. This session's record
  // is written with its first rows, so a page load with no rows takes no slot.
  start() {
    this.ready = this.run(async () => {
      const idb = this.env.indexedDB;
      if (idb) {
        try { this.store = await IdbStore.open(idb); } catch (e) { this.fail('open', e); }
      }
      await this.trim();
    });
    if (this.timer && typeof addEventListener === 'function') {
      setInterval(() => this.flush('timer'), FLUSH_MS);
      addEventListener('pagehide', () => this.flush('pagehide'));
      addEventListener('visibilitychange', () => { if (document.hidden) this.flush('hidden'); });
    }
    return this.ready;
  }

  // Drain every stream now, then store (and maybe send) the rows in the background.
  flush(reason = '') {
    const batches = [];
    for (const s of this.streams) {
      const d = s.drain(s.cursor);
      s.cursor = d.next;
      if (!d.rows.length && !d.lost) continue;
      batches.push({ v: SCHEMA, session: this.session.id, stream: s.name, sv: s.version, first: d.first, lost: d.lost, fields: s.fields, rows: d.rows, reason });
    }
    if (!batches.length) return this.queue;
    return this.run(async () => {
      await this.save(batches);
      if (this.otel) await this.send(batches, reason === 'pagehide');
    });
  }

  // One job at a time, in order. A failed job never stops the next.
  run(job) {
    this.queue = this.queue.then(job).catch((e) => this.fail('job', e));
    return this.queue;
  }

  fail(where, e) {
    const msg = `${where}: ${(e && (e.name || e.message)) || e}`;
    if (!this.error) console.warn('[telemetry] storage failed, keeping rows in memory only.', msg);
    this.error = msg;
  }

  async save(batches) {
    const s = this.session;
    s.end = Date.now();
    s.rows += batches.reduce((a, b) => a + b.rows.length, 0);
    s.batches += batches.length;
    let keys;
    try { keys = await this.store.write(s, batches); } catch (e) {
      if (this.store.kind === 'memory') throw e;
      this.fail('write', e);
      this.store = new MemoryStore();
      this.written = [];
      s.rows = batches.reduce((a, b) => a + b.rows.length, 0); s.batches = batches.length;
      keys = await this.store.write(s, batches);
    }
    batches.forEach((b, i) => this.written.push({ key: keys[i], rows: b.rows.length }));
    await this.trim();
  }

  async trim() {
    try {
      const plan = planTrim(await this.store.sessions(), this.session.id, this.written, this.limits);
      if (!plan.sessions.length && !plan.batches.length) return;
      const gone = new Set(plan.batches);
      for (const w of this.written) if (gone.has(w.key)) { this.session.rows -= w.rows; this.session.batches--; }
      this.written = this.written.filter((w) => !gone.has(w.key));
      await this.store.remove(plan.sessions, plan.batches);
      if (this.written.length) await this.store.write(this.session, []);
    } catch (e) { this.fail('trim', e); }
  }

  async send(batches, closing) {
    const body = JSON.stringify(toOtlpLogs(this.session, batches));
    const records = batches.reduce((a, b) => a + b.rows.length, 0);
    try {
      // keepalive lets a request outlive the page, but only up to 64 kB.
      const res = await this.env.fetch(OTEL_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: closing && body.length < 60000 });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.sent.requests++; this.sent.records += records;
    } catch (e) {
      this.sent.failed++;
      if (!this.sent.lastError) console.warn('[telemetry] the OpenTelemetry export failed; the rows stay in the local store.', String(e && e.message || e));
      this.sent.lastError = String(e && e.message || e);
    }
  }

  // ----- The console interface ---------------------------------------------

  status() {
    return {
      session: this.session.id, build: this.session.build, store: this.store.kind, storeError: this.error,
      rows: this.session.rows, batches: this.session.batches, otel: this.otel, sent: { ...this.sent },
    };
  }

  async exportText() {
    await this.flush('export');
    const sessions = (await this.store.sessions()).sort((a, b) => a.start - b.start);
    const batches = await this.store.batches();
    return exportLines(sessions, batches, this.session.build);
  }

  async summary() { return summarize(parseExport(await this.exportText())); }

  // Download every stored session as one NDJSON file. download: false only returns the counts.
  async export({ download = true } = {}) {
    const text = await this.exportText();
    const p = parseExport(text);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const file = `kindlemoot-telemetry-${stamp}.ndjson`;
    if (download && typeof document !== 'undefined') {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
      const a = document.createElement('a');
      a.href = url; a.download = file; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    return { file, bytes: text.length, sessions: p.sessions.length, batches: p.sessions.reduce((n, s) => n + s.batches.length, 0),
      rows: p.sessions.reduce((n, s) => n + s.batches.reduce((m, b) => m + b.rows.length, 0), 0) };
  }

  // Delete every stored session, this one too. New rows are stored from here on.
  async clear() {
    await this.run(async () => {
      await this.store.clear();
      this.written = []; this.session.rows = 0; this.session.batches = 0;
    });
    return this.status();
  }
}
