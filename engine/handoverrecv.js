'use strict';
/**
 * kosmos#8710 slice 4: the successor's computer receives the agents a company hands over to them.
 *
 * The other half of engine/handoversend.js, on the same tick gate (orgenroll.mayReport) and the same switch
 * (KOSMOS_ORG_HANDOVER=1). For each /v1/mac/org/handover/mine row this computer receives (side 'receive'):
 *
 *   requested   make a one-time key pair, write its secret half to disk FIRST (<store.ROOT>/handover/<id>.key.json,
 *               mode 600, written whole), then POST /key {id, pubkey}. /key moves the record to `packing` once, so a
 *               secret lost after its public half was accepted could never open the pack. A row still `requested`
 *               with a key on disk sends the same public half again (an answer that was lost).
 *   packing     wait for the leaving computer. A seal_pub that is not this computer's key: final, said.
 *   packed / receiving
 *               fetch the manifest through /read, check it is the one the coordinator recorded (sha256, size), open it
 *               with the one-time secret and the packing computer's key (sender_pubkey), and restore into a Kosmos made
 *               by the restore path (engine/restoreworld.js, kind 'handover': "Handed over: <member>, <date>"). Agents
 *               arrive STOPPED and are enabled on the restore review screen (#5536 4c); nothing here starts one. Then
 *               POST /done {id, ok: true} and delete the key file.
 *               A missing sender_pubkey (the packing computer was retired), a manifest that is missing (the coordinator
 *               marks `packed` when it grants the manifest, before the upload lands: handoversend's KNOWN note), one
 *               that is not the recorded one, or one that does not open: POST /done {id, ok: false}, so the company
 *               sees it failed and can start again. Never a skipped check.
 *
 * Chunks are read through /read (at most READ_KEYS keys a call): every URL must be https, on a named host (never an IP
 * address or localhost), with a path ending in its key; no redirect is followed and no body is read past its cap.
 * Every byte is then checked against the device-signed manifest by backuprestore.restoreSnapshot, so a wrong URL reads
 * as a failure, never as the colleague's files. Not restorefetch.readGrantFetcher: its grant contract needs a numeric
 * key epoch and a period, which a hand-over does not have.
 *
 * KNOWN, kosmos#8733: the one-time key this computer sends and the packing computer's key it is given both pass through
 * Kosmos+ unauthenticated. Hand-over is off everywhere until that is closed.
 *
 * One hand-over at a time, never two ticks at once. Never throws.
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const MINE_ROUTE = '/v1/mac/org/handover/mine';
const KEY_ROUTE = '/v1/mac/org/handover/key';
const READ_ROUTE = '/v1/mac/org/handover/read';
const DONE_ROUTE = '/v1/mac/org/handover/done';
const READ_KEYS = 200;                         // kosmos-relay handover.rs MAX_READ_KEYS
const URL_LIFETIME_MS = 4 * 60 * 1000;         // asked for again before the coordinator's GRANT_SECS run out
const GET_TIMEOUT_MS = 60 * 1000;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024 + 4096;   // above a sealed chunk's size (backuprestore's own bound decides)
const EVERY_MS = 5 * 60 * 1000;
const PLAIN = /^[A-Za-z0-9_-]{1,64}$/;
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

let allowHttp = false;
function allowHttpForTests(on) { allowHttp = on === true; }

const b64 = (buf) => Buffer.from(buf).toString('base64');

/* ---- the one-time key, on this computer only ---- */

function keyDir(root) { return path.join(root || require('./store').ROOT, 'handover'); }
function keyFile(id, root) { return path.join(keyDir(root), `${id}.key.json`); }

/* { sk, pk } (Buffers) from disk, null when there is none, or { problem } when there is one that cannot be used. */
function readKey(id, root) {
  let text;
  try { text = fs.readFileSync(keyFile(id, root), 'utf8'); } catch (err) {
    return err && err.code === 'ENOENT' ? null : { problem: 'the hand-over key on this computer could not be read' };
  }
  try {
    const j = JSON.parse(text);
    const sk = Buffer.from(String(j.sk), 'base64'), pk = Buffer.from(String(j.pk), 'base64');
    if (j.id !== id || sk.length !== 32 || pk.length !== 32 || b64(pk) !== j.pk) return { problem: 'the hand-over key on this computer is damaged' };
    return { sk, pk };
  } catch { return { problem: 'the hand-over key on this computer is damaged' }; }
}

/* Written whole (a temp file, fsynced, renamed), mode 600 in a 700 folder. Throws on failure: the caller sends nothing. */
function writeKey(id, kp, root) {
  const dir = keyDir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tmp = path.join(dir, `.${id}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ id, sk: b64(kp.sk), pk: b64(kp.pk), at: new Date().toISOString() }) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, keyFile(id, root));
}

function deleteKey(id, root) {
  const f = keyFile(id, root);
  try { const b = fs.readFileSync(f); b.fill(0); fs.writeFileSync(f, b); } catch { /* removed below either way */ }
  try { fs.rmSync(f, { force: true }); } catch { /* left; the next tick finds no open row for it */ }
}

/* ---- reading the pack's objects through /read ---- */

function urlProblem(u, key) {
  let url;
  try { url = new URL(u); } catch { return 'not a URL'; }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return 'not https';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowHttp && (net.isIP(host) || host === 'localhost' || host.endsWith('.localhost'))) return 'not a named host';
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return 'an unreadable path'; }
  if (!p.endsWith(`/${key}`)) return 'a path that is not its key';
  return null;
}

/* fetchObject(key, { maxBytes }) -> Buffer | null, with `why` set on the last refusal. plan(keys): the keys in the order
   they will be fetched, so each /read asks for up to READ_KEYS of them at once. */
function readFetcher(opts) {
  const mac = opts.macRequest, id = opts.id, prefix = opts.prefix;
  const fetchFn = opts.fetch || globalThis.fetch;
  const now = opts.now || Date.now;
  const urls = new Map();   // key -> { url, at }
  let order = [];
  const done = new Set();
  const state = { why: null };
  const fresh = (k) => { const u = urls.get(k); return u && now() - u.at < URL_LIFETIME_MS ? u.url : null; };
  async function ask(key) {
    const keys = [key];
    for (const k of order) { if (keys.length >= READ_KEYS) break; if (k !== key && !done.has(k) && !fresh(k)) keys.push(k); }
    const at = now();
    const r = await mac('POST', READ_ROUTE, { id, keys });
    if (!r || !r.ok) { state.why = (r && r.because) || 'Kosmos+ did not answer'; return; }
    const rows = r.data && Array.isArray(r.data.reads) ? r.data.reads : [];
    for (const row of rows) {
      if (!row || typeof row.key !== 'string' || typeof row.url !== 'string' || !keys.includes(row.key)) continue;
      const bad = urlProblem(row.url, row.key);
      if (bad) { state.why = `Kosmos+ gave a link for the pack that this computer will not use (${bad})`; continue; }
      urls.set(row.key, { url: row.url, at });
    }
  }
  async function fetchObject(key, o) {
    const maxBytes = (o && o.maxBytes) || MAX_CHUNK_BYTES;
    if (typeof key !== 'string' || !key.startsWith(prefix) || !PLAIN.test(key.slice(prefix.length))) { state.why = 'the pack names an object outside this hand-over'; return null; }
    if (!fresh(key)) await ask(key);
    const url = fresh(key);
    if (!url) { state.why = state.why || 'Kosmos+ gave no link for part of the pack'; return null; }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.getTimeoutMs || GET_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { redirect: 'error', signal: ac.signal });
      if (res.status === 404) { state.why = 'part of the pack is not in the store'; return null; }
      if (res.status !== 200 || !res.body) { state.why = `the store answered ${res.status} for part of the pack`; return null; }
      const parts = [];
      let n = 0, over = false;
      for await (const c of res.body) {
        n += c.length;
        if (n > maxBytes) { over = true; break; }   // break, not abort: an abort here throws, and would read as an outage
        parts.push(Buffer.from(c));
      }
      if (over) { ac.abort(); state.why = 'part of the pack is larger than it can be'; return null; }
      done.add(key);
      return Buffer.concat(parts);
    } catch { state.why = 'part of the pack could not be fetched'; return null; } finally { clearTimeout(t); }
  }
  return { fetchObject, plan: (keys) => { order = keys.slice(); }, state };
}

/* ---- one hand-over received ---- */

function senderKeyOf(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) return null;
  const raw = Buffer.from(s, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== s) return null;
  try { return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' }); } catch { return null; }
}

/* Receive one packed hand-over into a new Kosmos. { ok, world?, because?, final? }. deps (tests): macRequest, fetch,
   base, member, maxTotalBytes, and the restore modules. */
async function receive(part, org, kp, deps) {
  const d = deps || {};
  const mac = d.macRequest;
  const fail = (because) => ({ ok: false, final: true, because });
  const senderPub = senderKeyOf(part.sender_pubkey);
  if (!senderPub) return fail('the computer that packed these agents is no longer known to Kosmos+');
  const m = part.manifest || {};
  const prefix = `handover/${org}/${part.id}/`;
  if (typeof m.key !== 'string' || m.key !== `${prefix}manifest` || typeof m.sha256 !== 'string' || !Number.isSafeInteger(m.size)) return fail('Kosmos+ has no record of this pack\'s manifest');
  const fetcher = readFetcher({ macRequest: mac, id: part.id, prefix, fetch: d.fetch, now: d.now });
  const body = await fetcher.fetchObject(m.key, { maxBytes: m.size });
  if (!body) {
    // A missing manifest is final (the pack can never arrive); a refusal or an outage is tried again.
    return /not in the store/.test(fetcher.state.why || '') ? fail('the pack never finished arriving') : { ok: false, because: fetcher.state.why };
  }
  if (body.length !== m.size || crypto.createHash('sha256').update(body).digest('base64') !== m.sha256) return fail('the pack is not the one Kosmos+ recorded');
  const snap = require('./backupsnapshot');
  const ctx = snap.handoverContext(org, part.id);
  const opened = require('./backupformat').openManifest(kp.sk, senderPub, ctx, body);
  if (!opened) return fail('the pack could not be opened with this computer\'s key for it');
  const rw = d.restoreworld || require('./restoreworld');
  const sinks = d.restoresink || require('./restoresink');
  const base = d.base;
  const made = rw.prepareRestoreWorld(base, { member: d.member || 'a colleague', memberId: part.id, kind: 'handover', now: d.now ? d.now() : undefined });
  if (!made.ok) return { ok: false, because: made.because };
  let sink;
  try { sink = sinks.createRestoreSink(made.restoreDir, {}); } catch { return { ok: false, because: 'the folder for these agents could not be used' }; }
  let result;
  try {
    const keys = Object.values(opened.objects || {});
    fetcher.plan(keys);
    result = await require('./backuprestore').restoreSnapshot({
      memberSk: kp.sk, devicePubAtSnapshot: senderPub, ctx, manifestObject: body,
      fetchChunk: (name) => (opened.objects && opened.objects[name] ? fetcher.fetchObject(opened.objects[name]) : null),
      sink, maxTotalBytes: d.maxTotalBytes || 2 ** 40,
    });
  } catch { result = { failed: ['the restore failed on this computer'] }; }
  try { sink.close({}); } catch { /* finish refuses a folder still holding the sink's entries */ }
  const failed = result && Array.isArray(result.failed) ? result.failed.length : 1;
  const restored = result && Array.isArray(result.restored) ? result.restored.length : 0;
  if (!restored || failed) {
    try { require('./worlds').hideWorld(base, made.world.id); } catch { /* left on the list, named below */ }
    return { ok: false, because: fetcher.state.why || 'the agents could not be unpacked on this computer' };
  }
  const fin = rw.finishRestoreWorld({ base, world: made.world, restoreDir: made.restoreDir, result: { ok: true, result } });
  if (!fin.ok) return { ok: false, because: fin.because || 'the agents were unpacked but could not be put in place', world: made.world };
  return { ok: true, world: made.world, restored };
}

/* ---- the tick ---- */

/* state: { running, failed: Map id -> because, done: Set }. deps (tests): org(), macRequest, root, and receive's. */
async function tick(state, deps) {
  const d = deps || {};
  if (state.running) return { skipped: true };
  state.running = true;
  try {
    const org = (d.org || (() => { const oe = require('./orgenroll'); const r = oe.mayReport() ? oe.readEnrollment() : null; return r ? r.org.id : null; }))();
    if (typeof org !== 'string' || !PLAIN.test(org)) return { ok: true, none: true };
    const mac = d.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
    const mine = await mac('POST', MINE_ROUTE, {});
    if (!mine || !mine.ok) return { ok: false, because: (mine && mine.because) || 'Kosmos+ did not answer' };
    const rows = (mine.data && Array.isArray(mine.data.handovers) ? mine.data.handovers : [])
      .filter((h) => h && h.side === 'receive' && typeof h.id === 'string' && PLAIN.test(h.id));
    for (const part of rows) {
      if (state.done.has(part.id) || state.failed.has(part.id)) continue;
      let kp = readKey(part.id, d.root);
      if (kp && kp.problem) { state.failed.set(part.id, kp.problem); return { ok: false, id: part.id, because: kp.problem }; }
      if (part.state === 'requested') {
        if (!kp) {
          const made = require('./hpke').hpkeKeyPair();
          try { writeKey(part.id, made, d.root); } catch { return { ok: false, id: part.id, because: 'the hand-over key could not be kept on this computer, so none was sent' }; }
          kp = readKey(part.id, d.root);
          if (!kp || kp.problem) return { ok: false, id: part.id, because: 'the hand-over key could not be read back, so none was sent' };
        }
        const r = await mac('POST', KEY_ROUTE, { id: part.id, pubkey: b64(kp.pk) });
        return { ok: !!(r && r.ok), id: part.id, because: r && r.ok ? undefined : (r && r.because) };
      }
      if (!kp) continue;   // a part keyed by another computer of this member; nothing to open it with here
      if (typeof part.seal_pub === 'string' && part.seal_pub !== b64(kp.pk)) {
        state.failed.set(part.id, 'the pack is sealed to a key this computer does not hold');
        return { ok: false, id: part.id, because: state.failed.get(part.id) };
      }
      if (part.state !== 'packed' && part.state !== 'receiving') continue;
      const r = await (d.receive || receive)(part, org, kp, Object.assign({ macRequest: mac }, d));
      if (r.ok || r.final) {
        const told = await mac('POST', DONE_ROUTE, { id: part.id, ok: r.ok === true });
        if (told && told.ok) {
          if (r.ok) { state.done.add(part.id); deleteKey(part.id, d.root); } else state.failed.set(part.id, r.because);
        }
      }
      return { ok: r.ok === true, id: part.id, because: r.because };   // one hand-over per tick
    }
    return { ok: true, none: true };
  } catch {
    return { ok: false, because: 'the hand-over could not be checked' };
  } finally { state.running = false; }
}

function startTick(deps) {
  const d = deps || {};
  const state = { running: false, failed: new Map(), done: new Set() };
  const t = (d.setInterval || setInterval)(() => { tick(state, d).catch(() => {}); }, d.everyMs || EVERY_MS);
  if (t && typeof t.unref === 'function') t.unref();
  return Object.assign(() => (d.clearInterval || clearInterval)(t), { tick: () => tick(state, d), state });
}

/* Off unless KOSMOS_ORG_HANDOVER=1 in the board's environment, the same switch as the sender's (handoversend.enabled). */
let here = null;
function startHere(env) { if (!require('./handoversend').enabled(env)) return null; if (!here) here = startTick({ base: baseOf() }); return here; }
function baseOf() {
  try { return require('./worldenv').bootedBaseDir() || require('./worlds').baseRoot(require('./worlds').preWorldEnv(process.env)); } catch { return null; }
}

module.exports = { startHere, MINE_ROUTE, KEY_ROUTE, READ_ROUTE, DONE_ROUTE, READ_KEYS, allowHttpForTests, readKey, writeKey, deleteKey, urlProblem, readFetcher, senderKeyOf, receive, tick, startTick };
