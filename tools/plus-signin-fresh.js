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
 *        checks the board answering on the port IS the pointer's build (its x-kosmos-board
 *        identity) and holds no Kosmos+ identity (a FIRST sign-in, the #3827 class), then asks it
 *        to email a code to the seed address.
 *   2. Read the code from the seed inbox with the Gmail connector, scoped to ONE address:
 *        search: to:<the seed address> from:kosmosplus.com newer_than:1h
 *        and note where Gmail put it (labelIds: INBOX, SPAM, or neither -> OTHER).
 *   3. KOSMOS_SEED_TOTP="$(secrets-map.sh value kosmos-seed-totp)" \
 *      node tools/plus-signin-fresh.js finish --pointer <same> --code <6 digits> --placement INBOX|SPAM|OTHER [--port P]
 *        verifies the code, passes the second step, registers (the seed's own address if it has
 *        one), checks the board is enrolled AND switched on AND up (#3827 was enrolled with the
 *        switch off), ALWAYS forgets whatever the register may have left, and writes the record.
 *        The first ever run enrols the seed's authenticator instead and writes its secret to a
 *        mode-600 file under ~/.cache/claude-handoffs for `/add-secret --migrate` (never shown).
 *
 * A SETUP problem (no code read, KOSMOS_SEED_TOTP unset, the wrong board on the port, a seed whose
 * second step is not an authenticator, a board call that timed out) exits 2 and records nothing.
 * A refused step records a FAIL, which the gate refuses on. A refusal that was the operator's own
 * mistake (a stale or mistyped code, an old authenticator secret) is cleared by running start and
 * finish again: the new attempt's record REPLACES this build's record when it finishes. An earlier
 * record is never deleted before then, so an abandoned attempt cannot turn a refusal into a HOLD.
 *
 * THE SEED: the address #1591 decides: a +seed alias on a KOSMOS-owned mailbox (installkosmos.com),
 * connected to the agents' Gmail connector. Never another company's mailbox by default: the connector
 * can read the whole mailbox, not only one address (#1591, 2026-09-26). Given as --seed or
 * KOSMOS_SEED_EMAIL. It is not written in
 * this repo (#1881: no other company's names or accounts in the tree); the card names it. The
 * Resend key is never used for reading.
 *
 * The board is reached like the other staging gates: 127.0.0.1:<port> with its board.token in a
 * header (store.ROOT/board.token; KOSMOS_STORE_ROOT overrides for tests). Exit 0 when the record
 * says pass, 1 when it says fail, 2 when nothing was recorded.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const record = require('./lib/plus-signin-record');

const CALL_MS = Number(process.env.KOSMOS_PLUS_CALL_MS) || 15 * 1000;
/* The engine bounds a register at five minutes plus up to a minute clearing a half identity. */
const REGISTER_MS = Number(process.env.KOSMOS_PLUS_REGISTER_MS) || 7 * 60 * 1000;
/* The engine's forget waits for a register in flight, then signed calls, then the retire: about 8 minutes at worst. */
const FORGET_MS = Number(process.env.KOSMOS_PLUS_FORGET_MS) || 9 * 60 * 1000;
/* How long the tunnel may take to report up after the register. */
const UP_MS = Number(process.env.KOSMOS_PLUS_UP_MS) || 120 * 1000;
const UP_POLL_MS = Number(process.env.KOSMOS_PLUS_UP_POLL_MS) || 2000;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; } else out._.push(a);
  }
  return out;
}
class Setup extends Error {}
function setup(msg) { throw new Setup(msg); }

function pointerFields(p) {
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { setup('cannot read the staging pointer ' + p); }
  if (!j || typeof j.version !== 'string' || !/^[0-9a-f]{64}$/.test(String(j.sha256))) setup('the staging pointer names no version or sha256');
  return { version: j.version, sha256: j.sha256 };
}
function storeRoot() {
  if (process.env.KOSMOS_STORE_ROOT) return process.env.KOSMOS_STORE_ROOT;
  try { return require(path.join(__dirname, '..', 'engine', 'store')).ROOT; } catch { return null; }
}
function boardPort(given) {
  const p = given || process.env.KOSMOS_PORT;
  if (p) { if (!/^[0-9]+$/.test(String(p))) setup('port ' + p + ' is not numeric'); return Number(p); }
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

/** The board, with a timeout on every call (a hung board must not hang the agent). */
function board(port, token) {
  const base = 'http://127.0.0.1:' + port;
  const headers = { 'content-type': 'application/json', 'x-kosmos-board-token': token, 'sec-fetch-site': 'same-origin' };
  const call = async (p, init, ms) => {
    try {
      const r = await fetch(base + p, Object.assign({ headers, signal: AbortSignal.timeout(ms) }, init));
      return { status: r.status, headers: r.headers, json: await r.json().catch(() => ({})) };
    } catch (err) {
      return { status: 0, headers: new Headers(), json: { error: 'no answer from the board (' + String((err && err.name) || err) + ')' } };
    }
  };
  return {
    get: (p, ms = CALL_MS) => call(p, {}, ms),
    post: (p, body, ms = CALL_MS) => call(p, { method: 'POST', body: JSON.stringify(body || {}) }, ms),
    async identity() {
      try { const r = await fetch(base + '/', { headers, signal: AbortSignal.timeout(CALL_MS) }); return r.headers.get('x-kosmos-board') || ''; } catch { return ''; }
    },
  };
}
function tokenAt(root) { try { return fs.readFileSync(path.join(root, 'board.token'), 'utf8').trim(); } catch { return ''; } }

/** The board on the port, checked to be the pointer's build. */
async function boardFor(a, ptr) {
  const root = storeRoot() || setup('cannot resolve the board\'s store root');
  const token = tokenAt(root);
  if (!token) setup('no board.token at ' + root + ': not an enforcing installed board, so not a fresh staging board');
  const b = board(boardPort(a.port), token);
  const identity = await b.identity();
  if (record.boardVersion(identity) !== ptr.version) {
    setup('the board on port ' + boardPort(a.port) + ' reports ' + JSON.stringify(identity || 'nothing') + ', not the staged build ' + ptr.version + ': install and start the staged build first');
  }
  return { b, identity };
}

function progressPath(sha) { return record.recordPath(sha).replace(/\.json$/, '.progress.json'); }

async function start(a) {
  const ptr = pointerFields(a.pointer || setup('--pointer is required'));
  const { b, identity } = await boardFor(a, ptr);
  const seed = String(a.seed || process.env.KOSMOS_SEED_EMAIL || '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(seed)) setup('no seed address: pass --seed or set KOSMOS_SEED_EMAIL (the address #1591 names)');
  const st = await b.get('/api/remote');
  if (st.status !== 200) setup('the board did not answer /api/remote on port ' + boardPort(a.port));
  if (st.json.enrolled === true) setup('this board already holds a Kosmos+ identity: a FIRST sign-in cannot be tested here (forget it first, or use a fresh board)');
  const steps = [{ id: 'fresh', result: 'pass' }];
  const s = await b.post('/api/remote/signin-start', { email: seed });
  // No answer is setup, not a refusal: it must not replace this build's record (review round 5).
  if (s.status === 0) { await b.post('/api/remote/signin-cancel', {}); setup('signin-start: ' + String(s.json.error) + '; try again'); }
  if (s.status !== 200) {
    steps.push({ id: 'start', result: 'fail', detail: String(s.json.error || s.status) });
    return finishRecord(ptr, identity, seed, 'NONE', steps);
  }
  steps.push({ id: 'start', result: 'pass' });
  fs.mkdirSync(path.dirname(progressPath(ptr.sha256)), { recursive: true });
  fs.writeFileSync(progressPath(ptr.sha256), JSON.stringify({ ...ptr, identity, seed, steps, startedAt: new Date().toISOString() }));
  console.log('plus-signin-fresh: a code was sent to ' + seed + ' at ' + new Date().toISOString() + '. Read the NEWEST message after that time with the Gmail connector (to:' + seed + ' from:kosmosplus.com newer_than:1h),');
  console.log('  note its label (INBOX / SPAM / OTHER), then run: finish --pointer ' + a.pointer + ' --code <code> --placement <label>');
  return 0;
}

async function finish(a) {
  const ptr = pointerFields(a.pointer || setup('--pointer is required'));
  let prog;
  try { prog = JSON.parse(fs.readFileSync(progressPath(ptr.sha256), 'utf8')); } catch { setup('no started run for ' + ptr.sha256 + ': run `start` first'); }
  const { b, identity } = await boardFor(a, ptr);
  if (identity !== prog.identity) setup('the board changed since `start` (' + JSON.stringify(prog.identity) + ' then, ' + JSON.stringify(identity) + ' now): run `start` again');
  const placement = String(a.placement || '').toUpperCase();
  const code = String(a.code || '').trim();
  // Setup mistakes say nothing about the build: cancel the half sign-in, record nothing.
  if (!['INBOX', 'SPAM', 'OTHER'].includes(placement) || !/^[0-9]{6}$/.test(code)) {
    await b.post('/api/remote/signin-cancel', {});
    setup('a six-digit --code and --placement INBOX|SPAM|OTHER are required (read them from the seed inbox)');
  }
  const seed = prog.seed;
  const steps = prog.steps.concat([{ id: 'code', result: 'pass' }]);
  let registerTried = false;
  // No answer at all (a timeout) BEFORE any register says nothing about the build: cancel, record
  // nothing. Once a register was tried it may have finished on the board after we gave up, so a
  // timeout is recorded as a failed step and the forget below still runs (review round 4).
  const fail = async (id, r) => {
    if (r && r.status === 0 && !registerTried) { await b.post('/api/remote/signin-cancel', {}); setup(id + ': ' + String(r.json.error) + '; try again'); }
    if (r && r.status === 0) { steps.push({ id, result: 'fail', detail: 'no answer from the board (' + String(r.json.error) + '); a Mac may have been registered anyway, so it is forgotten' }); return; }
    steps.push({ id, result: 'fail', detail: String((r && r.json && r.json.error) || (r && r.status) || r) });
  };
  try {
    const v = await b.post('/api/remote/signin-verify', { email: seed, code });
    if (v.status !== 200) { await fail('verify', v); throw new Error('verify'); }
    steps.push({ id: 'verify', result: 'pass' });
    let answer = v.json;
    if (v.json.stage === 'second') {
      if (v.json.second_kind && v.json.second_kind !== 'totp') {
        await b.post('/api/remote/signin-cancel', {});
        setup('the seed account\'s second step is ' + JSON.stringify(v.json.second_kind) + ', not an authenticator this procedure can answer');
      }
      const secret = process.env.KOSMOS_SEED_TOTP;
      if (!secret) { await b.post('/api/remote/signin-cancel', {}); setup('KOSMOS_SEED_TOTP is not set (secrets-map.sh value kosmos-seed-totp)'); }
      const r = await b.post('/api/remote/signin-second', { code: totp(secret) });
      if (r.status !== 200) { await fail('second', r); throw new Error('second'); }
      answer = r.json;
    } else if (v.json.stage === 'enrol_second_factor') {
      const e = await b.post('/api/remote/signin-enrol', { kind: 'totp' });
      if (e.status !== 200 || typeof e.json.secret !== 'string') { await fail('second', e); throw new Error('second'); }
      // The seed's authenticator secret, somewhere that survives a reboot, never printed.
      const dir = path.join(os.homedir(), '.cache', 'claude-handoffs');
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, 'kosmos-seed-totp-' + Date.now() + '.env');
      fs.writeFileSync(out, 'KOSMOS_SEED_TOTP=' + e.json.secret + '\n', { mode: 0o600 });
      console.log('plus-signin-fresh: the seed account had no second step; enrolled an authenticator. File its secret now (the seed is locked without it): /add-secret --migrate ' + out);
      const c = await b.post('/api/remote/signin-confirm-enrol', { code: totp(e.json.secret) });
      if (c.status !== 200) { await fail('second', c); throw new Error('second'); }
      answer = c.json;
    } else {
      // The coordinator requires a second step (require_second): a sign-in that skips it
      // straight to a session is the anomaly, never a pass (review round 2).
      steps.push({ id: 'second', result: 'fail', detail: v.json.stage === 'session' ? 'no second step was asked for after the code' : 'unexpected stage ' + JSON.stringify(v.json.stage) });
      throw new Error('second');
    }
    steps.push({ id: 'second', result: 'pass' });
    // The seed's own address when it has one (the coordinator refuses any other name for an
    // account that owns one), else a throwaway name for this build.
    const owned = [answer, v.json].map((j) => j && j.account_address).find((x) => typeof x === 'string' && x);
    const name = owned ? owned.split('.')[0] : 'kseed-' + ptr.sha256.slice(0, 8);
    registerTried = true;
    const reg = await b.post('/api/remote/signin-register', { name }, REGISTER_MS);
    if (reg.status !== 200) { await fail('register', reg); throw new Error('register'); }
    steps.push({ id: 'register', result: 'pass' });
    const st = await b.get('/api/remote');
    if (!(st.status === 200 && st.json.enrolled === true)) { steps.push({ id: 'enrolled', result: 'fail', detail: 'the board does not report itself enrolled after register' }); throw new Error('enrolled'); }
    steps.push({ id: 'enrolled', result: 'pass' });
    // Switched on and connected, not only enrolled: #3827 left the switch off after a good register.
    const deadline = Date.now() + UP_MS;
    let last = st.json;
    while (!(last.on === true && last.status && last.status.state === 'up') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, UP_POLL_MS));
      const r = await b.get('/api/remote');
      if (r.status === 200) last = r.json;
    }
    steps.push(last.on === true && last.status && last.status.state === 'up'
      ? { id: 'up', result: 'pass' }
      : { id: 'up', result: 'fail', detail: 'after the register the switch was ' + (last.on === true ? 'on' : 'OFF') + ' and the tunnel ' + JSON.stringify(last.status && last.status.state) });
  } catch (err) {
    if (err instanceof Setup) throw err;
    /* the failed step is recorded; the rest are marked not reached below */
  }
  // Forget whenever a register was TRIED: one that timed out here may still have finished on the
  // board, and the engine's forget also retires a half-registered identity.
  if (registerTried) {
    const f = await b.post('/api/remote/forget', {}, FORGET_MS);
    const nothing = f.status === 200 && f.json.retired !== true && /nothing to retire/i.test(String(f.json.because || ''));
    steps.push(f.status === 200 && f.json.retired === true ? { id: 'forget', result: 'pass' }
      : nothing ? { id: 'forget', result: 'pass', detail: 'the register wrote nothing, so there was nothing to retire' }
      : f.status === 0 ? { id: 'forget', result: 'fail', detail: 'no answer from the board to the forget; the retire may still complete: check the seed account' }
      : { id: 'forget', result: 'fail', detail: 'the throwaway registration was not retired: ' + String((f.json && (f.json.because || f.json.error)) || f.status) });
  } else {
    await b.post('/api/remote/signin-cancel', {});
  }
  return finishRecord(ptr, identity, seed, placement, steps);
}

function finishRecord(ptr, identity, seed, placement, steps) {
  const have = new Set(steps.map((s) => s.id));
  for (const id of record.STEPS) if (!have.has(id)) steps.push({ id, result: 'fail', detail: 'not reached' });
  const rec = { version: ptr.version, sha256: ptr.sha256, board: identity, at: new Date().toISOString(), seed, placement, steps,
    result: record.STEPS.every((id) => steps.find((s) => s.id === id).result === 'pass') ? 'pass' : 'fail' };
  const f = record.write(rec);
  try { fs.rmSync(progressPath(ptr.sha256), { force: true }); } catch { /* best effort */ }
  console.log('plus-signin-fresh: ' + rec.result.toUpperCase() + ' (code email in ' + placement + '). Record: ' + f);
  return rec.result === 'pass' ? 0 : 1;
}

module.exports = { totp };

if (require.main === module) {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  const run = cmd === 'start' ? start : cmd === 'finish' ? finish : null;
  if (!run) { console.error('plus-signin-fresh: usage: plus-signin-fresh.js start|finish --pointer <latest-staging.json> [...]'); process.exit(2); }
  run(a).then((rc) => process.exit(rc || 0), (err) => {
    console.error('plus-signin-fresh: ' + String((err && err.message) || err) + (err instanceof Setup ? ' (nothing recorded)' : ''));
    process.exit(2);
  });
}
