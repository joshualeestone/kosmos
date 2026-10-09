'use strict';

/**
 * #5705 (user feedback, 2026-10-09): `kosmos task list` was one flat list of every task in every state. It now lists
 * open work first, then built, then on hold, then done (each newest first, as before), and `--state` keeps one group,
 * on both commands (Mac install/kosmos, Windows tools/windows/kosmos-cli.js). The board's route does the grouping
 * (`?order=state`, `&state=`), so the two commands cannot order it differently; with neither, the route is unchanged.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-list-state-5705.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskliststate-cli-'));
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
const tasks = require('./engine/tasks');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
const N = {};
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'States' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara'] }));
  /* Made in an order that is NOT the group order, so a list that kept the old order fails. */
  for (const k of ['done', 'held', 'open1', 'built', 'heldbuilt', 'open2']) {
    const t = tasks.create(projectId, { sentence: 'Task ' + k, who: 'mara' });
    assert.ok(t && Number.isInteger(t.number), JSON.stringify(t));
    N[k] = t.number;
  }
  assert.ok(tasks.setBuilt(projectId, N.built, { by: 'mara' }).ok);
  assert.ok(tasks.setBuilt(projectId, N.heldbuilt, { by: 'mara' }).ok);
  tasks.setOnHold(projectId, N.held, true);
  tasks.setOnHold(projectId, N.heldbuilt, true);   // on hold AND built: held, as its [on hold] mark prints first
  tasks.close(projectId, N.done);
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const read = async (q) => {
  const res = await fetch(`${base}/api/tasks?project=${encodeURIComponent(projectId)}${q}`);
  return { status: res.status, body: await res.json() };
};
const names = (rows) => rows.map((t) => t.sentence.replace('Task ', ''));
/* Newest first within a group, as allTasks orders them. */
const WANT = ['open2', 'open1', 'built', 'heldbuilt', 'held', 'done'];

test('engine: each task is in one group, and the marks decide it (done, then on hold, then built)', () => {
  assert.deepEqual(tasks.LIST_GROUPS, ['open', 'built', 'held', 'done']);
  assert.equal(tasks.listGroup({ isClosed: true, builtAt: 'x', onHold: true }), 'done');
  assert.equal(tasks.listGroup({ builtAt: '2026-10-09T00:00:00Z', projectPaused: true }), 'held');
  assert.equal(tasks.listGroup({ builtAt: '2026-10-09T00:00:00Z' }), 'built');
  assert.equal(tasks.listGroup({ builtAt: '' }), 'open');
  assert.equal(tasks.listGroup({}), 'open');
  // Stable within a group, and `only` keeps one group.
  const rows = [{ n: 1, builtAt: 'x' }, { n: 2 }, { n: 3, builtAt: 'x' }, { n: 4 }];
  assert.deepEqual(tasks.inListOrder(rows).map((r) => r.n), [2, 4, 1, 3]);
  assert.deepEqual(tasks.inListOrder(rows, 'built').map((r) => r.n), [1, 3]);
});

test('route: ?order=state groups the rows; &state= keeps one; an unknown state is refused; without them, unchanged', async () => {
  const grouped = await read('&order=state');
  assert.equal(grouped.status, 200);
  assert.deepEqual(names(grouped.body.tasks), WANT);
  assert.equal(grouped.body.count, WANT.length);
  const built = await read('&order=state&state=built');
  assert.deepEqual(names(built.body.tasks), ['built']);
  assert.equal(built.body.count, 1);
  assert.deepEqual(names((await read('&state=held')).body.tasks), ['heldbuilt', 'held']);
  const bad = await read('&state=active');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /open, built, held, done/);
  // CONTROL: no order asked, so the old order (open first, closed last, newest first) is untouched.
  assert.deepEqual(names((await read('')).body.tasks), ['open2', 'heldbuilt', 'built', 'open1', 'held', 'done']);
});

const lineOrder = (out) => out.split('\n').filter((l) => /^\[\d+\] /.test(l)).map((l) => l.replace(/^.*Task (\S+).*$/, '$1'));

// ── Windows: tools/windows/kosmos-cli.js ────────────────────────────────────
async function win(argv) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('Windows: task list prints open first, then built, on hold, done; --state keeps one; a bad state is refused', async () => {
  const all = await win(['task', 'list', projectId]);
  assert.equal(all.code, 0, all.err);
  assert.deepEqual(lineOrder(all.out), WANT, all.out);
  const one = await win(['task', 'list', projectId, '--state', 'built']);
  assert.equal(one.code, 0, one.err);
  assert.deepEqual(lineOrder(one.out), ['built'], one.out);
  const bad = await win(['task', 'list', projectId, '--state', 'active']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--state takes one of: open, built, held, done\./);
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: '' };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('Mac: task list prints open first, then built, on hold, done; --state keeps one; a bad state is refused', async () => {
  const all = await mac(['task', 'list', projectId]);
  assert.equal(all.code, 0, all.out);
  assert.deepEqual(lineOrder(all.out), WANT, all.out);
  const one = await mac(['task', 'list', projectId, '--state', 'held']);
  assert.equal(one.code, 0, one.out);
  assert.deepEqual(lineOrder(one.out), ['heldbuilt', 'held'], one.out);
  const bad = await mac(['task', 'list', projectId, '--state', 'active']);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /--state takes one of: open, built, held, done\./);
});
