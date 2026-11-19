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
 *   packing     wait for the leaving computer. A seal_pub that is not this computer's key (when the row carries one; a
 *               pack sealed to another key does not open either), or a key that is lost or
 *               damaged: POST /done {ok:false} (final, said to the company).
 *   packed / receiving
 *               fetch the manifest through /read, check it is the one the coordinator recorded (sha256, size), open it
 *               with the one-time secret and the packing computer's key (sender_pubkey), and restore into a Kosmos made
 *               by the restore path (engine/restoreworld.js, kind 'handover': "Handed over: a colleague, <date>";
 *               /mine names no member, so the console slice names the person when it can). Agents
 *               arrive STOPPED and are enabled on the restore review screen (#5536 4c); nothing here starts one. Then
 *               POST /done {id, ok: true} and delete the key file.
 *               Final, and POST /done {id, ok: false} so the company sees it failed and can start again: a missing
 *               sender_pubkey (the packing computer was retired); a manifest still missing after MISSING_GRACE_MS (the
 *               coordinator marks `packed` when it grants the manifest, before the upload lands: handoversend's KNOWN
 *               note); one that is not the recorded one, does not open, or names files outside this hand-over; a pack
 *               restore refuses whole, or a file in it that arrived but is not what was signed. Anything else (a
 *               chunk that did not arrive, this computer failing) is tried again after RETRY_MS, MAX_ATTEMPTS times
 *               in all, then final. A failed try removes its restore folder and hides its Kosmos (removing it too
 *               only while nothing is in its workers or projects: undoTry). Never a skipped check. A refusal is noted
 *               beside the key before /done {ok: false}, so a /done that does not go through is sent again alone.
 *               Before /done {ok: true} the key file is marked `received`, so a lost answer sends /done again and
 *               never makes a second copy.
 *
 * Chunks are read through /read (at most READ_KEYS keys a call): every URL must be https, on a named host (never an IP
 * address or localhost), with a path ending in its key; no redirect is followed and no body is read past its cap.
 * Every byte is then checked against the device-signed manifest by backuprestore.restoreSnapshot, so a wrong URL reads
 * as a failure, never as the colleague's files. Not restorefetch.readGrantFetcher: its grant contract needs a numeric
 * key epoch and a period, which a hand-over does not have.
 *
 * KNOWN: the URL rules refuse a bare IP address and localhost, not a name that resolves to a private address, so a
 * hostile coordinator could still point this computer's reads at its own network; nothing it fetches is trusted.
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
const URL_LIFETIME_MS = 4 * 60 * 1000;         // asked for again before kosmos-relay backup.rs READ_GRANT_SECS (5 min)
const GET_TIMEOUT_MS = 60 * 1000;
const MANIFEST_TIMEOUT_MS = 10 * 60 * 1000;
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

/* Kept beside the key: received / restoring (a Kosmos id), expect (the agent folders a restore produced, noted before
   its finish), attempts (a count), missingSince / outageSince (ms, when the wait began), final (why it ended). */
const META = ['received', 'restoring', 'expect', 'attempts', 'missingSince', 'outageSince', 'final'];
/* { sk, pk, ...META } from disk, null when there is none, or { problem } when there is one that cannot be used. */
function readKey(id, root) {
  let text;
  try { text = fs.readFileSync(keyFile(id, root), 'utf8'); } catch (err) {
    return err && err.code === 'ENOENT' ? null : { problem: 'the hand-over key on this computer could not be read', transient: true };
  }
  try {
    const j = JSON.parse(text);
    const sk = Buffer.from(String(j.sk), 'base64'), pk = Buffer.from(String(j.pk), 'base64');
    if (j.id !== id || sk.length !== 32 || pk.length !== 32 || b64(pk) !== j.pk) return { problem: 'the hand-over key on this computer is damaged' };
    // What this computer recorded about the hand-over, beside its key, so a restart keeps it (META).
    const meta = {};
    for (const k of META) if (j[k] !== undefined && j[k] !== null) meta[k] = j[k];
    return Object.assign({ sk, pk }, meta);
  } catch { return { problem: 'the hand-over key on this computer is damaged' }; }
}

/* Written whole (a temp file, fsynced, renamed), mode 600 in a 700 folder. Throws on failure: the caller sends nothing. */
function writeKey(id, kp, root, meta) {
  const dir = keyDir(root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const tmp = path.join(dir, `.${id}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const keep = {};
  for (const k of META) if (meta && meta[k] !== undefined && meta[k] !== null) keep[k] = meta[k];
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(Object.assign({ id, sk: b64(kp.sk), pk: b64(kp.pk), at: new Date().toISOString() }, keep)) + '\n');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, keyFile(id, root));
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* the folder is 700; nothing else reads it */ }
    throw err;
  }
}

/* Change what is kept beside the key (patch: META fields, null clears one). Throws when it cannot be kept. */
function updateKey(id, root, patch) {
  const kp = readKey(id, root);
  if (!kp || kp.problem) throw new Error('no key to update');
  const meta = {};
  for (const k of META) meta[k] = Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : kp[k];
  writeKey(id, kp, root, meta);
}

/* Removed (its bytes overwritten first, best effort only: a copy-on-write disk keeps old blocks). */
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
  if (url.username || url.password) return 'a link carrying a name or password';
  if (!allowHttp && url.port && url.port !== '443') return 'a link to another port';
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!allowHttp && (net.isIP(host) || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') || host.endsWith('.local'))) return 'not a named host';
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
  const state = { why: null, missing: false };
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
    state.why = null; state.missing = false; state.tooBig = false; state.status = null;
    const maxBytes = (o && o.maxBytes) || MAX_CHUNK_BYTES;
    if (typeof key !== 'string' || !key.startsWith(prefix) || !PLAIN.test(key.slice(prefix.length))) { state.why = 'the pack names an object outside this hand-over'; return null; }
    if (!fresh(key)) await ask(key);
    const url = fresh(key);
    if (!url) { state.why = state.why || 'Kosmos+ gave no link for part of the pack'; return null; }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), (o && o.timeoutMs) || opts.getTimeoutMs || GET_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { redirect: 'error', signal: ac.signal });
      if (res.status === 404) { state.why = 'part of the pack is not in the store'; state.missing = true; return null; }
      if (res.status !== 200 || !res.body) { state.why = `the store answered ${res.status} for part of the pack`; state.status = res.status; return null; }
      const parts = [];
      let n = 0, over = false;
      for await (const c of res.body) {
        n += c.length;
        if (n > maxBytes) { over = true; break; }   // break, not abort: an abort here throws, and would read as an outage
        parts.push(Buffer.from(c));
      }
      if (over) { ac.abort(); state.why = 'part of the pack is larger than it can be'; state.tooBig = true; return null; }
      done.add(key);
      return Buffer.concat(parts);
    } catch { state.why = 'part of the pack could not be fetched'; return null; } finally { clearTimeout(t); }
  }
  return { fetchObject, plan: (keys) => { order = [...new Set(keys)]; }, state };
}

/* ---- one hand-over received ---- */

function senderKeyOf(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) return null;
  const raw = Buffer.from(s, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== s) return null;
  try { return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' }); } catch { return null; }
}

/* restoreSnapshot's own sentences for a chunk that did not arrive (restorerun FETCH_FAILURES): those may pass on a later
   try; any other failed file (a chunk that arrived and was wrong, a path the pack may not write) is the pack's. */
const FETCH_FAILURES = new Set(['a chunk could not be fetched', 'a chunk is missing']);
/* restoreSnapshot's sentences for THIS computer failing (no room left, a file it could not write): tried again, and said
   as this computer's, never as the sender's. */
const LOCAL_FAILURES = new Set(['the restore is over its byte budget', 'the file could not be written', 'the store sent more data than the restore could use']);
const MAX_MANIFEST_OBJECT = 256 * 1024 * 1024;   // backuprestore's own bound
const MAX_PACK_BYTES = 500 * 1024 * 1024;        // kosmos-relay handover.rs MAX_PACK_BYTES: no pack is larger
const MISSING_GRACE_MS = 60 * 60 * 1000;         // a manifest the sender may still be uploading (handoversend KNOWN)

/* What this computer can write for a pack: the smaller of the largest pack and its free space less a margin. */
function diskBudget(dir, d) {
  if (d && Number.isSafeInteger(d.maxTotalBytes)) return d.maxTotalBytes;
  let free = MAX_PACK_BYTES;
  try { const st = fs.statfsSync(dir); free = Number(st.bavail) * Number(st.bsize) - 1024 * 1024 * 1024; } catch { /* the pack bound alone */ }
  return Math.max(0, Math.min(MAX_PACK_BYTES, free));
}

/* (Only for undoTry, which removes the restore folder first: `restored/` may hold anything here.) A small window
   remains between this check and the removal, in which a person switching into the Kosmos could lose it; hiding it
   first keeps that window short.
   A Kosmos folder holding only what prepareRestoreWorld makes (measured: Kosmos/, projects/, workers/, the restore
   folder and the restore mark), with its data, projects and workers folders all empty: nothing was finished into it
   and nothing a person made is in it. Anything else, or anything unreadable, is not untouched. */
const FRESH = new Set(['Kosmos', 'projects', 'workers', 'restored', 'restored-world.json']);
function untouched(dir) {
  try {
    const top = fs.readdirSync(dir);
    if (!top.every((n) => FRESH.has(n))) return false;
    for (const n of ['Kosmos', 'projects', 'workers']) {
      if (!top.includes(n)) continue;
      if (fs.readdirSync(path.join(dir, n)).length) return false;
    }
    return true;
  } catch { return false; }
}
/* Whether a finish of this Kosmos put the copy in place: an agent folder the restore produced (`expect`, noted before
   the finish) is in its workers folder. An agent a person made there does not pass: it is not one of the expected
   names. */
function finished(base, world, expect) {
  if (!Array.isArray(expect) || !expect.length) return false;
  try {
    const workers = require('./worlds').envOverridesFor(base, world).AGENT_WORKFORCE_WORKERS;
    // Some, not every: finish may hold an agent folder back (not a plain folder), and the rest are still the copy.
    return expect.some((n) => typeof n === 'string' && PLAIN.test(n) && fs.existsSync(path.join(workers, n)));
  } catch { return false; }
}
/* The agent folder names a restore produced (its restored paths are workers/<seg>/...). */
function agentsOf(restored) {
  return [...new Set((restored || []).map((p) => /^workers\/([^/]+)\//.exec(String(p))).filter(Boolean).map((m) => m[1]).filter((n) => PLAIN.test(n)))];
}

/* Take out what one try wrote. The Kosmos it made is on the person's list from the moment it is made, so a person may
   have used it before this runs: only the restore folder (this module's own, RESTORE_DIR) is always removed. The
   whole Kosmos folder goes only when hiding it worked AND it is untouched (below); otherwise it is hidden and its
   files are left. A hidden row keeps
   its name in use, so a hand-over that fails many times can run out of the day's names, which then counts as a try. */
function undoTry(base, world) {
  const w = require('./worlds');
  let hidden = false;
  try { w.hideWorld(base, world.id); hidden = true; } catch { /* not hidden: its folder is not removed */ }
  let dir = null;
  try { dir = w.worldBaseDir(base, world); } catch { dir = null; }
  if (!dir || !path.isAbsolute(dir) || !world.id || world.id === w.DEFAULT_ID) return;
  // The restore folder holds what a finish did not move (profiles, transcripts, held-back folders) once anything was
  // finished in: removed only while the Kosmos's workers folder is still empty, so nothing a finish needs is lost.
  let workersEmpty = false;
  try { workersEmpty = fs.readdirSync(w.envOverridesFor(base, world).AGENT_WORKFORCE_WORKERS).length === 0; } catch (e) { workersEmpty = !!e && e.code === 'ENOENT'; }
  if (workersEmpty) { try { fs.rmSync(path.join(dir, require('./restoreworld').RESTORE_DIR), { recursive: true, force: true }); } catch { /* left */ } }
  if (!hidden) return;
  if (!untouched(dir)) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* hidden; its files stay until removed by hand */ }
}

/* Receive one packed hand-over into a new Kosmos. { ok, world?, because?, final?, missing? }. final: the pack itself
   decides it (no retry can change it); otherwise the tick tries again later. deps (tests): macRequest, fetch, base,
   member, maxTotalBytes, now, and the restore modules. */
async function receive(part, org, kp, deps) {
  const d = deps || {};
  const mac = d.macRequest;
  const fail = (because) => ({ ok: false, final: true, because });
  const senderPub = senderKeyOf(part.sender_pubkey);
  if (!senderPub) return fail('the computer that packed these agents is no longer known to Kosmos+');
  const m = part.manifest || {};
  const prefix = `handover/${org}/${part.id}/`;
  if (typeof m.key !== 'string' || m.key !== `${prefix}manifest` || typeof m.sha256 !== 'string' || !Number.isSafeInteger(m.size) || m.size < 1) return fail('Kosmos+ has no record of this pack\'s manifest');
  if (m.size > MAX_MANIFEST_OBJECT) return fail('the pack\'s list of files is larger than one can be');
  const fetcher = readFetcher({ macRequest: mac, id: part.id, prefix, fetch: d.fetch, now: d.now });
  const body = await fetcher.fetchObject(m.key, { maxBytes: m.size, timeoutMs: MANIFEST_TIMEOUT_MS });   // up to 256 MB on a slow link
  if (!body) {
    const st = fetcher.state;
    // Larger than the record says: the store is serving something else, final. Not there: counted against the grace.
    // A 4xx: an attempt. No answer at all, or a 5xx: an outage, which spends no attempt.
    if (st.tooBig) return fail('the pack in the store is not the one Kosmos+ recorded');
    if (st.missing) return { ok: false, missing: true, because: st.why };
    if (Number.isSafeInteger(st.status) && st.status >= 400 && st.status < 500) return { ok: false, because: st.why };
    return { ok: false, outage: true, because: st.why };
  }
  if (body.length !== m.size || crypto.createHash('sha256').update(body).digest('base64') !== m.sha256) return fail('the pack is not the one Kosmos+ recorded');
  const snap = require('./backupsnapshot');
  const ctx = snap.handoverContext(org, part.id);
  const opened = require('./backupformat').openManifest(kp.sk, senderPub, ctx, body);
  if (!opened) return fail('the pack could not be opened with this computer\'s key for it');
  const objects = opened.objects && typeof opened.objects === 'object' ? opened.objects : {};
  // Every chunk a file names must have a stored object: a manifest that does not cover its own chunks can never restore.
  const covered = Array.isArray(opened.files) && opened.files.every((x) => !x || !Array.isArray(x.chunks) || x.chunks.every((c) => typeof c === 'string' && Object.prototype.hasOwnProperty.call(objects, c)));
  if (!covered) return fail('the pack\'s list of files names parts it does not hold');
  const keys = Object.values(objects);
  // A signed manifest naming an object outside this hand-over: the coordinator would refuse every batch holding it.
  if (keys.some((k) => typeof k !== 'string' || !k.startsWith(prefix) || !PLAIN.test(k.slice(prefix.length)))) return fail('the pack names files outside this hand-over');
  const rw = d.restoreworld || require('./restoreworld');
  const sinks = d.restoresink || require('./restoresink');
  const base = d.base;
  // memberId is the hand-over's id here: prepareRestoreWorld uses it only for the name's tag, so two hand-overs on one
  // day are told apart.
  const made = rw.prepareRestoreWorld(base, { member: d.member || 'a colleague', memberId: part.id, kind: 'handover', now: d.now ? d.now() : undefined });
  if (!made.ok) return { ok: false, because: made.because };
  // Recorded before anything is written into it, so a try that dies part way is taken out by the next tick.
  try { updateKey(part.id, d.root, { restoring: made.world.id }); } catch { undoTry(base, made.world); return { ok: false, because: 'this computer could not note the hand-over it is unpacking' }; }
  let sink;
  try { sink = sinks.createRestoreSink(made.restoreDir, {}); } catch { undoTry(base, made.world); return { ok: false, because: 'the folder for these agents could not be used' }; }
  const budget = diskBudget(made.restoreDir, d);
  let result;
  try {
    fetcher.plan(keys);
    result = await require('./backuprestore').restoreSnapshot({
      memberSk: kp.sk, devicePubAtSnapshot: senderPub, ctx, manifestObject: body,
      fetchChunk: (name, o) => (opened.objects && opened.objects[name] ? fetcher.fetchObject(opened.objects[name], o) : null),
      sink, maxTotalBytes: budget,
    });
  } catch { result = null; }
  try { sink.close({}); } catch { /* finish refuses a folder still holding the sink's entries */ }
  const failed = result && Array.isArray(result.failed) ? result.failed : null;
  const restored = result && Array.isArray(result.restored) ? result.restored.length : 0;
  if (!failed || failed.length || !restored) {
    undoTry(base, made.world);
    // A pack restore refused whole (overBound, malformed) or a file that arrived wrong is the pack's; a chunk that did not
    // arrive, or this computer failing, may pass later.
    const passing = (x) => x && (FETCH_FAILURES.has(x.why) || LOCAL_FAILURES.has(x.why));
    if (result && !failed) return fail('the pack is not one this computer can unpack');
    if (failed && failed.length && !failed.every(passing)) return fail('part of the pack is not what its sender signed');
    if (failed && !failed.length && !restored) return fail('the pack holds no files');
    // Over the byte budget when free disk was not the limit: the pack asks for more than any pack may hold.
    if (budget === MAX_PACK_BYTES && failed && failed.some((x) => x && x.why === 'the restore is over its byte budget')) return fail('the pack asks for more room than one hand-over can hold');
    if (failed && failed.some((x) => x && LOCAL_FAILURES.has(x.why))) return { ok: false, because: 'the agents could not be written on this computer (no room left, or a file that could not be written)' };
    return { ok: false, because: fetcher.state.why || 'the agents could not be unpacked on this computer' };
  }
  const expect = agentsOf(result.restored);
  if (!expect.length) { undoTry(base, made.world); return fail('the pack holds no agent'); }
  try { updateKey(part.id, d.root, { expect }); } catch { undoTry(base, made.world); return { ok: false, because: 'this computer could not note the hand-over it is unpacking' }; }
  const fin = rw.finishRestoreWorld({ base, world: made.world, restoreDir: made.restoreDir, result: { ok: true, result } });
  // A finish that fails part way is finished again next tick in the same Kosmos (restoreworld: finishing again carries
  // on), so `restoring` and `expect` stay; nothing is taken out here.
  if (!fin.ok) return { ok: false, because: fin.because || 'the agents were unpacked but could not be put in place' };
  if (!finished(base, made.world, expect)) { undoTry(base, made.world); return fail('no agent in the pack could be put in place'); }
  // Received: noted before /done, so a lost answer sends /done again, never a second copy.
  // If that note cannot be kept, `restoring` still names this Kosmos and it is finished, so the next tick reads it as
  // received (finished()) rather than making a second copy.
  try { updateKey(part.id, d.root, { received: made.world.id, restoring: null, expect: null }); } catch { /* see above */ }
  // heldBack: agent folders finish set aside (not plain folders), so not listed. The agents that did arrive are usable,
  // so done is still ok; the count is kept for the console slice to say.
  return { ok: true, world: made.world, restored, heldBack: Array.isArray(fin.heldBack) ? fin.heldBack.length : 0 };
}

/* Finish a Kosmos again whose finish stopped part way (restoreworld: finishing again carries on). It refuses a restore
   that never closed its sink (a try that died mid-restore), which is then taken out by the caller. */
function refinish(base, id) {
  try {
    const w = require('./worlds');
    const world = w.readRegistry(base).worlds.find((x) => x && x.id === id);
    if (!world || world.hiddenAt) return false;
    const rw = require('./restoreworld');
    return rw.finishRestoreWorld({ base, world, restoreDir: path.join(w.worldBaseDir(base, world), rw.RESTORE_DIR), result: { ok: true, result: { restored: [], failed: [] } } }).ok === true;
  } catch { return false; }
}

/* A Kosmos this module made for this hand-over that nothing records (the board stopped between making it and noting it):
   found by the tag its name carries (restoreworld.memberTag of the hand-over id), and taken out only while untouched. */
function tidyOrphans(base, id) {
  let rows = [];
  try { rows = require('./worlds').readRegistry(base).worlds; } catch { return; }
  const tag = require('./restoreworld').memberTag(id);
  if (!tag) return;
  for (const w of rows) {
    if (!w || w.hiddenAt || typeof w.name !== 'string' || !w.name.startsWith('Handed over: ') || !w.name.includes(`(${tag}`)) continue;
    let dir = null;
    try { dir = require('./worlds').worldBaseDir(base, w); } catch { dir = null; }
    if (dir && untouched(dir)) undoTry(base, w);
  }
}

/* ---- the tick ---- */

const STALE_KEY_MS = 24 * 60 * 60 * 1000;
const SEEN_TOUCH_MS = 60 * 60 * 1000;
const OUTAGE_LIMIT_MS = 24 * 60 * 60 * 1000;   // Kosmos+ or the store not answering this long ends the hand-over
/* A key whose hand-over Kosmos+ no longer lists (cancelled, the member removed, the record closed another way), once it
   is STALE_KEY_MS old: removed, so no one-time secret outlives its hand-over. Only this module's own key files. */
function sweepKeys(open, now, root, base) {
  let names = [];
  try { names = fs.readdirSync(keyDir(root)); } catch { return; }
  for (const n of names) {
    const m = /^([A-Za-z0-9_-]{1,64})\.key\.json$/.exec(n);
    if (!m) continue;
    const f = path.join(keyDir(root), n);
    let st;
    try { st = fs.lstatSync(f); } catch { continue; }
    if (!st.isFile()) continue;
    // Listed: its age restarts (at most hourly), so the day counts from when Kosmos+ last listed it, not from when it
    // was made. A computer off for days, then one empty answer, does not lose a key still in use.
    if (open.has(m[1])) { if (now - st.mtimeMs >= SEEN_TOUCH_MS) { try { fs.utimesSync(f, new Date(now), new Date(now)); } catch { /* next tick */ } } continue; }
    if (now - st.mtimeMs < STALE_KEY_MS) continue;
    const kp = readKey(m[1], root);
    if (kp && kp.restoring && base && !kp.received && !finished(base, { id: kp.restoring }, kp.expect)) undoTry(base, { id: kp.restoring });   // never leave a half-made Kosmos behind it; a finished one is left
    deleteKey(m[1], root);
  }
}

const RETRY_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MISSING_RECHECK_MS = 10 * 60 * 1000;   // how often a manifest still being uploaded is looked for

/* state: { running, closed: Set, retryAt: Map id -> ms } (attempts and missingSince are kept beside the key). deps
   (tests): org(), macRequest, root, now(), writeKey, and receive's. */
async function tick(state, deps) {
  const d = deps || {};
  if (state.running) return { skipped: true };
  state.running = true;
  try {
    const org = (d.org || (() => { const oe = require('./orgenroll'); const r = oe.mayReport() ? oe.readEnrollment() : null; return r ? r.org.id : null; }))();
    if (typeof org !== 'string' || !PLAIN.test(org)) return { ok: true, none: true };
    const now = (d.now || Date.now)();
    const mac = d.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
    const mine = await mac('POST', MINE_ROUTE, {});
    if (!mine || !mine.ok) return { ok: false, because: (mine && mine.because) || 'Kosmos+ did not answer' };
    const rows = (mine.data && Array.isArray(mine.data.handovers) ? mine.data.handovers : [])
      .filter((h) => h && h.side === 'receive' && typeof h.id === 'string' && PLAIN.test(h.id));
    sweepKeys(new Set(rows.map((h) => h.id)), now, d.root, d.base);
    /* Tell the coordinator, and only then forget: the key file goes once /done has been accepted. A /done that is not
       accepted is sent again next tick, never received again (the key file's `received` mark). */
    const close = async (part, ok, because) => {
      // A refusal is noted before /done, so a /done that does not go through is sent again without receiving again.
      if (!ok) {
        // A half-made Kosmos from an earlier try is taken out before the hand-over ends, never left on the list.
        const k = readKey(part.id, d.root);
        if (k && k.restoring && !k.received && d.base && !finished(d.base, { id: k.restoring }, k.expect)) undoTry(d.base, { id: k.restoring });   // a finished copy is the person's now: left
        try { updateKey(part.id, d.root, { final: because || 'the hand-over could not be finished', restoring: null, expect: null }); } catch { /* no key file: nothing to receive again either */ }
      }
      const told = await mac('POST', DONE_ROUTE, { id: part.id, ok });
      if (told && told.ok) { state.closed.add(part.id); deleteKey(part.id, d.root); return { ok, id: part.id, because }; }
      return null;   // not accepted: sent again next tick; the rows after it go on
    };
    let last = null;   // the last row acted on, for the caller; waiting rows never stop the rows after them
    /* close, and when /done was not accepted, go on to the next row (it is sent again next tick). */
    const closing = async (part, ok, because) => {
      const r = await close(part, ok, because);
      if (!r) last = { ok: false, id: part.id, because: 'Kosmos+ did not take the answer for this hand-over yet' };
      return r;
    };
    for (const part of rows) {
      if (state.closed.has(part.id)) continue;
      if ((state.retryAt.get(part.id) || 0) > now) continue;
      let kp = readKey(part.id, d.root);
      if (part.state === 'requested') {
        // Nothing has been accepted yet, so a damaged key is replaced rather than ending the hand-over.
        if (kp && kp.transient) { last = { ok: false, id: part.id, because: kp.problem }; continue; }   // may read next time; it may be the key already sent
        if (kp && kp.problem) { deleteKey(part.id, d.root); kp = null; }
        if (!kp) {
          const made = require('./hpke').hpkeKeyPair();
          try { (d.writeKey || writeKey)(part.id, made, d.root); } catch { last = { ok: false, id: part.id, because: 'the hand-over key could not be kept on this computer, so none was sent' }; continue; }
          kp = readKey(part.id, d.root);
          if (!kp || kp.problem) { last = { ok: false, id: part.id, because: 'the hand-over key could not be read back, so none was sent' }; continue; }
        }
        const r = await mac('POST', KEY_ROUTE, { id: part.id, pubkey: b64(kp.pk) });
        last = { ok: !!(r && r.ok), id: part.id, because: r && r.ok ? undefined : (r && r.because) };
        continue;
      }
      if (part.state !== 'packing' && part.state !== 'packed' && part.state !== 'receiving') continue;
      let z;
      // Past `requested` this computer's key was sent; without it (lost, or damaged) the pack can never be opened here.
      // An unreadable key (a disk error) may read next time: wait. A damaged or missing one never will.
      if (kp && kp.transient) { last = { ok: false, id: part.id, because: kp.problem }; continue; }
      if (!kp || kp.problem) { if ((z = await closing(part, false, (kp && kp.problem) || 'the key for this hand-over is no longer on this computer'))) return z; continue; }
      if (typeof part.seal_pub === 'string' && part.seal_pub !== b64(kp.pk)) { if ((z = await closing(part, false, 'the pack is sealed to a key this computer does not hold'))) return z; continue; }
      if (part.state === 'packing') continue;
      // Decided on an earlier tick; only the /done is owed.
      if (kp.received) { if ((z = await closing(part, true))) return z; continue; }
      if (kp.final) { if ((z = await closing(part, false, String(kp.final)))) return z; continue; }
      if (!d.base) { last = { ok: false, id: part.id, because: 'this computer could not find where its Kosmoses live' }; continue; }   // not the pack's fault: no attempt spent
      if (kp.restoring) {
        // A try that stopped part way. Finished (its agents were moved in) but not noted: it is the received copy.
        // Not finished: take it out before trying again.
        // Finished again first (it carries on whatever an earlier finish left), and received only once that finish is
        // ok: an agent folder in place alone may be a finish that stopped before the rest.
        // If finishing again keeps failing but the agents are already in place (a person may have added a project, or
        // hidden the Kosmos), the copy is still received: never a second one, never this one hidden. Its leftovers
        // stay in its restore folder for the review screen.
        refinish(d.base, kp.restoring);
        if (finished(d.base, { id: kp.restoring }, kp.expect)) {
          try { updateKey(part.id, d.root, { received: kp.restoring, restoring: null, expect: null }); } catch { /* restoring still says it */ }
          if ((z = await closing(part, true))) return z;
          continue;
        }
        undoTry(d.base, { id: kp.restoring });
        try { updateKey(part.id, d.root, { restoring: null, expect: null }); } catch { last = { ok: false, id: part.id, because: 'this computer could not tidy an unfinished hand-over' }; continue; }
      }
      tidyOrphans(d.base, part.id);
      // Anything receive throws is a failed try like any other (counted below), never an escape past the ceiling.
      let r;
      try { r = await (d.receive || receive)(part, org, kp, Object.assign({ macRequest: mac }, d)); } catch { r = null; }
      if (!r || typeof r !== 'object') r = { ok: false, because: 'the agents could not be unpacked on this computer' };
      if (r.ok) { if ((z = await closing(part, true))) return z; continue; }
      if (r.final) { if ((z = await closing(part, false, r.because))) return z; continue; }
      if (r.missing) {
        // The coordinator marks `packed` before the manifest lands; give the sender MISSING_GRACE_MS to finish its upload,
        // counted from the first miss this computer recorded (kept beside the key, so a restart does not reset it).
        const since = Number.isSafeInteger(kp.missingSince) ? kp.missingSince : now;
        if (!Number.isSafeInteger(kp.missingSince)) { try { updateKey(part.id, d.root, { missingSince: now }); } catch { /* counted from now again next tick */ } }
        if (now - since >= MISSING_GRACE_MS) { if ((z = await closing(part, false, 'the pack never finished arriving'))) return z; continue; }
        state.retryAt.set(part.id, now + MISSING_RECHECK_MS);
        last = { ok: false, id: part.id, because: r.because };
        continue;
      }
      if (r.outage) {
        // Kosmos+ or the store did not answer: not the pack's fault, so no attempt is spent; but not forever either.
        const since = Number.isSafeInteger(kp.outageSince) ? kp.outageSince : now;
        if (!Number.isSafeInteger(kp.outageSince)) { try { updateKey(part.id, d.root, { outageSince: now }); } catch { /* from now again */ } }
        if (now - since >= OUTAGE_LIMIT_MS) { if ((z = await closing(part, false, 'Kosmos+ could not give this computer the pack for a day; your company can start the hand-over again'))) return z; continue; }
        state.retryAt.set(part.id, now + MISSING_RECHECK_MS);
        last = { ok: false, id: part.id, because: r.because };
        continue;
      }
      // Kept beside the key, so the ceiling holds across restarts.
      const tries = (Number.isSafeInteger(kp.attempts) ? kp.attempts : 0) + 1;
      try { updateKey(part.id, d.root, { attempts: tries, missingSince: null, outageSince: null }); } catch { /* counted in memory only this time */ }
      if (tries >= MAX_ATTEMPTS) { if ((z = await closing(part, false, `this computer tried ${tries} times and could not unpack the agents`))) return z; continue; }
      state.retryAt.set(part.id, now + RETRY_MS);
      return { ok: false, id: part.id, because: r.because };   // a real attempt: one per tick
    }
    if (last) return last;
    return { ok: true, none: true };
  } catch {
    return { ok: false, because: 'the hand-over could not be checked' };
  } finally { state.running = false; }
}

function startTick(deps) {
  const d = deps || {};
  const state = newState();
  const t = (d.setInterval || setInterval)(() => { tick(state, d).catch(() => {}); }, d.everyMs || EVERY_MS);
  if (t && typeof t.unref === 'function') t.unref();
  return Object.assign(() => (d.clearInterval || clearInterval)(t), { tick: () => tick(state, d), state });
}
function newState() { return { running: false, closed: new Set(), retryAt: new Map() }; }

/* Off unless KOSMOS_ORG_HANDOVER=1 in the board's environment, the same switch as the sender's (handoversend.enabled). */
let here = null;
function startHere(env) { if (!require('./handoversend').enabled(env)) return null; if (!here) here = startTick({ base: baseOf() }); return here; }
function baseOf() {
  try { return require('./worldenv').bootedBaseDir() || require('./worlds').baseRoot(require('./worlds').preWorldEnv(process.env)); } catch { return null; }
}

module.exports = { startHere, newState, sweepKeys, STALE_KEY_MS, MAX_ATTEMPTS, RETRY_MS, MISSING_GRACE_MS, updateKey, MISSING_RECHECK_MS, MINE_ROUTE, KEY_ROUTE, READ_ROUTE, DONE_ROUTE, READ_KEYS, allowHttpForTests, readKey, writeKey, deleteKey, urlProblem, readFetcher, senderKeyOf, receive, tick, startTick };
