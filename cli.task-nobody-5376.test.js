'use strict';

/**
 * #5376: `kosmos task add` with no --who gives the task to nobody, and the board's Assigner may later hand it to an
 * idle agent on the project, which read to an agent as Kosmos guessing. Both commands (Mac install/kosmos, Windows
 * tools/windows/kosmos-cli.js) now say so, with how to choose, ONLY when the board says nobody ("who": null): never
 * for a named owner, never when a name came back unreadable, never for an answer with no who at all.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-nobody-5376.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tasknobody-cli-'));
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
  projectId = projects.create({ name: 'Nobody' }).id;
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

const NOBODY = /Nobody has it yet, so an idle agent on the project may be given it\. To choose who does it: kosmos task assign (\S+) (\S+) <agent>/;

test('Windows: no --who, the real board says nobody, and the line names the real number and how to choose', async () => {
  const r = await win(['task', 'add', projectId, 'Win: nobody yet']);
  assert.equal(r.code, 0, r.err);
  const n = await numberOf('Win: nobody yet');
  const m = r.out.match(NOBODY);
  assert.ok(m, r.out);
  assert.deepEqual([m[1], m[2]], [projectId, String(n)]);
  const owned = await win(['task', 'add', projectId, 'Win: for mara', '--who', 'mara']);
  assert.equal(owned.code, 0, owned.err);
  assert.match(owned.out, /, for mara\./);
  assert.doesNotMatch(owned.out, /Nobody has it/, 'CONTROL: a named owner gets no nobody line');
});

test('Windows: no line for an answer without a who, and <task-number> when the board gives no number', async () => {
  const none = await fakeBoard('{"task":{"number":5}}');
  try {
    const r = await win(['task', 'add', 'p1', 'x'], `http://127.0.0.1:${none.address().port}`);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /Nobody has it/, 'no who key: the board did not say nobody');
  } finally { none.close(); }
  const nonum = await fakeBoard('{"task":{"who":null}}');
  try {
    const r = await win(['task', 'add', 'p1', 'x'], `http://127.0.0.1:${nonum.address().port}`);
    assert.match(r.out, /kosmos task assign p1 <task-number> <agent>/, r.out);
  } finally { nonum.close(); }
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

test('Mac: no --who, the real board says nobody, and the line names the real number and how to choose', async () => {
  const r = await mac(['task', 'add', projectId, 'Mac: nobody yet']);
  assert.equal(r.code, 0, r.out);
  const n = await numberOf('Mac: nobody yet');
  const m = r.out.match(NOBODY);
  assert.ok(m, r.out);
  assert.deepEqual([m[1], m[2]], [projectId, String(n)]);
  const owned = await mac(['task', 'add', projectId, 'Mac: for mara', '--who', 'mara']);
  assert.equal(owned.code, 0, owned.out);
  assert.match(owned.out, /, for mara\./);
  assert.doesNotMatch(owned.out, /Nobody has it/, 'CONTROL: a named owner gets no nobody line');
});

test('Mac: never says nobody for an unreadable name or an answer without a who; <task-number> with no number', async () => {
  // A name with a backslash is not said (#4887), so _for is empty: that must not read as nobody.
  for (const body of ['{"task":{"number":5,"who":"a\\\\b"}}', '{"task":{"number":5}}']) {
    const srv = await fakeBoard(body);
    try {
      const r = await mac(['task', 'add', 'p1', 'x'], srv.address().port);
      assert.equal(r.code, 0, body + ' ' + r.out);
      assert.match(r.out, /Task 5 added to p1\. See it with/, body);
      assert.doesNotMatch(r.out, /Nobody has it/, body);
    } finally { srv.close(); }
  }
  const srv = await fakeBoard('{"task":{"who":null}}');
  try {
    const r = await mac(['task', 'add', 'p1', 'x'], srv.address().port);
    assert.match(r.out, /kosmos task assign p1 <task-number> <agent>/, r.out);
  } finally { srv.close(); }
});
