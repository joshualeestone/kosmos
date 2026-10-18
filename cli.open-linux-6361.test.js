'use strict';
/**
 * kosmos#6361. `kosmos open` ran `${KOSMOS_OPEN_BIN:-/usr/bin/open}`, which is macOS's opener: most Linux systems
 * have no such file (on Debian and Ubuntu that path can be openvt). So on Linux it spent its one-time sign-in nonce
 * and then printed only the plain address, and a local browser tab could never be signed in that way.
 *
 * Now, with no KOSMOS_OPEN_BIN: Linux opens with xdg-open when there is a display; with no opener the person is
 * handed the address to open, and the one-time sign-in address (with its nonce) only on a terminal, never into a
 * pipe or a file. The #1765 refusals still come first: a board that fails the proof is neither opened nor printed.
 *
 * Linux is selected with KOSMOS_PLATFORM (the CLI's own platform seam), so these arms run on any machine. xdg-open
 * is a stub on PATH; nothing real opens. The stub board proves itself as the real one does (engine/boardproof).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const boardproof = require('./engine/boardproof');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-open-linux-6361-'));
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = DATA;
const ROOT = require('./engine/store').ROOT;
fs.mkdirSync(ROOT, { recursive: true });
const TOK = 'board-tok-6361';
const NONCE = 'ab12'.repeat(8);

const CLI = path.join(__dirname, 'install', 'kosmos');

// The installed layout (runtime/bin/node and app/engine), as the #1765 arms use it, so the CLI can make the proof.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-home-6361-'));
process.on('exit', () => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best effort */ } });
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
fs.mkdirSync(path.join(HOME, 'app'), { recursive: true });
fs.symlinkSync(path.join(__dirname, 'engine'), path.join(HOME, 'app', 'engine'));

// A stub xdg-open on PATH that records what it was handed.
const BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-xdg-6361-'));
process.on('exit', () => { try { fs.rmSync(BIN, { recursive: true, force: true }); } catch { /* best effort */ } });
const OPENED = path.join(BIN, 'opened');
fs.writeFileSync(path.join(BIN, 'xdg-open'), '#!/bin/sh\necho "$1" >> ' + JSON.stringify(OPENED) + '\n[ -f ' + JSON.stringify(path.join(BIN, 'fail')) + ' ] && exit 4\nexit 0\n', { mode: 0o755 });

function setToken(on) {
  const f = path.join(ROOT, 'board.token');
  if (on) fs.writeFileSync(f, TOK + '\n', { mode: 0o600 }); else fs.rmSync(f, { force: true });
}

/* A board stand-in: proves itself when `prove`, and mints NONCE at /api/board-nonce. */
function withStub({ prove, noNonce = false }, fn) {
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === boardproof.PROOF_PATH) {
        const q = Object.fromEntries(u.searchParams);
        const out = prove ? boardproof.answer(q, () => [TOK], req.socket.localPort, req.socket.localAddress) : { status: 200, body: { proof: 'a'.repeat(64) } };
        res.writeHead(out.status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(out.body));
      }
      if (req.method === 'POST' && u.pathname === '/api/board-nonce') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(noNonce ? {} : { nonce: NONCE }));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

/* Runs `kosmos open` as Linux. `tty` gives it a terminal through script(1), whose arguments differ by system. */
function open(port, { display = false, tty = false, agent = false, wayland = false, platform = 'Linux', openBin = '' } = {}) {
  return new Promise((resolve, reject) => {
    fs.rmSync(OPENED, { force: true });
    const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(port), KOSMOS_HOME: HOME,
      KOSMOS_PLATFORM: platform, PATH: BIN + path.delimiter + process.env.PATH };
    for (const v of ['KOSMOS_OPEN_BIN', 'DISPLAY', 'WAYLAND_DISPLAY', 'KOSMOS_AGENT_TOKEN', 'KOSMOS_AGENT_TOKEN_ONLY',
      'KOSMOS_AGENT_SESSION', 'KOSMOS_WORLD', 'TMUX', 'TMUX_PANE', 'http_proxy', 'https_proxy', 'all_proxy',
      'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY']) delete env[v];
    if (display) env.DISPLAY = ':0';
    if (wayland) env.WAYLAND_DISPLAY = 'wayland-0';
    if (openBin) env.KOSMOS_OPEN_BIN = openBin;
    if (agent) env.KOSMOS_AGENT_SESSION = 'fixture-agent-6361';   // how the supervisor marks an agent's pane
    const [cmd, args] = !tty ? [CLI, ['open']]
      : process.platform === 'darwin' ? ['script', ['-q', '/dev/null', CLI, 'open']]
        : ['script', ['-q', '-e', '-c', JSON.stringify(CLI) + ' open', '/dev/null']];
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code, sig) => {
      clearTimeout(t);
      const r = { code, out, opened: fs.existsSync(OPENED) ? fs.readFileSync(OPENED, 'utf8') : null };
      /* #3628: a killed CLI has no exit code; it must fail the test, never read as one. */
      if (typeof r.code !== 'number') { reject(new Error('the CLI gave no exit code (' + sig + '). ' + out)); return; }
      resolve(r);
    });
  });
}

test('#6361: on Linux with a display, kosmos open opens the sign-in address with xdg-open', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const r = await open(port, { display: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.opened || '', new RegExp('/\\?boot=' + NONCE), 'xdg-open was not handed the one-time sign-in address');
}));

test('#6361: on Linux with no display and no terminal, the one-time address is not printed, and it says why', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const r = await open(port);
  assert.equal(r.opened, null, 'an opener ran with no display');
  assert.doesNotMatch(r.out, new RegExp(NONCE), 'the one-time sign-in address went into a pipe');
  assert.match(r.out, /not a person's terminal, so the one-time sign-in address is not printed/);
  // The full path, not the bare name, which is not always on PATH.
  assert.match(r.out, new RegExp('In a terminal on this computer, run: "' + HOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/bin/kosmos" open'));
  assert.doesNotMatch(r.out, /sign in there/, 'it sends the person to a page with no way to sign in');
  assert.equal(r.code, 1, 'no way in was given, so it is not a success');
}));

test('#6361: on Linux with no display, at a terminal, the one-time sign-in address is printed for the person', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const r = await open(port, { tty: true });
  assert.equal(r.opened, null, 'an opener ran with no display');
  assert.match(r.out, new RegExp('/\\?boot=' + NONCE), 'the terminal was not handed the one-time sign-in address');
  assert.match(r.out, /within 2 minutes/);
  assert.equal(r.code, 0, r.out);
}));

test('#6361: a board with no token (not enforcing) is handed as its plain address, with no opener', () => withStub({ prove: true }, async (port) => {
  setToken(false);
  try {
    const r = await open(port);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Go to the dashboard yourself: http:\/\/127\.0\.0\.1:\d+/);
    assert.doesNotMatch(r.out, /boot=/);
  } finally { setToken(true); }
}));

test('#6361: a board that fails the proof is neither opened nor printed, even at a terminal (the #1765 refusal comes first)', () => withStub({ prove: false }, async (port) => {
  setToken(true);
  const r = await open(port, { tty: true, display: true });
  assert.equal(r.opened, null, 'a browser was opened at an unproven listener');
  assert.doesNotMatch(r.out, /boot=/, 'a sign-in address was printed for an unproven listener');
  assert.match(r.out, /we did not open the dashboard/);
  assert.notEqual(r.code, 0);
}));

test('#6361: in the source, Darwin keeps /usr/bin/open and the old macOS-only default is gone (a source check)', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const a = src.indexOf('cmd_open() {'), b = src.indexOf('\ncmd_agents() {');
  assert.ok(a >= 0 && b > a, 'cmd_open or the function after it moved, so this check would read the wrong text');
  const body = src.slice(a, b);
  assert.match(body, /Darwin\) _opener=\/usr\/bin\/open ;;/);
  assert.doesNotMatch(body, /\$\{KOSMOS_OPEN_BIN:-\/usr\/bin\/open\}/, 'the old macOS-only default is back');
});

test('#6361: an agent at a terminal is not handed the one-time address (its terminal is a transcript)', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const r = await open(port, { tty: true, agent: true });
  assert.doesNotMatch(r.out, new RegExp(NONCE), 'an agent was handed the one-time sign-in address');
  assert.match(r.out, /not a person's terminal/);
  assert.notEqual(r.code, 0);
  // CONTROL: the same terminal with no agent marking does print it (the arm above sees the agent, not a lost tty).
  const p = await open(port, { tty: true });
  assert.match(p.out, new RegExp('/\\?boot=' + NONCE), 'CONTROL: a person at the same terminal was not given the address');
}));

test('#6361: an opener that fails (a dead DISPLAY) still hands a person the one-time address, not just the plain one', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  fs.writeFileSync(path.join(BIN, 'fail'), '');
  try {
    const r = await open(port, { display: true, tty: true });
    assert.ok(r.opened, 'CONTROL: xdg-open was tried');
    assert.match(r.out, /Could not open a browser from here\./);
    assert.match(r.out, new RegExp('/\\?boot=' + NONCE), 'a failed opener left the person with no way in');
    assert.notEqual(r.code, 0, 'a failed open must still end non-zero (#1957)');
  } finally { fs.rmSync(path.join(BIN, 'fail'), { force: true }); }
}));

test('#6361: Wayland alone (no DISPLAY) counts as a display, so xdg-open opens the address', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const r = await open(port, { wayland: true });
  assert.match(r.opened || '', new RegExp('/\\?boot=' + NONCE), 'a Wayland-only desktop got no opener');
  assert.equal(r.code, 0, r.out);
}));

test('#6361: a platform that is neither macOS nor Linux runs no opener, and is handed the address the safe way', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const r = await open(port, { platform: 'FreeBSD', display: true });
  assert.equal(r.opened, null, 'an opener ran on a platform with none');
  assert.match(r.out, /No browser opens from here\./);
  assert.doesNotMatch(r.out, new RegExp(NONCE), 'the one-time address went into a pipe');
  assert.notEqual(r.code, 0);
}));

test('#6361: an opener that fails on an enforcing board, not at a terminal, ends non-zero and prints no one-time address', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const failing = path.join(BIN, 'fail-open.sh');
  fs.writeFileSync(failing, '#!/bin/sh\nexit 5\n', { mode: 0o755 });
  // KOSMOS_OPEN_BIN wins before the platform is read, so this is the failure path every platform shares (Darwin's too).
  const r = await open(port, { platform: 'Darwin', openBin: failing });
  assert.match(r.out, /Could not open a browser from here\./);
  assert.doesNotMatch(r.out, new RegExp(NONCE), 'a failed open put the one-time address in a pipe');
  assert.match(r.out, /not a person's terminal/);
  assert.notEqual(r.code, 0, 'a failed open must end non-zero (#1957)');
}));

test('#6361: an agent is told to ask the person, not given a step to take itself', () => withStub({ prove: true }, async (port) => {
  setToken(true);
  const r = await open(port, { agent: true });
  assert.match(r.out, /Tell the person who runs this computer to run, in a terminal on it: /);
  assert.doesNotMatch(r.out, new RegExp(NONCE));
}));

test('#6361: an enforcing board that answers without a nonce is not handed over as a dead-end plain address', () => withStub({ prove: true, noNonce: true }, async (port) => {
  setToken(true);
  const r = await open(port);
  assert.match(r.out, /could not make a one-time sign-in address/, 'a page that cannot sign in was handed over as the way in');
  assert.doesNotMatch(r.out, /Go to the dashboard yourself/);
  assert.notEqual(r.code, 0);
  // CONTROL: with no token (not enforcing), the same answer is the plain address, which works there.
  setToken(false);
  try {
    const p = await open(port);
    assert.match(p.out, /Go to the dashboard yourself: http/);
    assert.equal(p.code, 0, p.out);
  } finally { setToken(true); }
}));
