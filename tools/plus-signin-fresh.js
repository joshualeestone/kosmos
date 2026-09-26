#!/usr/bin/env node
'use strict';
/**
 * plus-signin-fresh.js - kosmos#2036 / #1591: take a FRESH staging board through a real first
 * Kosmos+ sign-in, and leave the record tools/plus-signin-verified.sh gates the promote on.
 *
 * Run by an AGENT (not a script alone): the code arrives by email, and the only readable seed
 * inbox is behind the Gmail connector. Two phases, with the inbox read in between:
 *
 *   1. node tools/plus-signin-fresh.js start  --pointer <site>/dist/latest-staging.json [--port P]
 *        checks the board holds no Kosmos+ identity (a FIRST sign-in, the #3827 class), then asks
 *        the board to email a code to the seed address.
 *   2. Read the code from the seed inbox with the Gmail connector, scoped to ONE address:
 *        search: to:josh+kosmos-seed@book.io from:kosmosplus.com newer_than:1h
 *        and note where Gmail put it (labelIds: INBOX, SPAM, or neither -> OTHER).
 *   3. KOSMOS_SEED_TOTP="$(secrets-map.sh value kosmos-seed-totp)" \
 *      node tools/plus-signin-fresh.js finish --pointer <same> --code <6 digits> --placement INBOX|SPAM|OTHER [--port P]
 *        verifies the code, passes the second step (TOTP from the seed's stored secret), registers
 *        a throwaway name, checks the board is enrolled, FORGETS the Mac again (retiring the
 *        registration), and writes the record. The first ever run enrols the seed's authenticator
 *        instead and writes its secret to a mode-600 file for `/add-secret --migrate` (never shown).
 *
 * THE SEED: josh+kosmos-seed@book.io (#1591's decision): a plus address on the mailbox the Gmail
 * connector already reads, not a new mailbox (#3751). Override with --seed. The Resend key is
 * never used for reading.
 *
 * The board is reached like the other staging gates: 127.0.0.1:<port> with its board.token in a
 * header (store.ROOT/board.token; KOSMOS_STORE_ROOT overrides for tests). Exit 0 when the record
 * says pass, 1 when it says fail, 2 when the run could not start (nothing recorded).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const record = require('./lib/plus-signin-record');

const DEFAULT_SEED = 'josh+kosmos-seed@book.io';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; } else out._.push(a);
  }
  return out;
}
function die(msg, code = 2) { console.error('plus-signin-fresh: ' + msg); process.exit(code); }

function pointerFields(p) {
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { die('cannot read the staging pointer ' + p); }
  if (!j || typeof j.version !== 'string' || !/^[0-9a-f]{64}$/.test(String(j.sha256))) die('the staging pointer names no version or sha256');
  return { version: j.version, sha256: j.sha256 };
}
function storeRoot() {
  if (process.env.KOSMOS_STORE_ROOT) return process.env.KOSMOS_STORE_ROOT;
  try { return require(path.join(__dirname, '..', 'engine', 'store')).ROOT; } catch { return null; }
}
function boardPort(given) {
  const p = given || process.env.KOSMOS_PORT;
  if (p) { if (!/^[0-9]+$/.test(String(p))) die('port ' + p + ' is not numeric'); return Number(p); }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  return uid === 501 ? 16180 : 16180 + 1 + (uid % 3999);
}

/** RFC 6238 TOTP, 30 s, 6 digits, SHA-1, from a base32 secret. */
function totp(base32, now = Date.now()) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(base32).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of clean) bits += alpha.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < key.length; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

function board(port, token) {
  const base = 'http://127.0.0.1:' + port;
  const headers = { 'content-type': 'application/json', 'x-kosmos-board-token': token, 'sec-fetch-site': 'same-origin' };
  return {
    async get(p) { const r = await fetch(base + p, { headers }); return { status: r.status, json: await r.json().catch(() => ({})) }; },
    async post(p, body) { const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body || {}) }); return { status: r.status, json: await r.json().catch(() => ({})) }; },
  };
}

function progressPath(sha) { return record.recordPath(sha).replace(/\.json$/, '.progress.json'); }

async function start(a) {
  const ptr = pointerFields(a.pointer || die('--pointer is required'));
  const root = storeRoot() || die('cannot resolve the board\'s store root');
  const token = (() => { try { return fs.readFileSync(path.join(root, 'board.token'), 'utf8').trim(); } catch { return ''; } })();
  if (!token) die('no board.token at ' + root + ': not an enforcing installed board, so not a fresh staging board');
  const b = board(boardPort(a.port), token);
  const seed = a.seed || DEFAULT_SEED;
  const steps = [];
  const st = await b.get('/api/remote').catch(() => null);
  if (!st || st.status !== 200) die('the board did not answer /api/remote on port ' + boardPort(a.port));
  if (st.json.enrolled === true) die('this board already holds a Kosmos+ identity: a FIRST sign-in cannot be tested here (forget it first, or use a fresh board)');
  steps.push({ id: 'fresh', result: 'pass' });
  const s = await b.post('/api/remote/signin-start', { email: seed });
  steps.push(s.status === 200 ? { id: 'start', result: 'pass' } : { id: 'start', result: 'fail', detail: String(s.json.error || s.status) });
  fs.mkdirSync(path.dirname(progressPath(ptr.sha256)), { recursive: true });
  fs.writeFileSync(progressPath(ptr.sha256), JSON.stringify({ ...ptr, seed, steps, startedAt: new Date().toISOString() }));
  if (s.status !== 200) return finishRecord(ptr, seed, 'OTHER', steps);
  console.log('plus-signin-fresh: a code was sent to ' + seed + '. Read it with the Gmail connector (to:' + seed + ' from:kosmosplus.com newer_than:1h),');
  console.log('  note its label (INBOX / SPAM / OTHER), then run: finish --pointer ' + a.pointer + ' --code <code> --placement <label>');
  return 0;
}

async function finish(a) {
  const ptr = pointerFields(a.pointer || die('--pointer is required'));
  let prog;
  try { prog = JSON.parse(fs.readFileSync(progressPath(ptr.sha256), 'utf8')); } catch { die('no started run for ' + ptr.sha256 + ': run `start` first'); }
  const placement = String(a.placement || '').toUpperCase();
  if (!record.PLACEMENTS.includes(placement)) die('--placement must be INBOX, SPAM or OTHER');
  const steps = prog.steps.slice();
  const root = storeRoot() || die('cannot resolve the board\'s store root');
  const token = fs.readFileSync(path.join(root, 'board.token'), 'utf8').trim();
  const b = board(boardPort(a.port), token);
  const seed = prog.seed;
  const code = String(a.code || '').trim();
  steps.push(/^[0-9]{6}$/.test(code) ? { id: 'code', result: 'pass' } : { id: 'code', result: 'fail', detail: 'no six-digit code was read from the seed inbox' });
  let registered = false;
  const fail = (id, r) => steps.push({ id, result: 'fail', detail: String((r && r.json && r.json.error) || (r && r.status) || r) });
  try {
    if (steps.at(-1).result !== 'pass') throw new Error('no code');
    const v = await b.post('/api/remote/signin-verify', { email: seed, code });
    if (v.status !== 200) { fail('verify', v); throw new Error('verify'); }
    steps.push({ id: 'verify', result: 'pass' });
    if (v.json.stage === 'second') {
      const secret = process.env.KOSMOS_SEED_TOTP;
      if (!secret) { steps.push({ id: 'second', result: 'fail', detail: 'KOSMOS_SEED_TOTP is not set (secrets-map.sh value kosmos-seed-totp)' }); throw new Error('second'); }
      const r = await b.post('/api/remote/signin-second', { code: totp(secret) });
      if (r.status !== 200) { fail('second', r); throw new Error('second'); }
    } else if (v.json.stage === 'enrol_second_factor') {
      const e = await b.post('/api/remote/signin-enrol', { kind: 'totp' });
      if (e.status !== 200 || typeof e.json.secret !== 'string') { fail('second', e); throw new Error('second'); }
      // The seed's authenticator secret, written for /add-secret --migrate and never printed.
      const out = path.join(os.tmpdir(), 'kosmos-seed-totp-' + process.pid + '.env');
      fs.writeFileSync(out, 'KOSMOS_SEED_TOTP=' + e.json.secret + '\n', { mode: 0o600 });
      console.log('plus-signin-fresh: the seed account had no second step; enrolled an authenticator. File its secret now: /add-secret --migrate ' + out);
      const c = await b.post('/api/remote/signin-confirm-enrol', { code: totp(e.json.secret) });
      if (c.status !== 200) { fail('second', c); throw new Error('second'); }
    } else if (v.json.stage !== 'session') {
      steps.push({ id: 'second', result: 'fail', detail: 'unexpected stage ' + JSON.stringify(v.json.stage) });
      throw new Error('second');
    }
    steps.push({ id: 'second', result: 'pass' });
    const name = 'kseed-' + ptr.sha256.slice(0, 8);
    const reg = await b.post('/api/remote/signin-register', { name });
    if (reg.status !== 200) { fail('register', reg); throw new Error('register'); }
    registered = true;
    steps.push({ id: 'register', result: 'pass' });
    const st = await b.get('/api/remote');
    steps.push(st.status === 200 && st.json.enrolled === true ? { id: 'enrolled', result: 'pass' } : { id: 'enrolled', result: 'fail', detail: 'the board does not report itself enrolled after register' });
  } catch { /* the failed step is recorded; the rest are marked not reached below */ }
  // Always retire what was registered, so a cut leaves no throwaway Mac on the account.
  if (registered) {
    const f = await b.post('/api/remote/forget', {}).catch((err) => ({ status: 0, json: { error: String(err) } }));
    steps.push(f.status === 200 && f.json.retired === true ? { id: 'forget', result: 'pass' } : { id: 'forget', result: 'fail', detail: 'the throwaway registration was not retired: ' + String((f.json && (f.json.because || f.json.error)) || f.status) });
  }
  return finishRecord(ptr, seed, placement, steps);
}

function finishRecord(ptr, seed, placement, steps) {
  const have = new Set(steps.map((s) => s.id));
  for (const id of record.STEPS) if (!have.has(id)) steps.push({ id, result: 'fail', detail: 'not reached' });
  const rec = { version: ptr.version, sha256: ptr.sha256, at: new Date().toISOString(), seed, placement, steps,
    result: record.STEPS.every((id) => steps.find((s) => s.id === id).result === 'pass') ? 'pass' : 'fail' };
  const f = record.write(rec);
  try { fs.rmSync(progressPath(ptr.sha256), { force: true }); } catch { /* best effort */ }
  console.log('plus-signin-fresh: ' + rec.result.toUpperCase() + ' (code email in ' + placement + '). Record: ' + f);
  return rec.result === 'pass' ? 0 : 1;
}

module.exports = { totp, DEFAULT_SEED };

if (require.main === module) {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const run = cmd === 'start' ? start : cmd === 'finish' ? finish : null;
  if (!run) die('usage: plus-signin-fresh.js start|finish --pointer <latest-staging.json> [...]');
  run(a).then((rc) => process.exit(rc || 0), (err) => die(String((err && err.message) || err)));
}
