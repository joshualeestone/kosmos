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

/* Kept beside the key: received / restoring (a Kosmos id), attempts (a count), missingSince (ms), final (why it ended). */
const META = ['received', 'restoring', 'attempts', 'missingSince', 'final'];
/* { sk, pk, ...META } from disk, null when there is none, or { problem } when there is one that cannot be used. */
function readKey(id, root) {
  let text;
  try { text = fs.readFileSync(keyFile(id, root), 'utf8'); } catch (err) {
    return err && err.code === 'ENOENT' ? null : { problem: 'the hand-over key on this computer could not be read' };
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
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
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
    const maxBytes = (o && o.maxBytes) || MAX_CHUNK_BYTES;
    if (typeof key !== 'string' || !key.startsWith(prefix) || !PLAIN.test(key.slice(prefix.length))) { state.why = 'the pack names an object outside this hand-over'; return null; }
    if (!fresh(key)) await ask(key);
    const url = fresh(key);
    if (!url) { state.why = state.why || 'Kosmos+ gave no link for part of the pack'; return null; }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), opts.getTimeoutMs || GET_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { redirect: 'error', signal: ac.signal });
      if (res.status === 404) { state.why = 'part of the pack is not in the store'; state.missing = true; return null; }
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

/* Take out what one try wrote. The Kosmos it made is on the person's list from the moment it is made, so a person may
   have used it before this runs: only the restore folder (this module's own, RESTORE_DIR) is always removed. The
   whole Kosmos folder goes only when hiding it worked AND its workers and projects folders are still empty (nothing
   moved there by a finish, nothing a person made); otherwise it is hidden and its files are left. A hidden row keeps
   its name in use, so a hand-over that fails many times can run out of the day's names, which then counts as a try. */
function undoTry(base, world) {
  const w = require('./worlds');
  let hidden = false;
  try { w.hideWorld(base, world.id); hidden = true; } catch { /* not hidden: its folder is not removed */ }
  let dir = null;
  try { dir = w.worldBaseDir(base, world); } catch { dir = null; }
  if (!dir || !path.isAbsolute(dir) || !world.id || world.id === w.DEFAULT_ID) return;
  try { fs.rmSync(path.join(dir, require('./restoreworld').RESTORE_DIR), { recursive: true, force: true }); } catch { /* left */ }
  if (!hidden) return;
  const empty = (p) => { try { return fs.readdirSync(p).length === 0; } catch (e) { return !!e && e.code === 'ENOENT'; } };
  let roots = {};
  try { roots = w.envOverridesFor(base, world); } catch { return; }
  if (!roots.AGENT_WORKFORCE_WORKERS || !roots.AGENT_WORKFORCE_PROJECTS) return;
  if (!empty(roots.AGENT_WORKFORCE_WORKERS) || !empty(roots.AGENT_WORKFORCE_PROJECTS)) return;
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
  const body = await fetcher.fetchObject(m.key, { maxBytes: m.size });
  if (!body) return { ok: false, missing: fetcher.state.missing === true, because: fetcher.state.why };
  if (body.length !== m.size || crypto.createHash('sha256').update(body).digest('base64') !== m.sha256) return fail('the pack is not the one Kosmos+ recorded');
  const snap = require('./backupsnapshot');
  const ctx = snap.handoverContext(org, part.id);
  const opened = require('./backupformat').openManifest(kp.sk, senderPub, ctx, body);
  if (!opened) return fail('the pack could not be opened with this computer\'s key for it');
  const keys = Object.values(opened.objects || {});
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
  let result;
  try {
    fetcher.plan(keys);
    result = await require('./backuprestore').restoreSnapshot({
      memberSk: kp.sk, devicePubAtSnapshot: senderPub, ctx, manifestObject: body,
      fetchChunk: (name, o) => (opened.objects && opened.objects[name] ? fetcher.fetchObject(opened.objects[name], o) : null),
      sink, maxTotalBytes: diskBudget(made.restoreDir, d),
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
    if (failed && failed.some((x) => x && LOCAL_FAILURES.has(x.why))) return { ok: false, because: 'this computer has no room for the agents, or could not write them' };
    return { ok: false, because: fetcher.state.why || 'the agents could not be unpacked on this computer' };
  }
  const fin = rw.finishRestoreWorld({ base, world: made.world, restoreDir: made.restoreDir, result: { ok: true, result } });
  if (!fin.ok) { undoTry(base, made.world); return { ok: false, because: fin.because || 'the agents were unpacked but could not be put in place' }; }
  // Received: noted before /done, so a lost answer sends /done again. Not noted: this copy is taken out and tried again,
  // so there is never a second copy.
  try { updateKey(part.id, d.root, { received: made.world.id, restoring: null }); } catch {
    undoTry(base, made.world);
    return { ok: false, because: 'this computer could not note that the agents arrived' };
  }
  // heldBack: agent folders finish set aside (not plain folders), so not listed. The agents that did arrive are usable,
  // so done is still ok; the count is kept for the console slice to say.
  return { ok: true, world: made.world, restored, heldBack: Array.isArray(fin.heldBack) ? fin.heldBack.length : 0 };
}

/* ---- the tick ---- */

const STALE_KEY_MS = 24 * 60 * 60 * 1000;
/* A key whose hand-over Kosmos+ no longer lists (cancelled, the member removed, the record closed another way), once it
   is STALE_KEY_MS old: removed, so no one-time secret outlives its hand-over. Only this module's own key files. */
function sweepKeys(open, now, root) {
  let names = [];
  try { names = fs.readdirSync(keyDir(root)); } catch { return; }
  for (const n of names) {
    const m = /^([A-Za-z0-9_-]{1,64})\.key\.json$/.exec(n);
    if (!m || open.has(m[1])) continue;
    let st;
    try { st = fs.lstatSync(path.join(keyDir(root), n)); } catch { continue; }
    if (st.isFile() && now - st.mtimeMs >= STALE_KEY_MS) deleteKey(m[1], root);
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
    sweepKeys(new Set(rows.map((h) => h.id)), now, d.root);
    /* Tell the coordinator, and only then forget: the key file goes once /done has been accepted. A /done that is not
       accepted is sent again next tick, never received again (the key file's `received` mark). */
    const close = async (part, ok, because) => {
      // A refusal is noted before /done, so a /done that does not go through is sent again without receiving again.
      if (!ok) { try { updateKey(part.id, d.root, { final: because || 'the hand-over could not be finished', restoring: null }); } catch { /* no key file: nothing to receive again either */ } }
      const told = await mac('POST', DONE_ROUTE, { id: part.id, ok });
      if (told && told.ok) { state.closed.add(part.id); deleteKey(part.id, d.root); }
      return { ok, id: part.id, because };
    };
    let last = null;   // the last row acted on, for the caller; waiting rows never stop the rows after them
    for (const part of rows) {
      if (state.closed.has(part.id)) continue;
      if ((state.retryAt.get(part.id) || 0) > now) continue;
      let kp = readKey(part.id, d.root);
      if (part.state === 'requested') {
        // Nothing has been accepted yet, so a damaged key is replaced rather than ending the hand-over.
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
      // Past `requested` this computer's key was sent; without it (lost, or damaged) the pack can never be opened here.
      if (!kp || kp.problem) return close(part, false, (kp && kp.problem) || 'the key for this hand-over is no longer on this computer');
      if (typeof part.seal_pub === 'string' && part.seal_pub !== b64(kp.pk)) return close(part, false, 'the pack is sealed to a key this computer does not hold');
      if (part.state === 'packing') continue;
      if (kp.received) return close(part, true);   // received on an earlier tick; only the /done is owed
      if (kp.final) return close(part, false, String(kp.final));   // refused on an earlier tick; only the /done is owed
      if (!d.base) { last = { ok: false, id: part.id, because: 'this computer could not find where its Kosmoses live' }; continue; }   // not the pack's fault: no attempt spent
      if (kp.restoring) {
        // A try that stopped part way (the board stopped, say): take its Kosmos out before trying again.
        undoTry(d.base, { id: kp.restoring });
        try { updateKey(part.id, d.root, { restoring: null }); } catch { last = { ok: false, id: part.id, because: 'this computer could not tidy an unfinished hand-over' }; continue; }
      }
      const r = await (d.receive || receive)(part, org, kp, Object.assign({ macRequest: mac }, d));
      if (r.ok) return close(part, true);
      if (r.final) return close(part, false, r.because);
      if (r.missing) {
        // The coordinator marks `packed` before the manifest lands; give the sender MISSING_GRACE_MS to finish its upload,
        // counted from the first miss this computer recorded (kept beside the key, so a restart does not reset it).
        const since = Number.isSafeInteger(kp.missingSince) ? kp.missingSince : now;
        if (!Number.isSafeInteger(kp.missingSince)) { try { updateKey(part.id, d.root, { missingSince: now }); } catch { /* counted from now again next tick */ } }
        if (now - since >= MISSING_GRACE_MS) return close(part, false, 'the pack never finished arriving');
        state.retryAt.set(part.id, now + MISSING_RECHECK_MS);
        last = { ok: false, id: part.id, because: r.because };
        continue;
      }
      // Kept beside the key, so the ceiling holds across restarts.
      const tries = (Number.isSafeInteger(kp.attempts) ? kp.attempts : 0) + 1;
      try { updateKey(part.id, d.root, { attempts: tries, missingSince: null }); } catch { /* counted in memory only this time */ }
      if (tries >= MAX_ATTEMPTS) return close(part, false, `this computer tried ${tries} times and could not unpack the agents`);
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
