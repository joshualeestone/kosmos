'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9142: `kosmos task activity` prints a repeating task's runs and misses after its conversation, one line each,
 * newest first, on both commands, in the board's words. A task that does not repeat prints no such block.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included), as cli.task-activity-5874.test.js.
 *
 *   node --test cli.task-occurrences-9142.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-occ-cli-'));
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
const taskchat = require('./engine/taskchat');
const cli = require('./tools/windows/kosmos-cli');
const fleet = require('./test-support/fleet');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot run');

let base;
let projectId;
let repeating;
let plain;
let board;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Occ CLI' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara'], createdAt: '2020-01-01T00:00:00.000Z' }));
  repeating = tasks.create(projectId, { sentence: 'Check the logs', who: 'mara' }).number;
  plain = tasks.create(projectId, { sentence: 'Write the notes', who: 'mara' }).number;
  tasks.setRepeat(projectId, repeating, { every: 'hour' }, { person: true });
  tasks.recordRun(projectId, repeating, 'mara', 'all clear');
  board = fleet.install([fleet.agent('mara', { state: 'idle', ours: 'claim', displayName: 'Mara Lane' })]);
});
test.after(() => {
  try { board.restore(); } catch { /* not installed */ }
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function win(argv, url = base) {
  const out = []; const err = [];
  const code = await cli.main(argv, {
    env: {}, url,
    hook: { resolveUrl: () => url, readBoardToken: () => null, agentToken: () => null },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

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

const HEAD = 'Runs and misses, newest first (when each was due):';
const RUN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}  delivered (?:(?:on time|late) by Mara Lane \(at \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)|by Mara Lane before its first scheduled run)$/m;

test('Windows: a repeating task prints its runs and misses after the conversation, in the board\'s words', async () => {
  const w = await win(['task', 'activity', projectId, String(repeating)]);
  assert.equal(w.code, 0, w.out + w.err);
  assert.ok(w.out.includes(HEAD), w.out);
  assert.match(w.out.slice(w.out.indexOf(HEAD)), RUN);
});

test('Mac: the same block, line for line as Windows', { skip: SKIP_POSIX_SHELL }, async () => {
  const r = await mac(['task', 'activity', projectId, String(repeating)]);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(HEAD), r.out);
  const w = await win(['task', 'activity', projectId, String(repeating)]);
  assert.equal(r.out.trim(), w.out.trim(), 'the two commands printed different lines');
});

test('CONTROL: a task that does not repeat prints no runs-and-misses block, on either command', { skip: SKIP_POSIX_SHELL }, async () => {
  const w = await win(['task', 'activity', projectId, String(plain)]);
  assert.equal(w.code, 0, w.out + w.err);
  assert.ok(!w.out.includes(HEAD), w.out);
  const r = await mac(['task', 'activity', projectId, String(plain)]);
  assert.ok(!r.out.includes(HEAD), r.out);
});
