'use strict';
// kosmos#9018: tools/plus-signin-auto.sh runs the first Kosmos+ sign-in release gate in one command. Driven with
// FAKES only: a fake tarball whose "board" answers the sign-in routes, a fake kosmos-signin-code, a fake secrets dir.
// Nothing here reaches a real board, mailbox or coordinator.
require('./test-support/tmpscope'); // kosmos#5334: this process's temp folders, removed when it exits
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const record = require('./tools/lib/plus-signin-record');

const AUTO = path.join(__dirname, 'tools', 'plus-signin-auto.sh');
const GATE = path.join(__dirname, 'tools', 'plus-signin-verified.sh');
const VER = '9.9.9';
const SEED = 'hello+gate@example.com';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plus-auto-9018-'));

/* The fake board, baked into the tarball: the driver starts it with a clean environment, so its behaviour comes
   from app/fake.json beside it. It answers like a sandboxed board (no token checked) and logs every call. */
const FAKE_SERVER = `
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const o = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake.json'), 'utf8'));
const log = (l) => fs.appendFileSync(o.log, l + '\\n');
log('env ' + JSON.stringify({ home: process.env.HOME || '', runners: process.env.AGENT_WORKFORCE_RUNNERS_DIR || '', browser: process.env.KOSMOS_AGENT_BROWSER || '', data: process.env.AGENT_WORKFORCE_DATA || '', tmux: process.env.AGENT_WORKFORCE_TMUX_BIN || '', path: process.env.PATH }));
const st = { enrolled: false, on: false, up: false };
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
    log(req.method + ' ' + req.url);
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json', 'x-kosmos-board': o.identity }); res.end(JSON.stringify(j)); };
    if (req.url === '/') return send(200, {});
    if (req.url === '/api/remote') return send(200, { enrolled: st.enrolled, on: st.on, status: { state: st.up ? 'up' : 'off' } });
    if (req.url === '/api/remote/signin-start') return send(200, { ok: true, stage: 'code_sent' });
    if (req.url === '/api/remote/signin-cancel') return send(200, { ok: true });
    if (req.url === '/api/remote/signin-verify') return o.verifyFails ? send(400, { error: 'that code is not right' }) : send(200, { ok: true, stage: 'second', second_kind: 'totp' });
    if (req.url === '/api/remote/signin-second') return send(200, { ok: true, stage: 'session' });
    if (req.url === '/api/remote/signin-register') {
      /* Like kosmos-tunnel: a connector started from inside the work folder, detached, which outlives its board. */
      const c = require('node:child_process').spawn(process.execPath, [path.join(__dirname, 'child.js')], { detached: true, stdio: 'ignore' });
      c.unref(); log('child ' + c.pid);
      st.enrolled = true; st.on = true; st.up = true; return send(200, { ok: true });
    }
    if (req.url === '/api/remote/forget') { const had = st.enrolled; st.enrolled = st.on = st.up = false; return send(200, had ? { ok: true, retired: true } : { ok: true, retired: false, because: 'nothing to retire' }); }
    send(404, {});
  });
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function portAnswers(port) {
  return new Promise((resolve) => { const c = net.connect(port, '127.0.0.1'); c.on('connect', () => { c.destroy(); resolve(true); }); c.on('error', () => resolve(false)); });
}

/** A world: a fake tarball and its pointer, a fake code reader, a fake secrets dir, temp dirs for everything. */
function world(opts = {}) {
  const dir = tmp();
  const boardLog = path.join(dir, 'board.calls'); fs.writeFileSync(boardLog, '');
  const scLog = path.join(dir, 'sc.calls'); fs.writeFileSync(scLog, '');
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'app'), { recursive: true }); fs.mkdirSync(path.join(src, 'runtime', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(src, 'app', 'server.js'), FAKE_SERVER);
  fs.writeFileSync(path.join(src, 'app', 'child.js'), 'setInterval(() => {}, 1e6);\n');
  fs.writeFileSync(path.join(src, 'app', 'fake.json'), JSON.stringify({ log: boardLog, identity: opts.identity || VER + '@default', verifyFails: !!opts.verifyFails }));
  fs.writeFileSync(path.join(src, 'runtime', 'bin', 'node'), '#!/bin/sh\nexec "' + process.execPath + '" "$@"\n', { mode: 0o755 });
  const dist = path.join(dir, 'dist'); fs.mkdirSync(dist);
  const art = 'kosmos-' + VER + '-arm64.tar.gz';
  const tgz = path.join(dist, art);
  const t = spawnSync('tar', ['-czf', tgz, '-C', src, 'app', 'runtime']);
  assert.strictEqual(t.status, 0, String(t.stderr));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
  const pointer = path.join(dir, 'latest-staging.json');
  fs.writeFileSync(pointer, JSON.stringify({ version: VER, sha256: opts.pointerSha || sha, artifact: art }));
  const sc = path.join(dir, 'kosmos-signin-code');
  fs.writeFileSync(sc, '#!/bin/sh\necho "$* placement=${KOSMOS_SIGNIN_PLACEMENT:-} totp=${KOSMOS_SEED_TOTP:+SET}" >> "' + scLog + '"\n'
    + 'case "$1" in anchor) echo 100 ;; code) ' + (opts.noCode ? 'exit 1' : 'echo "123456 ' + (opts.placement || 'INBOX') + '"') + ' ;; esac\n', { mode: 0o755 });
  const home = path.join(dir, 'home'); fs.mkdirSync(path.join(home, '.config', 'secrets'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'secrets', 'kosmosplus-test-gate-totp.meta'),
    'purpose: a fake seed for the kosmos#9018 driver test\ntargets: kosmosplus-test-gate-totp, ' + SEED + '\nformat: bare-token\n');
  const scratch = path.join(dir, 'tmp'); fs.mkdirSync(scratch);
  const records = path.join(dir, 'records');
  const env = Object.assign({}, process.env, {
    HOME: home, TMPDIR: scratch, KOSMOS_PLUS_VERIFY_DIR: records, KOSMOS_SIGNIN_CODE_BIN: sc,
    KOSMOS_SEED_TOTP: 'otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=x',
    KOSMOS_PLUS_BOARD_UP_S: '20', KOSMOS_PLUS_UP_MS: '300', KOSMOS_PLUS_UP_POLL_MS: '50',
  });
  delete env.KOSMOS_STORE_ROOT;
  return { dir, pointer, dist, tgz, sha, boardLog, scLog, scratch, records, env };
}
function run(w, args) {
  return new Promise((resolve) => {
    const c = spawn('bash', [AUTO, ...args], { env: w.env });
    let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}
const calls = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
const recordOf = (w) => record.recordPath(w.sha, { KOSMOS_PLUS_VERIFY_DIR: w.records });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const leftovers = (w) => fs.readdirSync(w.scratch).filter((n) => n.startsWith('kplusgate.'));

test('#9018: one command takes the pointer\'s own tarball through a first sign-in, the gate then says yes, and nothing is left running', async () => {
  const w = world({ placement: 'SPAM' });
  const port = await freePort();
  const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(port), '--base-url', 'file://' + w.dist]);
  assert.strictEqual(r.code, 0, r.out);
  const rec = JSON.parse(fs.readFileSync(recordOf(w), 'utf8'));
  assert.strictEqual(rec.result, 'pass');
  assert.strictEqual(rec.board_kind, 'sandboxed');
  assert.strictEqual(rec.placement, 'SPAM', 'the placement the code reader gave was not recorded');
  assert.strictEqual(rec.seed, SEED);
  const g = spawnSync('bash', [GATE, w.pointer], { encoding: 'utf8', env: Object.assign({}, process.env, { KOSMOS_PLUS_VERIFY_DIR: w.records }) });
  assert.strictEqual(g.status, 0, g.stdout + g.stderr);
  assert.match(g.stdout, /on a sandboxed board\)/, 'the gate\'s pass line does not say the board was sandboxed');
  // The board ran fully sandboxed, from a clean environment.
  const envLine = JSON.parse(calls(w.boardLog)[0].replace(/^env /, ''));
  assert.ok(envLine.data.startsWith(w.scratch), 'the board\'s data root is not in the work folder: ' + envLine.data);
  assert.ok(envLine.home.startsWith(w.scratch), 'the board was given a HOME outside the work folder: ' + envLine.home);
  assert.ok(envLine.runners.startsWith(w.scratch), 'the board\'s runners are not in the work folder: ' + envLine.runners);
  assert.strictEqual(envLine.browser, 'off', 'the board would download the agents\' browser');
  assert.ok(envLine.tmux.startsWith(w.scratch), 'the board\'s tmux is not the work folder\'s stub');
  assert.strictEqual(envLine.path, '/usr/bin:/bin:/usr/sbin:/sbin', 'the board inherited this shell\'s PATH');
  // The code reader was asked for the placement, on the seed's base mailbox for the anchor.
  const sc = calls(w.scLog);
  assert.match(sc[0], /^anchor hello@example\.com placement= totp=$/, 'the code reader was handed the authenticator secret');
  assert.match(sc[1], /^code hello\+gate@example\.com 100 180 placement=1 totp=$/, 'the code reader was handed the authenticator secret');
  // Torn down: nothing answers on the port, the work folder is gone.
  assert.strictEqual(await portAnswers(port), false, 'the throwaway board is still running');
  assert.deepStrictEqual(leftovers(w), [], 'the work folder was left behind');
  // The detached child it started (the tunnel's stand-in) is stopped too.
  const child = calls(w.boardLog).find((l) => l.startsWith('child '));
  assert.ok(child, 'fixture: the fake board started no child');
  assert.strictEqual(alive(Number(child.split(' ')[1])), false, 'a process the board started is still running');
});

test('#9018: a seed that is not a listed plus-tag test address is refused before ANY call: no download, no board, no mail', async () => {
  const port = await freePort();
  for (const seed of ['hello@example.com', 'hello+other@example.com', 'HELLO+gate@example.com x', '']) {
    const w = world();
    const r = await run(w, ['--pointer', w.pointer, '--seed', seed, '--port', String(port), '--base-url', 'file:///nonexistent']);
    assert.strictEqual(r.code, 2, seed + ': ' + r.out);
    assert.match(r.out, /refused before any call/, seed);
    assert.deepStrictEqual(calls(w.scLog), [], seed + ': the mailbox was called');
    assert.deepStrictEqual(calls(w.boardLog), [], seed + ': a board was started');
    assert.deepStrictEqual(leftovers(w), [], seed + ': a work folder was made');
    assert.ok(!fs.existsSync(recordOf(w)), seed + ': something was recorded');
  }
  // CONTROL: the listed seed, in another case, gets past the guard (it then fails on the missing download).
  const w = world();
  const r = await run(w, ['--pointer', w.pointer, '--seed', 'Hello+Gate@example.com', '--port', String(port), '--base-url', 'file:///nonexistent']);
  assert.strictEqual(r.code, 2, r.out);
  assert.doesNotMatch(r.out, /refused before any call/);
  assert.match(r.out, /could not download/);
});

test('#9018: a tarball that is not the pointer\'s bytes is refused before anything boots, and nothing is recorded', async () => {
  const w = world({ pointerSha: 'b'.repeat(64) });
  const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(await freePort()), '--tarball', w.tgz]);
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /not the pointer's b{64}: refused, nothing was booted/);
  assert.deepStrictEqual(calls(w.boardLog), [], 'a board was started');
  assert.deepStrictEqual(calls(w.scLog), [], 'the mailbox was called');
  assert.ok(!fs.existsSync(record.recordPath('b'.repeat(64), { KOSMOS_PLUS_VERIFY_DIR: w.records })));
});

test('#9018: a board that is not the pointer\'s build leaves no pass record, and no code is sent from it', async () => {
  const w = world({ identity: '9.9.8@default' });
  const port = await freePort();
  const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(port), '--tarball', w.tgz]);
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /not the staged build 9\.9\.9/);
  assert.ok(!calls(w.boardLog).includes('POST /api/remote/signin-start'), 'a code was sent from the wrong build');
  assert.ok(!fs.existsSync(recordOf(w)), 'something was recorded');
  assert.strictEqual(await portAnswers(port), false, 'the throwaway board is still running');
});

test('#9018: a step that fails records a FAIL, which the gate refuses on', async () => {
  const w = world({ verifyFails: true });
  const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(await freePort()), '--tarball', w.tgz]);
  assert.strictEqual(r.code, 1, r.out);
  const rec = JSON.parse(fs.readFileSync(recordOf(w), 'utf8'));
  assert.strictEqual(rec.result, 'fail');
  assert.strictEqual(rec.steps.find((s) => s.id === 'verify').result, 'fail');
  const g = spawnSync('bash', [GATE, w.pointer], { encoding: 'utf8', env: Object.assign({}, process.env, { KOSMOS_PLUS_VERIFY_DIR: w.records }) });
  assert.strictEqual(g.status, 1, g.stdout + g.stderr);
});

test('#9018: no code arriving records nothing (the gate cannot tell), and the board is still stopped', async () => {
  const w = world({ noCode: true });
  const port = await freePort();
  const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(port), '--tarball', w.tgz]);
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /no sign-in code reached/);
  assert.ok(!fs.existsSync(recordOf(w)), 'something was recorded');
  assert.ok(!fs.existsSync(recordOf(w).replace(/\.json$/, '.progress.json')), 'start\'s progress file was left, so the gate reads an attempt in flight');
  assert.strictEqual(await portAnswers(port), false, 'the throwaway board is still running');
  assert.deepStrictEqual(leftovers(w), [], 'the work folder was left behind');
});

test('#9018: with KOSMOS_SEED_TOTP unset the secret is read through the secrets map, by the meta target that is not an address', async () => {
  const w = world();
  const bin = path.join(w.dir, 'bin'); fs.mkdirSync(bin);
  const asked = path.join(w.dir, 'secrets.calls');
  fs.writeFileSync(path.join(bin, 'secrets-map.sh'), '#!/bin/sh\necho "$*" >> "' + asked + '"\n'
    + '[ "$1 $2" = "value kosmosplus-test-gate-totp" ] && printf GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ\n', { mode: 0o755 });
  delete w.env.KOSMOS_SEED_TOTP;
  w.env.PATH = bin + ':' + w.env.PATH;
  const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(await freePort()), '--tarball', w.tgz]);
  assert.strictEqual(r.code, 0, r.out);
  assert.deepStrictEqual(calls(asked), ['value kosmosplus-test-gate-totp']);
  // CONTROL: a map that has no such secret is refused, naming the reason, before anything is downloaded.
  const w2 = world();
  fs.writeFileSync(path.join(bin, 'secrets-map.sh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  delete w2.env.KOSMOS_SEED_TOTP; w2.env.PATH = bin + ':' + w2.env.PATH;
  const r2 = await run(w2, ['--pointer', w2.pointer, '--seed', SEED, '--port', String(await freePort()), '--tarball', w2.tgz]);
  assert.strictEqual(r2.code, 2, r2.out);
  assert.match(r2.out, /no authenticator secret/);
  assert.deepStrictEqual(calls(w2.boardLog), [], 'a board was started');
});

test('#9018: a progress file from a run started by hand on an installed board is left alone', async () => {
  const w = world({ noCode: true });
  const prog = recordOf(w).replace(/\.json$/, '.progress.json');
  /* Not this run's: an installed board's start. The driver's own start overwrites it during the run, so put it
     back in place from the code reader, which runs after start and before teardown. */
  const theirs = JSON.stringify({ version: VER, sha256: w.sha, kind: 'installed', startedAt: new Date().toISOString(), steps: [] });
  fs.writeFileSync(path.join(w.dir, 'theirs.json'), theirs);
  fs.writeFileSync(path.join(w.dir, 'kosmos-signin-code'), '#!/bin/sh\ncase "$1" in anchor) echo 100 ;; code) cp "' + path.join(w.dir, 'theirs.json') + '" "' + prog + '"; exit 1 ;; esac\n', { mode: 0o755 });
  const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(await freePort()), '--tarball', w.tgz]);
  assert.strictEqual(r.code, 2, r.out);
  assert.ok(fs.existsSync(prog), 'another run\'s progress file was removed');
  assert.strictEqual(JSON.parse(fs.readFileSync(prog, 'utf8')).kind, 'installed');
});

test('#9018: a flag given with no value is refused, not looped on', async () => {
  const w = world();
  for (const flag of ['--seed', '--pointer', '--port', '--base-url', '--tarball']) {
    const r = await new Promise((resolve) => {
      const c = spawn('bash', [AUTO, flag], { env: w.env });
      const t = setTimeout(() => c.kill('SIGKILL'), 10000);
      let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
      c.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
    });
    assert.strictEqual(r.code, 2, flag + ': ' + r.out);
    assert.match(r.out, new RegExp(flag + ' needs a value'));
  }
});

test('#9018: a port something already answers on is refused before anything is downloaded', async () => {
  const w = world();
  const s = net.createServer(); await new Promise((res) => s.listen(0, '127.0.0.1', res));
  try {
    const r = await run(w, ['--pointer', w.pointer, '--seed', SEED, '--port', String(s.address().port), '--tarball', w.tgz]);
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /already answers on port/);
    assert.deepStrictEqual(leftovers(w), []);
  } finally { s.close(); }
});
