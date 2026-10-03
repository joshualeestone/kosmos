'use strict';

/**
 * #5175: `kosmos task add` says the new task's number, from both commands (Mac install/kosmos, Windows
 * tools/windows/kosmos-cli.js), against a real board and the real task engine. The number said is the one the
 * board stored (read back from /api/tasks), it counts up across adds, and an answer that carries no usable number
 * keeps the sentence without one rather than print a wrong or blank number.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-number-5175.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasknum-cli-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Numbers' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara'] }));
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const rows = async () => (await (await fetch(`${base}/api/tasks?project=${encodeURIComponent(projectId)}`)).json()).tasks;
const numberOf = async (s) => (await rows()).find((t) => t.sentence === s).number;

/* A stand-in board that answers every task add with a fixed body, for the answers a real board never sends. */
async function fakeBoard(body) {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      // The Mac command's health probe wants the board's own name in the answer (install/kosmos _health_probe).
      if (req.url.startsWith('/api/health')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"app":"kosmos"}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(body);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return srv;
}

// ── Windows: tools/windows/kosmos-cli.js ────────────────────────────────────
async function win(argv, url = base) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url,
    hook: { resolveUrl: () => url, readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('Windows `task add` says the number the board stored, and it counts up', async () => {
  const a = await win(['task', 'add', projectId, 'Win: first']);
  assert.equal(a.code, 0, a.err);
  const na = await numberOf('Win: first');
  assert.match(a.out, new RegExp(`^Task ${na} added to ${projectId}\\. See it with`));
  const b = await win(['task', 'add', projectId, 'Win: second', '--who', 'mara']);
  assert.equal(b.code, 0, b.err);
  const nb = await numberOf('Win: second');
  assert.equal(nb, na + 1);
  assert.match(b.out, new RegExp(`^Task ${nb} added to ${projectId}, for mara\\. See it with`));
});

test('Windows `task add` keeps the sentence without a number when the answer has none it can use', async () => {
  for (const body of ['{"task":{"sentence":"x"}}', '{"task":{"number":"7"}}', '{"task":{"number":0}}', '{"task":{"number":1.5}}']) {
    const srv = await fakeBoard(body);
    try {
      const r = await win(['task', 'add', 'p1', 'x'], `http://127.0.0.1:${srv.address().port}`);
      assert.equal(r.code, 0, body + ' ' + r.err);
      assert.match(r.out, /^Task added to p1\. See it with/, body);
    } finally { srv.close(); }
  }
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
/* A KOSMOS_HOME whose runtime/bin/node is this node, as on an installed Mac (as in cli.task-who-4887.test.js). */
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, port = server.address().port) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac `task add` says the number the board stored, and it counts up', async () => {
  const a = await mac(['task', 'add', projectId, 'Mac: first']);
  assert.equal(a.code, 0, a.out);
  const na = await numberOf('Mac: first');
  assert.match(a.out, new RegExp(`Task ${na} added to ${projectId}\\. See it with`));
  const b = await mac(['task', 'add', projectId, 'Mac: second', '--who', 'mara']);
  assert.equal(b.code, 0, b.out);
  const nb = await numberOf('Mac: second');
  assert.equal(nb, na + 1);
  assert.match(b.out, new RegExp(`Task ${nb} added to ${projectId}, for mara\\. See it with`));
});

test('Mac `task add` keeps the sentence without a number when the answer has none it can use', async () => {
  // A number hidden in the sentence, a string, a zero, a fraction, an exponent: none is a whole task number.
  for (const body of ['{"task":{"sentence":"number\\":9"}}', '{"task":{"number":"7"}}', '{"task":{"number":0}}', '{"task":{"number":1.5}}', '{"task":{"number":12e3}}']) {
    const srv = await fakeBoard(body);
    try {
      const r = await mac(['task', 'add', 'p1', 'x'], srv.address().port);
      assert.equal(r.code, 0, body + ' ' + r.out);
      assert.match(r.out, /Task added to p1\. See it with/, body);
      assert.doesNotMatch(r.out, /Task \d/, body);
    } finally { srv.close(); }
  }
});

test('both commands say the number when it is the task\'s last key too (the "}" ending)', async () => {
  const srv = await fakeBoard('{"task":{"number":12}}');
  try {
    const m = await mac(['task', 'add', 'p1', 'x'], srv.address().port);
    assert.equal(m.code, 0, m.out);
    assert.match(m.out, /Task 12 added to p1\. See it with/);
    const w = await win(['task', 'add', 'p1', 'x'], `http://127.0.0.1:${srv.address().port}`);
    assert.equal(w.code, 0, w.err);
    assert.match(w.out, /^Task 12 added to p1\. See it with/);
  } finally { srv.close(); }
});
