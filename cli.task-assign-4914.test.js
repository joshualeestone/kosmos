'use strict';

/**
 * #4914: `kosmos task assign <project> <n> <agent|me|nobody> [--part <m>]` from both commands (Mac install/kosmos,
 * Windows tools/windows/kosmos-cli.js) against a real board and the real task engine: it reaches the task's owner,
 * the answer says who has it now, bad forms stop before the board, and the board's refusals come through. The
 * route's own rules are proven in server.task-assign-4914.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-assign-4914.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskassign-cli-'));
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
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Moves' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara', 'otto'] }));
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  try { board.restore(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const ownerOf = (n) => tasks.whoOf(tasks.byNumber(projects.readAll().find((p) => p.id === projectId), n));
const fresh = (sentence, who) => tasks.create(projectId, { sentence, who }).number;

async function win(argv, agentToken = null) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url: base,
    hook: { resolveUrl: () => base, readBoardToken: () => null, agentToken: () => agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n'), text: out.join('\n') + err.join('\n') };
}
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, agentToken = '') {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: agentToken };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, text: (stdout || '') + (stderr || '') });
    });
  });
}
const BOTH = [['Windows', win], ['Mac', mac]];

test('both CLIs move a task to another agent, to me, and to nobody, and say who has it now', async () => {
  const mara = sendertoken.mint('mara').token;
  for (const [label, run] of BOTH) {
    const n = fresh(label + ': brief', 'mara');
    const to = await run(['task', 'assign', projectId, '00' + n, 'otto'], mara);   // leading zeros are said back without them
    assert.equal(to.code, 0, label + ': ' + to.text);
    assert.match(to.text, new RegExp('Task ' + n + ' on ' + projectId + ' is now with otto\\. See it with'), label + ': ' + to.text);
    assert.deepEqual(ownerOf(n), ['otto'], label);
    const me = await run(['task', 'assign', projectId, String(n), 'me'], mara);
    assert.equal(me.code, 0, label + ': ' + me.text);
    assert.match(me.text, /is now with mara\./, label + ': `me` did not come back as the caller: ' + me.text);
    assert.deepEqual(ownerOf(n), ['mara'], label);
    const off = await run(['task', 'assign', projectId, String(n), 'nobody'], mara);
    assert.equal(off.code, 0, label + ': ' + off.text);
    assert.match(off.text, /now has nobody on it\./, label + ': ' + off.text);
    assert.deepEqual(ownerOf(n), [], label);
  }
});

test('both CLIs: a task with several parts comes back as the board\'s list; --part moves the one named', async () => {
  const mara = sendertoken.mint('mara').token;
  for (const [label, run] of BOTH) {
    const n = fresh(label + ': launch', 'mara');
    tasks.addPart(projectId, n, { sentence: 'Write the "post" \\ today', who: 'otto' });
    const r = await run(['task', 'assign', projectId, String(n), 'otto'], mara);
    assert.equal(r.code, 1, label + ': ' + r.text);
    // A quote and a backslash in a part's words must not cut the list short (the Mac CLI reads it with sed).
    assert.match(r.text, /has 2 parts: 1 .*\(mara\); 2 Write the post today \(otto\)\. Name one with --part <number>/, label + ': ' + r.text);
    const p2 = await run(['task', 'assign', projectId, String(n), 'mara', '--part', '2'], mara);
    assert.equal(p2.code, 0, label + ': ' + p2.text);
    assert.match(p2.text, new RegExp('Task ' + n + ', part 2, on ' + projectId + ' is now with mara\\.'), label + ': ' + p2.text);
    assert.deepEqual(ownerOf(n), ['mara'], label);
  }
});

test('both CLIs refuse bad forms before the board (exit 2), and pass the board\'s refusals on (exit 1)', async () => {
  const mara = sendertoken.mint('mara').token;
  for (const [label, run] of BOTH) {
    const n = fresh(label + ': stays', 'mara');
    for (const bad of [[], ['x'], [String(n)], ['two', 'otto'], [String(n), '--part'], [String(n), 'otto', '--part', 'b'],
      [String(n), 'otto', '--part=2'], [String(n), '--part', '1'], [String(n), 'otto', 'mara'], [String(n), '   '], [String(n), '\u0001'], [String(n), '-x']]) {
      const r = await run(['task', 'assign', projectId, ...bad], mara);
      assert.equal(r.code, 2, label + ' ' + JSON.stringify(bad) + ': ' + r.text);
    }
    const zed = await run(['task', 'assign', projectId, String(n), 'zed'], mara);
    assert.equal(zed.code, 1, label + ': ' + zed.text);
    assert.match(zed.text, /not on this project/, label);
    const unnamed = await run(['task', 'assign', projectId, String(n), 'me']);
    assert.equal(unnamed.code, 1, label + ': ' + unnamed.text);
    assert.match(unnamed.text, /could not tell which agent you are/, label);
    assert.deepEqual(ownerOf(n), ['mara'], label + ': a refused move changed the owner');
  }
});

test('both CLIs list assign in their help', async () => {
  for (const [label, run] of BOTH) {
    const r = await run(['task', 'help']);
    assert.match(r.text, /kosmos task <list\|add\|assign\|close/, label + ': ' + r.text);
    assert.match(r.text, /kosmos task assign <project-id> <task-number> <agent\|me\|nobody>/, label);
  }
});
