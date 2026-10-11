'use strict';

/**
 * #5874: `kosmos task activity <project-id> <task-number>` prints a task's conversation, oldest first, one line per event,
 * in the page's words, on both commands (Mac install/kosmos, Windows tools/windows/kosmos-cli.js), from the board's
 * route. #5842's kept-sent and kept-dropped events reach it (as their bare kind until their words land in
 * engine/taskactphrase.js and the page, the page's own rule for a kind it does not know).
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test cli.task-activity-5874.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-taskact-cli-'));
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

let base;
let projectId;
let num;
let quiet;
let quietNum;
let board;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  projectId = projects.create({ name: 'Activity' }).id;
  projects.mutate(projectId, (p) => ({ ...p, agents: ['mara'] }));
  const t = tasks.create(projectId, { sentence: 'Write the notes', who: 'mara' });
  assert.ok(t && Number.isInteger(t.number), JSON.stringify(t));
  num = t.number;
  // tasks.create records "created" itself; the rest are recorded as the board records them.
  assert.ok(taskchat.record(projectId, num, { kind: 'said', who: 'mara', text: 'on it,\nstarting now' }));
  assert.ok(taskchat.record(projectId, num, { kind: 'kept-sent', who: 'mara' }));
  assert.ok(taskchat.record(projectId, num, { kind: 'kept-dropped', who: 'mara' }));
  assert.ok(taskchat.record(projectId, num, { kind: 'closed' }));
  /* A task with nothing in its conversation: stored on its project, with no events file (as a task from before
     the conversation was recorded). */
  /* mara on the board as a real card, so the words name her as the page does (her card's name), not by her session. */
  board = fleet.install([fleet.agent('mara', { state: 'idle', ours: 'claim', displayName: 'Mara Lane' })]);
  quiet = projects.create({ name: 'Quiet' }).id;
  projects.mutate(quiet, (p) => ({ ...p, tasks: [{ number: 4, sentence: 'An old task', state: 'open' }] }));
  quietNum = 4;
});
test.after(() => {
  try { board.restore(); } catch { /* not installed */ }
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const WORDS = (out) => out.split('\n').filter((l) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}  /.test(l)).map((l) => l.slice(18));
const WANT = ['Created and given to Mara Lane', 'Mara Lane: on it, starting now', 'kept-sent', 'kept-dropped', 'Marked done'];

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

test('#5874 Windows: task activity prints the conversation oldest first, one line each, kept events included', async () => {
  const r = await win(['task', 'activity', projectId, String(num)]);
  assert.equal(r.code, 0, r.err);
  const created = taskchat.read(projectId, num)[0];
  assert.equal(created.kind, 'created', 'CONTROL: tasks.create recorded the created event first');
  assert.deepEqual(WORDS(r.out), WANT, r.out);
  assert.equal(r.out.split('\n').length, WANT.length, 'an event printed on more than one line: ' + r.out);
  const none = await win(['task', 'activity', quiet, String(quietNum)]);
  assert.equal(none.code, 0, none.err);
  assert.equal(none.out, 'Nothing recorded on task ' + quietNum + ' yet.');
  const bad = await win(['task', 'activity', projectId, 'one']);
  assert.equal(bad.code, 2);
  const missing = await win(['task', 'activity', projectId]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /Usage: kosmos task activity <project-id> <task-number>/);
  const nosuch = await win(['task', 'activity', 'no-such-project', '1']);
  assert.equal(nosuch.code, 1);
  assert.equal(nosuch.err, 'Kosmos refused that: there is no project by that name.');
  const notask = await win(['task', 'activity', projectId, '99']);
  assert.equal(notask.code, 1);
  assert.equal(notask.err, 'Kosmos refused that: there is no task 99 on that project.');
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
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

test('#5874 Mac: task activity prints the same lines as Windows', async () => {
  const r = await mac(['task', 'activity', projectId, String(num)]);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(WORDS(r.out), WANT, r.out);
  const w = await win(['task', 'activity', projectId, String(num)]);
  assert.equal(r.out.trim(), w.out.trim(), 'the two commands printed different lines');
  const none = await mac(['task', 'activity', quiet, String(quietNum)]);
  assert.equal(none.code, 0, none.out);
  assert.equal(none.out.trim(), 'Nothing recorded on task ' + quietNum + ' yet.');
  const nosuch = await mac(['task', 'activity', 'no-such-project', '1']);
  assert.equal(nosuch.code, 1);
  assert.match(nosuch.out, /Kosmos refused that: there is no project by that name\./);
  const notask = await mac(['task', 'activity', projectId, '99']);
  assert.equal(notask.code, 1);
  assert.match(notask.out, /Kosmos refused that: there is no task 99 on that project\./);
  const bad = await mac(['task', 'activity', projectId, 'one']);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /The task number must be a number/);
  const missing = await mac(['task', 'activity', projectId]);
  assert.equal(missing.code, 2);
  assert.match(missing.out, /Usage: kosmos task activity <project-id> <task-number>/);
  const help = await mac(['task']);
  assert.match(help.out, /kosmos task activity <project-id> <task-number>/, 'the help does not name the new command');
});
