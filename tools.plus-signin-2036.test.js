'use strict';
// kosmos#2036 / #1591: the first Kosmos+ sign-in record, its gate, and the agent-run procedure,
// driven against a fake board. Temp dirs only; nothing reaches a real board or coordinator.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, spawn } = require('node:child_process');

const record = require('./tools/lib/plus-signin-record');
const { totp } = require('./tools/plus-signin-fresh');

const SHA = 'a'.repeat(64);
const VER = '9.9.9';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plus-2036-'));
const passSteps = () => record.STEPS.map((id) => ({ id, result: 'pass' }));
const good = () => ({ version: VER, sha256: SHA, at: new Date().toISOString(), seed: 's@x', placement: 'INBOX', steps: passSteps(), result: 'pass' });

test('#2036: a record validates only when it names this build and every step', () => {
  assert.deepStrictEqual(record.validate(good(), { version: VER, sha256: SHA }), { ok: true });
  const cases = {
    'another sha': Object.assign(good(), { sha256: 'b'.repeat(64) }),
    'another version': Object.assign(good(), { version: '9.9.8' }),
    'no time': Object.assign(good(), { at: 'never' }),
    'no placement': Object.assign(good(), { placement: 'maybe' }),
    'a missing step': Object.assign(good(), { steps: passSteps().slice(1) }),
    'a step twice': Object.assign(good(), { steps: passSteps().concat([{ id: 'fresh', result: 'pass' }]) }),
    'an unknown step': Object.assign(good(), { steps: passSteps().concat([{ id: 'vibes', result: 'pass' }]) }),
    'pass over a failed step': Object.assign(good(), { steps: passSteps().map((s) => (s.id === 'forget' ? { id: 'forget', result: 'fail' } : s)) }),
    'a result neither pass nor fail': Object.assign(good(), { result: 'ok' }),
  };
  for (const [why, rec] of Object.entries(cases)) {
    assert.strictEqual(record.validate(rec, { version: VER, sha256: SHA }).ok, false, why + ' validated');
  }
});

function runGate(dir, pointer) {
  return spawnSync('bash', [path.join(__dirname, 'tools', 'plus-signin-verified.sh'), pointer],
    { encoding: 'utf8', env: Object.assign({}, process.env, { KOSMOS_PLUS_VERIFY_DIR: dir }) });
}
function pointerFile(dir) {
  const p = path.join(dir, 'latest-staging.json');
  fs.writeFileSync(p, JSON.stringify({ version: VER, sha256: SHA }));
  return p;
}

test('#2036: the gate answers 2 with no record, 0 on a pass, 1 on a fail or an ambiguous record', () => {
  const dir = tmp();
  const ptr = pointerFile(dir);
  let r = runGate(dir, ptr);
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /no record/);
  record.write(good(), { KOSMOS_PLUS_VERIFY_DIR: dir });
  r = runGate(dir, ptr);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASSED on 9\.9\.9 \(code email in INBOX/);
  const failed = good(); failed.result = 'fail'; failed.steps = passSteps().map((s) => (s.id === 'register' ? { id: 'register', result: 'fail', detail: 'boom' } : s));
  record.write(failed, { KOSMOS_PLUS_VERIFY_DIR: dir });
  r = runGate(dir, ptr);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /FAILED on 9\.9\.9: register \(boom\)/);
  fs.writeFileSync(record.recordPath(SHA, { KOSMOS_PLUS_VERIFY_DIR: dir }), JSON.stringify(Object.assign(good(), { version: '1.0.0' })));
  r = runGate(dir, ptr);
  assert.strictEqual(r.status, 1, 'an ambiguous record did not refuse');
  assert.match(r.stdout, /ambiguous record/);
  // A record for ANOTHER build is simply not this build's record: HOLD, not pass.
  fs.rmSync(record.recordPath(SHA, { KOSMOS_PLUS_VERIFY_DIR: dir }));
  record.write(Object.assign(good(), { sha256: 'c'.repeat(64) }), { KOSMOS_PLUS_VERIFY_DIR: dir });
  assert.strictEqual(runGate(dir, ptr).status, 2, 'another build\'s record passed this one');
});

test('#2036: the TOTP matches RFC 6238\'s SHA-1 test vector', () => {
  // Secret "12345678901234567890" in base32; T = 59 s -> 94287082, six digits 287082.
  assert.strictEqual(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59 * 1000), '287082');
  assert.strictEqual(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1111111109 * 1000), '081804');
});

/** A fake board: the routes the procedure uses, with switchable behaviour. */
function fakeBoard(opts = {}) {
  const calls = [];
  const state = { enrolled: !!opts.enrolled };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, token: req.headers['x-kosmos-board-token'], body: body ? JSON.parse(body) : null });
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers['x-kosmos-board-token'] !== 'tok') return send(401, { error: 'no token' });
      if (req.url === '/api/remote') return send(200, { enrolled: state.enrolled });
      if (req.url === '/api/remote/signin-start') return send(200, { ok: true, stage: 'code_sent' });
      if (req.url === '/api/remote/signin-verify') return send(200, { ok: true, stage: opts.stage || 'second' });
      if (req.url === '/api/remote/signin-second') return opts.secondFails ? send(400, { error: 'wrong code' }) : send(200, { ok: true, stage: 'session' });
      if (req.url === '/api/remote/signin-enrol') return send(200, { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', otpauth: 'otpauth://x' });
      if (req.url === '/api/remote/signin-confirm-enrol') return send(200, { ok: true, stage: 'session' });
      if (req.url === '/api/remote/signin-register') { if (opts.registerFails) return send(400, { error: 'register broke' }); state.enrolled = true; return send(200, { ok: true, name: 'x' }); }
      if (req.url === '/api/remote/forget') { state.enrolled = false; return send(200, { ok: true, retired: true }); }
      send(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, state, port: server.address().port })));
}
function runner(args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'tools', 'plus-signin-fresh.js'), ...args], { env: Object.assign({}, process.env, env) });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}
function env(dir) {
  const root = path.join(dir, 'root'); fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'board.token'), 'tok');
  return { KOSMOS_STORE_ROOT: root, KOSMOS_PLUS_VERIFY_DIR: path.join(dir, 'records'), KOSMOS_SEED_TOTP: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', TMPDIR: dir };
}

test('#2036: a first sign-in on a fresh board, start then finish, records a pass and retires the throwaway Mac', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard();
  try {
    let r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.strictEqual(r.code, 0, r.out);
    assert.deepStrictEqual(b.calls.find((c) => c.url === '/api/remote/signin-start').body, { email: 'josh+kosmos-seed@book.io' });
    r = await runner(['finish', '--pointer', ptr, '--port', String(b.port), '--code', '123456', '--placement', 'spam'], e);
    assert.strictEqual(r.code, 0, r.out);
    const rec = JSON.parse(fs.readFileSync(record.recordPath(SHA, e), 'utf8'));
    assert.strictEqual(rec.result, 'pass');
    assert.strictEqual(rec.placement, 'SPAM', 'the inbox placement was not recorded');
    assert.deepStrictEqual(record.validate(rec, { version: VER, sha256: SHA }), { ok: true });
    assert.match(b.calls.find((c) => c.url === '/api/remote/signin-second').body.code, /^[0-9]{6}$/);
    assert.strictEqual(b.calls.find((c) => c.url === '/api/remote/signin-register').body.name, 'kseed-aaaaaaaa');
    assert.ok(b.calls.some((c) => c.url === '/api/remote/forget'), 'the throwaway registration was not retired');
    assert.strictEqual(b.state.enrolled, false, 'the board was left enrolled');
  } finally { b.server.close(); }
});

test('#2036: a board that already holds a Kosmos+ identity is refused: a first sign-in cannot be tested there', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ enrolled: true });
  try {
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.strictEqual(r.code, 2);
    assert.match(r.out, /already holds a Kosmos\+ identity/);
    assert.ok(!b.calls.some((c) => c.url === '/api/remote/signin-start'), 'a code was sent anyway');
    assert.ok(!fs.existsSync(record.recordPath(SHA, e)), 'a record was written for a test that never ran');
  } finally { b.server.close(); }
});

test('#2036: a step that fails is recorded as a fail naming it, and the rest as not reached', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ registerFails: true });
  try {
    await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    const r = await runner(['finish', '--pointer', ptr, '--port', String(b.port), '--code', '123456', '--placement', 'INBOX'], e);
    assert.strictEqual(r.code, 1, r.out);
    const rec = JSON.parse(fs.readFileSync(record.recordPath(SHA, e), 'utf8'));
    assert.strictEqual(rec.result, 'fail');
    assert.deepStrictEqual(rec.steps.find((s) => s.id === 'register'), { id: 'register', result: 'fail', detail: 'register broke' });
    assert.strictEqual(rec.steps.find((s) => s.id === 'enrolled').detail, 'not reached');
    assert.deepStrictEqual(record.validate(rec, { version: VER, sha256: SHA }), { ok: true }, 'a failing run wrote an invalid record');
  } finally { b.server.close(); }
});

test('#2036: the seed\'s first run enrols an authenticator and writes its secret to a mode-600 file, never to the screen', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ stage: 'enrol_second_factor' });
  try {
    await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    const r = await runner(['finish', '--pointer', ptr, '--port', String(b.port), '--code', '123456', '--placement', 'INBOX'], e);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!r.out.includes('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), 'the authenticator secret was printed');
    const f = (/\/add-secret --migrate (\S+)/.exec(r.out) || [])[1];
    assert.ok(f && fs.existsSync(f), 'no secret file was named: ' + r.out);
    assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-confirm-enrol'));
  } finally { b.server.close(); }
});
