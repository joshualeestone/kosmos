'use strict';
/**
 * #570: the win32 launch substrate -- the piece the Mac gets from launchd.
 *
 * 🛑 EVERY ARM RUNS ON A MAC, because a behavioural arm for a win32 branch cannot
 * fail on a machine that never takes the branch. `launch` takes the platform it
 * is asked about and the spawn is behind a seam, so the whole thing is assertable
 * here -- the fix-shape docs/windows-source-coupling-1732.md prescribes.
 *
 * The rules being pinned were MEASURED on the real box (2026-09-07), and both of
 * the load-bearing ones are INVISIBLE failures, which is why they are pinned at
 * all rather than left to review:
 *   - a spawn into an untrusted folder runs, stays alive, and sits forever on the
 *     trust dialog with `No, exit` preselected. It never registers, so the
 *     fail-closed roster shows nothing -- and the console is hidden, so the dialog
 *     is on no screen. Trust therefore GATES the launch.
 *   - `CLAUDE_CODE_CHILD_SESSION` (set inside an agent session) suppresses
 *     registration entirely. An inherited marker means an agent that runs
 *     perfectly and is simply invisible to the board.
 *
 *   node --test engine/win32launch.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'win32launch-570-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));

const launcher = require('./win32launch');
const win32sessions = require('./win32sessions');
const sendertoken = require('./sendertoken');

test.after(() => {
  launcher.setSpawn(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function workdir(name) {
  const d = path.join(SANDBOX, 'work', name);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}

/** Record what the spawn was asked to do, and never actually spawn. */
function recordingSpawn() {
  const calls = [];
  launcher.setSpawn((cmd, argv, opts) => {
    calls.push({ cmd, argv, opts });
    return { pid: 4242, unref() {} };
  });
  return calls;
}

// --- the environment: the invisible-failure rule --------------------------------

test('#570 every child-session marker is STRIPPED, or the agent runs and never appears', () => {
  const dirty = { PATH: '/usr/bin', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDECODE: '1',
    CLAUDE_CODE_SESSION_ID: 'abc', CLAUDE_CODE_MESSAGING_SOCKET: 'pipe',
    CLAUDE_CODE_MESSAGING_TOKEN: 'x', CLAUDE_CODE_BRIDGE_SESSION_ID: 'b',
    CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PID: '9', KEEP_ME: 'yes' };
  const env = launcher.childEnv(dirty, 'deadbeef');
  for (const k of launcher.INHERITED_MARKERS) {
    assert.ok(!(k in env), k + ' must be ABSENT, not empty -- Claude Code reads presence');
  }
  assert.equal(env.KEEP_ME, 'yes', 'everything else is inherited untouched');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.KOSMOS_AGENT_TOKEN, 'deadbeef', 'and the agent gets its own credential');
});

test('#570 with no token of its own, an agent does NOT inherit somebody elses', () => {
  const env = launcher.childEnv({ KOSMOS_AGENT_TOKEN: 'someone-elses' }, null);
  assert.ok(!('KOSMOS_AGENT_TOKEN' in env),
    'a tokenless agent must be tokenless, not speaking as whoever spawned it');
});

// --- the argv: one mint point ---------------------------------------------------

test('#570 launchArgs are spliced VERBATIM, so the recorded id is the running id', () => {
  const prepared = { launchArgs: ['--session-id', 'pinned-uuid'] };
  assert.deepEqual(launcher.argvFor(prepared, {}), ['--session-id', 'pinned-uuid']);
  assert.deepEqual(launcher.argvFor(prepared, { model: 'haiku' }),
    ['--model', 'haiku', '--session-id', 'pinned-uuid'],
    'a model goes BEFORE the pinned args and never rewrites them');
});

// --- the refusals ---------------------------------------------------------------

test('#570 it refuses off-win32, rather than pretending to be the Mac path', () => {
  const r = launcher.launch({ name: 'x', cwd: SANDBOX, platform: 'darwin' });
  assert.equal(r.ok, false);
  assert.match(r.because, /launchd/);
});

test('#570 it refuses a relative folder', () => {
  const r = launcher.launch({ name: 'x', cwd: 'work/here', platform: 'win32' });
  assert.equal(r.ok, false);
  assert.match(r.because, /absolute/);
});

test('#570 A TRUST FAILURE REFUSES THE LAUNCH, and nothing is spawned', () => {
  /* 🛑 THE ARM THAT MATTERS MOST. Measured on Windows: an untrusted spawn runs,
     never registers, and waits on a dialog inside a hidden console -- invisible on
     both the board and the desktop. Refusing is the kinder failure, so trust is a
     GATE and not a best-effort. Trust is made to fail by pointing the config at a
     path that cannot be read as a config. */
  const calls = recordingSpawn();
  const saved = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  const blocked = path.join(SANDBOX, 'not-a-config');
  fs.mkdirSync(blocked, { recursive: true });          // a DIRECTORY where a file belongs
  process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = blocked;
  try {
    const r = launcher.launch({ name: 'untrusted', cwd: workdir('untrusted'), platform: 'win32' });
    assert.equal(r.ok, false, 'a launch we cannot vouch for must not happen');
    assert.match(r.because, /vouch for its folder/);
    assert.equal(calls.length, 0, 'and NOTHING was spawned');
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = saved; }
});

// --- the spawn shape ------------------------------------------------------------

test('#570 a good launch spawns hidden, detached, with the pinned id and a clean env', () => {
  const calls = recordingSpawn();
  const cwd = workdir('good');
  const r = launcher.launch({ name: 'winagent-1', runner: 'claude', cwd, model: 'haiku', platform: 'win32' });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(calls.length, 1, 'exactly one spawn');

  const { cmd, argv, opts } = calls[0];
  assert.equal(cmd, 'cmd.exe');
  /* `start` is what gives the agent its own console: Node has no
     CREATE_NEW_CONSOLE, and a detached child gets none, which an interactive TUI
     needs. The empty string is the WINDOW TITLE argument -- without it `start`
     treats a quoted program path as a title and launches nothing. */
  assert.deepEqual(argv.slice(0, 4), ['/c', 'start', '', '/min']);
  assert.ok(argv.includes('--session-id'), 'the id is pinned');
  assert.ok(argv.includes(r.sessionId), 'and it is the id that was RECORDED');
  assert.ok(!argv.includes('--bg'),
    '--bg prints "ignoring --session-id" and mints its own, so the record would never match');

  assert.equal(opts.cwd, cwd);
  assert.equal(opts.detached, true);
  assert.equal(opts.windowsHide, true, 'headless: the console exists but is off-screen');
  assert.ok(!('CLAUDE_CODE_CHILD_SESSION' in opts.env), 'the child-session marker is gone');
  assert.match(String(opts.env.KOSMOS_AGENT_TOKEN), /^[0-9a-f]+$/, 'and it carries its own token');
});

test('#570 the launch is RECORDED and CREDENTIALED, so the board can see and attribute it', () => {
  recordingSpawn();
  const r = launcher.launch({ name: 'winagent-2', runner: 'claude', cwd: workdir('recorded'), platform: 'win32' });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(win32sessions.isOurs(r.sessionId), true, 'the ownership record exists');
  assert.equal(sendertoken.live('winagent-2').length, 1, 'exactly one live credential for it');
});

test('#570 a spawn that THROWS undoes the record and the token, leaving nothing behind', () => {
  /* Otherwise a failed start leaves a row the roster will never match and a live
     credential for an agent that does not exist -- sendertoken.js:46 says whoever
     stops an agent must retire it, and a launch that never happened is that. */
  launcher.setSpawn(() => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; });
  const r = launcher.launch({ name: 'winagent-3', runner: 'claude', cwd: workdir('throws'), platform: 'win32' });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not start it/);
  assert.equal(sendertoken.live('winagent-3').length, 0, 'the token did not outlive the failed launch');
});
