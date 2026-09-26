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
const BOARD = VER + '@default';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plus-2036-'));
const passSteps = () => record.STEPS.map((id) => ({ id, result: 'pass' }));
const good = () => ({ version: VER, sha256: SHA, board: BOARD, at: new Date().toISOString(), seed: 's@x', placement: 'INBOX', steps: passSteps(), result: 'pass' });

test('#2036: a record validates only when it names this build, the board that ran it, and every step', () => {
  assert.deepStrictEqual(record.validate(good(), { version: VER, sha256: SHA }), { ok: true });
  assert.strictEqual(record.boardVersion('0.6.97+abcdef123456@world'), '0.6.97', 'a Windows identity');
  const cases = {
    'another sha': Object.assign(good(), { sha256: 'b'.repeat(64) }),
    'another version': Object.assign(good(), { version: '9.9.8' }),
    'made on another build\'s board': Object.assign(good(), { board: '9.9.8@default' }),
    'no board': Object.assign(good(), { board: undefined }),
    'no time': Object.assign(good(), { at: 'never' }),
    'no placement': Object.assign(good(), { placement: 'maybe' }),
    'a missing step': Object.assign(good(), { steps: passSteps().slice(1) }),
    'a step twice': Object.assign(good(), { steps: passSteps().concat([{ id: 'fresh', result: 'pass' }]) }),
    'an unknown step': Object.assign(good(), { steps: passSteps().concat([{ id: 'vibes', result: 'pass' }]) }),
    'pass over a failed step': Object.assign(good(), { steps: passSteps().map((s) => (s.id === 'up' ? { id: 'up', result: 'fail' } : s)) }),
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
  fs.rmSync(record.recordPath(SHA, { KOSMOS_PLUS_VERIFY_DIR: dir }));
  record.write(Object.assign(good(), { sha256: 'c'.repeat(64) }), { KOSMOS_PLUS_VERIFY_DIR: dir });
  assert.strictEqual(runGate(dir, ptr).status, 2, 'another build\'s record passed this one');
});

test('#2036: the TOTP matches RFC 6238\'s SHA-1 test vectors', () => {
  assert.strictEqual(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59 * 1000), '287082');
  assert.strictEqual(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1111111109 * 1000), '081804');
});

/* #3986: the budget for a test whose board HANGS one call. Long enough that the runner's other
   calls (its identity check, /api/remote) never time out on a loaded machine: at 300ms they did,
   and the runner exited as setup BEFORE reaching the hanging call, with the same code the test
   expects, so only a later assertion noticed. Each such test also asserts the hanging call was
   reached. */
const HANG_MS = '2000';
/* The runner's floor for a cleanup cancel (tools/plus-signin-fresh.js CLEANUP_MS), and a late
   answer that lands after HANG_MS but inside the floor: fixed, not derived from HANG_MS, so
   raising HANG_MS cannot push it past the floor (asserted where it is used). */
const CLEANUP_FLOOR_MS = 5000;
const LATE_CANCEL_MS = 3000;
/* A cancel that never answers: longer than any budget the runner could legitimately wait. */
const NEVER_MS = 10 * 60 * 1000;
/* Slack on top of HANG_MS + the floor for process start and a loaded machine. */
const BOUND_SLACK_MS = 4000;

/** A fake board: the routes the procedure uses, with switchable behaviour. */
function fakeBoard(opts = {}) {
  const calls = [];
  const state = { enrolled: !!opts.enrolled, on: false, up: false };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json', 'x-kosmos-board': opts.identity || BOARD }); res.end(JSON.stringify(j)); };
      if (req.url === '/') return send(200, {});
      if (req.headers['x-kosmos-board-token'] !== 'tok') return send(401, { error: 'no token' });
      if (req.url === '/api/remote') return send(200, { enrolled: state.enrolled, on: state.on, status: { state: state.up ? 'up' : 'off' } });
      if (req.url === '/api/remote/signin-start' && opts.startHangs) return;   // never answers
      if (req.url === '/api/remote/signin-start') return opts.startFails ? send(400, { error: 'coordinator down' }) : send(200, { ok: true, stage: 'code_sent' });
      if (req.url === '/api/remote/signin-cancel' && opts.cancelAnswersAfter) {
        /* #3986: a slow board answers the cleanup late. `answered` says the runner waited for it
           rather than abandoning it on its own clock. */
        const call = calls[calls.length - 1];
        let gone = false;
        res.on('close', () => { if (!res.writableFinished) gone = true; });
        /* unref: a late answer still pending when the test ends must not keep the process alive. */
        setTimeout(() => { if (!gone) { send(200, { ok: true }); call.answered = true; } }, opts.cancelAnswersAfter).unref();
        return undefined;
      }
      if (req.url === '/api/remote/signin-cancel') return send(200, { ok: true });
      if (req.url === '/api/remote/signin-verify') {
        if (opts.verifyHangs) return;   // never answers: the runner's own timeout must end it
        return send(200, { ok: true, stage: opts.stage || 'second', account_address: opts.verifyAddress, second_kind: opts.secondKind });
      }
      if (req.url === '/api/remote/signin-second') return send(200, { ok: true, stage: 'session', account_address: opts.secondAddress });
      if (req.url === '/api/remote/signin-enrol') return send(200, { secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', otpauth: 'otpauth://x' });
      if (req.url === '/api/remote/signin-confirm-enrol') return send(200, { ok: true, stage: 'session' });
      if (req.url === '/api/remote/signin-register') {
        if (opts.registerFails) { state.enrolled = true; return send(400, { error: 'register broke half way' }); }   // the files were written
        if (opts.registerRefusedClean) return send(400, { error: 'finish the code steps first' });   // nothing written
        if (opts.registerHangs) { state.enrolled = true; return; }   // it finishes on the board, but never answers
        state.enrolled = true; state.on = opts.switchOn !== false; state.up = state.on;
        return send(200, { ok: true, name: 'x' });
      }
      if (req.url === '/api/remote/forget') {
        const had = state.enrolled;
        state.enrolled = false; state.on = false; state.up = false;
        return send(200, had ? { ok: true, retired: true } : { ok: true, retired: false, because: 'this computer was not set up for Plus, so there was nothing to retire' });
      }
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
  return { KOSMOS_SEED_EMAIL: 'seed+kosmos@example.com', KOSMOS_STORE_ROOT: root, KOSMOS_PLUS_VERIFY_DIR: path.join(dir, 'records'), KOSMOS_SEED_TOTP: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', HOME: dir, KOSMOS_PLUS_UP_MS: '300', KOSMOS_PLUS_UP_POLL_MS: '50' };
}
async function both(b, e, ptr, finishArgs) {
  const s = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
  if (s.code !== 0) return s;
  return runner(['finish', '--pointer', ptr, '--port', String(b.port), ...finishArgs], e);
}
const rec = (e) => JSON.parse(fs.readFileSync(record.recordPath(SHA, e), 'utf8'));
const step = (r, id) => r.steps.find((s) => s.id === id);

test('#2036: a first sign-in on the staged board records a pass: enrolled, switched on, up, and the throwaway Mac retired', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard();
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'spam']);
    assert.strictEqual(r.code, 0, r.out);
    const got = rec(e);
    assert.strictEqual(got.result, 'pass');
    assert.strictEqual(got.placement, 'SPAM', 'the inbox placement was not recorded');
    assert.strictEqual(got.board, BOARD);
    assert.deepStrictEqual(record.validate(got, { version: VER, sha256: SHA }), { ok: true });
    assert.deepStrictEqual(b.calls.find((c) => c.url === '/api/remote/signin-start').body, { email: 'seed+kosmos@example.com' });
    assert.strictEqual(b.calls.find((c) => c.url === '/api/remote/signin-register').body.name, 'kseed-aaaaaaaa');
    assert.strictEqual(b.state.enrolled, false, 'the board was left enrolled');
  } finally { b.server.close(); }
});

test('#2036: a register that leaves the switch off (the #3827 class) fails the run, and the Mac is still retired', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ switchOn: false });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 1, r.out);
    const got = rec(e);
    assert.strictEqual(step(got, 'enrolled').result, 'pass', 'fixture: the identity was written');
    assert.strictEqual(step(got, 'up').result, 'fail', 'enrolled with the switch off passed');
    assert.match(step(got, 'up').detail, /switch was OFF/);
    assert.strictEqual(step(got, 'forget').result, 'pass');
  } finally { b.server.close(); }
});

test('#2036: a board that is not the staged build is refused, and nothing is recorded', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ identity: '9.9.8@default' });
  try {
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.strictEqual(r.code, 2);
    assert.match(r.out, /not the staged build 9\.9\.9/);
    assert.ok(!b.calls.some((c) => c.url === '/api/remote/signin-start'), 'a code was sent from the wrong build');
    assert.ok(!fs.existsSync(record.recordPath(SHA, e)));
  } finally { b.server.close(); }
});

test('#2036: a board that already holds a Kosmos+ identity is refused, and an earlier FAIL for this build still stands', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const failed = good(); failed.result = 'fail'; failed.steps = passSteps().map((s) => (s.id === 'up' ? { id: 'up', result: 'fail', detail: 'switch OFF' } : s));
  record.write(failed, e);
  const b = await fakeBoard({ enrolled: true });
  try {
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.strictEqual(r.code, 2);
    assert.match(r.out, /already holds a Kosmos\+ identity/);
    assert.ok(!b.calls.some((c) => c.url === '/api/remote/signin-start'));
    assert.strictEqual(rec(e).result, 'fail', 'a refused attempt deleted the earlier record');
    assert.strictEqual(runGate(e.KOSMOS_PLUS_VERIFY_DIR, ptr).status, 1, 'a second start turned a refusal into a HOLD');
  } finally { b.server.close(); }
});

test('#2036: setup mistakes (no code, no TOTP) record nothing and cancel the half sign-in', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard();
  try {
    let r = await both(b, e, ptr, ['--placement', 'INBOX']);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /nothing recorded/);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-cancel'), 'the half sign-in was left');
    assert.ok(!fs.existsSync(record.recordPath(SHA, e)), 'a setup mistake was recorded as a build result');
    const e2 = Object.assign({}, e, { KOSMOS_SEED_TOTP: '' });
    r = await both(b, e2, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /KOSMOS_SEED_TOTP is not set/);
    assert.ok(!fs.existsSync(record.recordPath(SHA, e)));
  } finally { b.server.close(); }
});

test('#2036: a register that fails half way is still followed by forget, so no throwaway Mac is left', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ registerFails: true });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 1, r.out);
    const got = rec(e);
    assert.deepStrictEqual(step(got, 'register'), { id: 'register', result: 'fail', detail: 'register broke half way' });
    assert.strictEqual(step(got, 'enrolled').detail, 'not reached');
    assert.ok(b.calls.some((c) => c.url === '/api/remote/forget'), 'a half-registered Mac was left');
    assert.strictEqual(b.state.enrolled, false);
    assert.deepStrictEqual(record.validate(got, { version: VER, sha256: SHA }), { ok: true });
  } finally { b.server.close(); }
});

test('#2036: a seed that owns an address registers to it; a start the coordinator refuses records placement NONE', async () => {
  let dir = tmp(); let e = env(dir); let ptr = pointerFile(dir);
  let b = await fakeBoard({ secondAddress: 'seedhome.kosmosplus.com' });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 0, r.out);
    assert.strictEqual(b.calls.find((c) => c.url === '/api/remote/signin-register').body.name, 'seedhome');
  } finally { b.server.close(); }
  dir = tmp(); e = env(dir); ptr = pointerFile(dir);
  b = await fakeBoard({ startFails: true });
  try {
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.strictEqual(r.code, 1, r.out);
    assert.strictEqual(rec(e).placement, 'NONE', 'a code that was never sent was given a placement');
  } finally { b.server.close(); }
});

test('#2036: the seed\'s first run enrols an authenticator and keeps its secret in a mode-600 file that survives a reboot, never on screen', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ stage: 'enrol_second_factor' });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(!r.out.includes('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), 'the authenticator secret was printed');
    const f = (/\/add-secret --migrate (\S+)/.exec(r.out) || [])[1];
    assert.ok(f && f.startsWith(path.join(dir, '.cache', 'claude-handoffs')), 'the secret file is not under ~/.cache/claude-handoffs: ' + f);
    assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  } finally { b.server.close(); }
});

test('#2036: a sign-in that skips the second step straight to a session is recorded as a fail, never a pass', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ stage: 'session' });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 1, r.out);
    const got = rec(e);
    assert.deepStrictEqual(step(got, 'second'), { id: 'second', result: 'fail', detail: 'no second step was asked for after the code' });
    assert.ok(!b.calls.some((c) => c.url === '/api/remote/signin-register'), 'it registered without a second step');
  } finally { b.server.close(); }
});

test('#2036: while an attempt is in flight the gate HOLDs over an old pass, but an old FAIL still refuses', () => {
  const dir = tmp(); const ptr = pointerFile(dir);
  const env0 = { KOSMOS_PLUS_VERIFY_DIR: dir };
  record.write(good(), env0);
  fs.writeFileSync(record.recordPath(SHA, env0).replace(/\.json$/, '.progress.json'), '{}');
  let r = runGate(dir, ptr);
  assert.strictEqual(r.status, 2, 'an old pass stood for an attempt in flight: ' + r.stdout);
  assert.match(r.stdout, /in flight/);
  const failed = good(); failed.result = 'fail'; failed.steps = passSteps().map((s) => (s.id === 'up' ? { id: 'up', result: 'fail' } : s));
  record.write(failed, env0);
  r = runGate(dir, ptr);
  assert.strictEqual(r.status, 1, 'an attempt in flight turned a refusal into a HOLD');
});

test('#2036: a board call that times out, or a seed whose second step is a text, is setup: nothing recorded', async () => {
  let dir = tmp(); let e = Object.assign(env(dir), { KOSMOS_PLUS_CALL_MS: HANG_MS }); let ptr = pointerFile(dir);
  let b = await fakeBoard({ verifyHangs: true });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-verify'), 'the runner stopped before the hanging verify: ' + r.out);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /nothing recorded/);
    assert.ok(!fs.existsSync(record.recordPath(SHA, e)), 'a timeout was recorded as a build failure');
  } finally { b.server.closeAllConnections(); b.server.close(); }
  dir = tmp(); e = env(dir); ptr = pointerFile(dir);
  b = await fakeBoard({ secondKind: 'sms' });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /not an authenticator/);
    assert.ok(!fs.existsSync(record.recordPath(SHA, e)));
  } finally { b.server.close(); }
});

test('#2036: a register refused before it wrote anything does not claim a throwaway Mac was left', async () => {
  const dir = tmp(); const e = env(dir); const ptr = pointerFile(dir);
  const b = await fakeBoard({ registerRefusedClean: true });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.strictEqual(r.code, 1, r.out);
    const got = rec(e);
    assert.strictEqual(step(got, 'register').result, 'fail');
    assert.deepStrictEqual(step(got, 'forget'), { id: 'forget', result: 'pass', detail: 'the register wrote nothing, so there was nothing to retire' });
  } finally { b.server.close(); }
});

test('#2036: a register that times out after finishing on the board is recorded as a fail, and its Mac is forgotten', async () => {
  const dir = tmp(); const e = Object.assign(env(dir), { KOSMOS_PLUS_REGISTER_MS: HANG_MS }); const ptr = pointerFile(dir);
  const b = await fakeBoard({ registerHangs: true });
  try {
    const r = await both(b, e, ptr, ['--code', '123456', '--placement', 'INBOX']);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-register'), 'the runner stopped before the hanging register: ' + r.out);
    assert.strictEqual(r.code, 1, r.out);
    const got = rec(e);
    assert.strictEqual(step(got, 'register').result, 'fail');
    assert.match(step(got, 'register').detail, /no answer from the board/);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/forget'), 'a register that timed out left its Mac');
    assert.deepStrictEqual(step(got, 'forget'), { id: 'forget', result: 'pass' }, 'forget did not retire a real registration (it failed, or found nothing to retire)');
    assert.strictEqual(b.state.enrolled, false);
  } finally { b.server.closeAllConnections(); b.server.close(); }
});

test('#2036: a signin-start that times out is setup: the earlier record stands and the half sign-in is cancelled', async () => {
  const dir = tmp(); const e = Object.assign(env(dir), { KOSMOS_PLUS_CALL_MS: HANG_MS }); const ptr = pointerFile(dir);
  record.write(good(), e);
  const b = await fakeBoard({ startHangs: true });
  try {
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-start'), 'the runner stopped before the hanging start: ' + r.out);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /nothing recorded/);
    assert.strictEqual(rec(e).result, 'pass', 'a slow coordinator replaced the build\'s record with a fail');
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-cancel'), 'the half sign-in was never cancelled: ' + r.out);
  } finally { b.server.closeAllConnections(); b.server.close(); }
});

test('#3986: a cleanup cancel that never answers is still bounded (a hung board must not hang the agent)', async () => {
  const dir = tmp(); const e = Object.assign(env(dir), { KOSMOS_PLUS_CALL_MS: HANG_MS }); const ptr = pointerFile(dir);
  record.write(good(), e);
  const b = await fakeBoard({ startHangs: true, cancelAnswersAfter: NEVER_MS });
  try {
    const began = Date.now();
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    const took = Date.now() - began;
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-start'), 'the runner stopped before the hanging start: ' + r.out);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-cancel'), 'the half sign-in was never cancelled: ' + r.out);
    assert.strictEqual(r.code, 2, r.out);
    assert.ok(took < Number(HANG_MS) + CLEANUP_FLOOR_MS + BOUND_SLACK_MS, 'the runner waited ' + took + 'ms on a cancel that never answered');
  } finally { b.server.closeAllConnections(); b.server.close(); }
});

test('#3986: the cleanup cancel after a timeout is not abandoned on the same short clock', async () => {
  /* Made deterministic: start times out at HANG_MS, and the board answers the cancel only after
     LATE_CANCEL_MS. On the old shared budget the runner gave up on the cancel; with the cleanup
     floor it waits for the answer. */
  const dir = tmp(); const e = Object.assign(env(dir), { KOSMOS_PLUS_CALL_MS: HANG_MS }); const ptr = pointerFile(dir);
  record.write(good(), e);
  assert.ok(Number(HANG_MS) + 500 < LATE_CANCEL_MS && LATE_CANCEL_MS < CLEANUP_FLOOR_MS, 'the late answer must land after HANG_MS and inside the floor');
  const b = await fakeBoard({ startHangs: true, cancelAnswersAfter: LATE_CANCEL_MS });
  try {
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.ok(b.calls.some((c) => c.url === '/api/remote/signin-start'), 'the runner stopped before the hanging start: ' + r.out);
    assert.strictEqual(r.code, 2, r.out);
    const cancel = b.calls.find((c) => c.url === '/api/remote/signin-cancel');
    assert.ok(cancel, 'the half sign-in was never cancelled: ' + r.out);
    assert.strictEqual(cancel.answered, true, 'the runner abandoned the cancel before the board answered it');
  } finally { b.server.closeAllConnections(); b.server.close(); }
});

test('#2036: with no seed address given, start is setup and nothing is sent', async () => {
  const dir = tmp(); const e = Object.assign(env(dir), { KOSMOS_SEED_EMAIL: '' }); const ptr = pointerFile(dir);
  const b = await fakeBoard();
  try {
    const r = await runner(['start', '--pointer', ptr, '--port', String(b.port)], e);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /no seed address/);
    assert.ok(!b.calls.some((c) => c.url === '/api/remote/signin-start'));
  } finally { b.server.close(); }
});
