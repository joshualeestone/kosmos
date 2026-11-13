'use strict';

/**
 * kosmos#8501: `kosmos task add ... --who <agent> --add-member` and `kosmos task assign ... <agent> --add-member` from
 * both commands (Mac install/kosmos, Windows tools/windows/kosmos-cli.js) against a real board and the real task
 * engine. Without the flag the board's refusal names it; with it the agent joins the project and holds the task, and
 * the CLI says it was added first. The route's own rules are proven in server.task-addmember-8501.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-addmember-8501.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskaddmember-cli-'));
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
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378

let base;
let projectId;
let board;
test.before(async () => {
  board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('otto', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('yan', { state: 'idle' })]);
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
/* kosmos#8378: on Windows the Mac CLI (install/kosmos) runs by its shebang line, which Windows cannot do, so the
   tests that loop over both commands drive only the Windows CLI there. Everywhere else CLIS is BOTH. */
const CLIS = BOTH.filter(([label]) => !(label === 'Mac' && SKIP_POSIX_SHELL));

const members = () => (projects.readAll().find((p) => p.id === projectId).agents || []).slice();
const off = (name) => projects.mutate(projectId, (p) => ({ ...p, agents: (p.agents || []).filter((a) => a !== name) }));

test('both CLIs: without --add-member the refusal names it; with it the agent joins and gets the task, and the CLI says so first', async () => {
  const mara = sendertoken.mint('mara').token;
  for (const [label, run] of CLIS) {
    off('zed');
    const no = await run(['task', 'add', projectId, label + ': check the numbers', '--who', 'zed'], mara);
    assert.equal(no.code, 1, label + ': ' + no.text);
    assert.match(no.text, /run the same command again with --add-member/, label + ': ' + no.text);
    assert.equal(members().includes('zed'), false, label);
    const yes = await run(['task', 'add', projectId, label + ': check the numbers', '--who', 'zed', '--add-member'], mara);
    assert.equal(yes.code, 0, label + ': ' + yes.text);
    const lines = yes.text.split('\n').map((l) => l.trim()).filter(Boolean);
    assert.equal(lines[0], 'zed was not on ' + projectId + ', so Kosmos added it to the project first. See who is on it with: kosmos project show ' + projectId, label + ': ' + yes.text);
    assert.match(lines[1], /^Task \d+ added to .*, for zed\./, label + ': ' + yes.text);
    assert.equal(members().includes('zed'), true, label);
    // CONTROL: zed is on now, so the same flag adds nobody and the CLI says nothing about adding.
    const again = await run(['task', 'add', projectId, label + ': and again', '--who', 'zed', '--add-member'], mara);
    assert.equal(again.code, 0, label + ': ' + again.text);
    assert.doesNotMatch(again.text, /so Kosmos added it/, label + ': ' + again.text);
  }
});

test('both CLIs: task assign --add-member puts the agent on the project and moves the task to it', async () => {
  const mara = sendertoken.mint('mara').token;
  for (const [label, run] of CLIS) {
    off('yan');
    const n = fresh(label + ': brief', 'mara');
    const r = await run(['task', 'assign', projectId, String(n), 'yan', '--add-member'], mara);
    assert.equal(r.code, 0, label + ': ' + r.text);
    assert.match(r.text, /yan was not on .*, so Kosmos added it to the project first\./, label + ': ' + r.text);
    assert.match(r.text, new RegExp('Task ' + n + ' on ' + projectId + ' is now with yan\\.'), label + ': ' + r.text);
    assert.deepEqual(ownerOf(n), ['yan'], label);
    assert.equal(members().includes('yan'), true, label);
  }
});

test('both CLIs: --add-member without --who on task add stops before the board (exit 2), and nothing is added', async () => {
  const mara = sendertoken.mint('mara').token;
  for (const [label, run] of CLIS) {
    const before = (projects.readAll().find((p) => p.id === projectId).tasks || []).length;
    const r = await run(['task', 'add', projectId, label + ': nobody named', '--add-member'], mara);
    assert.equal(r.code, 2, label + ': ' + r.text);
    assert.match(r.text, /--add-member goes with --who <agent>/, label + ': ' + r.text);
    assert.equal((projects.readAll().find((p) => p.id === projectId).tasks || []).length, before, label);
  }
});
