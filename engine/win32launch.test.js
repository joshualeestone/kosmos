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
  /* ⚠️ THE EXPECTED VECTORS GREW AN AUTONOMY FLAG, and that is the fix rather
     than a concession. This arm's claim is that `launchArgs` are spliced VERBATIM
     and stay LAST -- not that nothing may precede them; the model case below
     always showed something could. The exact vectors it pinned happened to be the
     ones with no permission flag, which is precisely the defect: an unattended
     agent in a hidden console freezes on its first prompt. Kept as exact
     deepEquals so a future flag has to be looked at rather than waved through. */
  const prepared = { launchArgs: ['--session-id', 'pinned-uuid'] };
  assert.deepEqual(launcher.argvFor(prepared, {}),
    ['--dangerously-skip-permissions', '--session-id', 'pinned-uuid']);
  assert.deepEqual(launcher.argvFor(prepared, { model: 'haiku' }),
    ['--dangerously-skip-permissions', '--model', 'haiku', '--session-id', 'pinned-uuid'],
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

test('#570 an UNATTENDED agent is launched with autonomy, or it freezes where nobody can see it', () => {
  /* 🛑 THE DEFECT THIS PINS SHIPPED. `bin/agent-supervisor.sh` states the rule for
     the Mac in its own words -- "--dangerously-skip-permissions is not optional
     for an unattended agent. Without it the agent starts, looks healthy, and
     freezes forever on its first permission prompt with nobody there to answer
     it" -- and the win32 argv carried no permission flag at all.

     ⚠️ AND WINDOWS NEEDS IT MORE THAN THE MAC DOES. A Mac agent lives in a tmux
     pane a person can attach to and answer. This platform runs the agent in a
     console created HIDDEN, so the prompt is on no screen that exists, while
     `claude agents --json` keeps reporting `idle` and the board keeps drawing a
     healthy row. Same shape as the trust dialog this module's header describes,
     one prompt over.

     📌 It survived because nothing ever reached a prompt: with no delivery path
     (7c) a Windows agent had never been ASKED to do anything, so the rehearsal's
     agents sat idle and never needed an approval. */
  const argv = launcher.argvFor({ launchArgs: ['--session-id', 'abc'] }, { runner: 'claude' });
  assert.ok(argv.includes('--dangerously-skip-permissions'),
    'an agent nobody can answer for must not be able to ask: ' + argv.join(' '));
  assert.ok(argv.indexOf('--dangerously-skip-permissions') < argv.indexOf('--session-id'),
    'flags precede the spliced launchArgs, which stay verbatim and last');
});

test('#570 the autonomy flag is the RUNNER\'s spelling, and an unknown runner gets none', () => {
  /* codex spells it differently, and the Mac pairs them the same way. An unknown
     runner gets NO flag rather than a guessed one: a wrong flag is a refused
     launch, which is loud, and inventing autonomy for a runner we do not know is
     the one direction that must not be guessed. */
  const codex = launcher.argvFor({ launchArgs: [] }, { runner: 'codex' });
  assert.deepEqual(codex, ['--dangerously-bypass-approvals-and-sandbox']);

  const unknown = launcher.argvFor({ launchArgs: [] }, { runner: 'gemini' });
  assert.deepEqual(unknown, [], 'no flag invented for a runner we do not know');

  // Absent runner means claude, which is what every existing caller means.
  assert.deepEqual(launcher.argvFor({ launchArgs: [] }, {}), ['--dangerously-skip-permissions']);
});

test('#570 autonomy and model coexist, and launchArgs still come last', () => {
  const argv = launcher.argvFor({ launchArgs: ['--session-id', 'zz'] }, { runner: 'claude', model: 'haiku' });
  assert.deepEqual(argv, ['--dangerously-skip-permissions', '--model', 'haiku', '--session-id', 'zz']);
});

/* ── the streaming launch (7c) ────────────────────────────────────────────── */

test('#570 7c a streaming agent is asked for stream-json IN and OUT, and keeps its pipes', () => {
  /* The pipes ARE the feature: stdin is the delivery channel this platform has
     had no substitute for, and stdout is the event stream that replaces the Mac's
     pane scrape. `launch()` passes stdio:'ignore' deliberately; this must not. */
  const calls = [];
  launcher.setSpawn((cmd, argv, opts) => { calls.push({ cmd, argv, opts }); return { pid: 555, stdin: {}, unref() {} }; });
  const r = launcher.launchStreaming({ name: 'streamer-1', cwd: SANDBOX, claudeBin: process.execPath, platform: 'win32' });

  assert.equal(r.ok, true, r.because);
  assert.deepEqual(calls[0].opts.stdio, ['pipe', 'pipe', 'pipe'], 'nobody can type into a stdio:ignore agent');
  assert.equal(calls[0].opts.detached, undefined, 'a detached child with pipes is a child whose pipes nobody holds');
  const a = calls[0].argv;
  assert.ok(a.includes('-p') && a.includes('--input-format') && a.includes('--output-format'),
    'the streaming shape, measured to stay open across turns: ' + a.join(' '));
  assert.equal(a[a.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(a[a.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(a.includes('--dangerously-skip-permissions'), 'an unattended agent still gets autonomy');
});

test('#570 7c a FRESH agent pins the minted id; a RESUME names the id it already has', () => {
  /* 🔑 --session-id and --resume are mutually exclusive, and which one appears
     says whether this is a birth or a return. Measured: a resume answers with the
     SAME session id, which is what keeps the ownership record, the roster join
     and the stop path pointing at one agent rather than two. */
  const fresh = launcher.streamArgvFor({ launchArgs: ['--session-id', 'minted-1'] }, { runner: 'claude' });
  assert.ok(fresh.includes('--session-id'), 'a fresh agent pins what win32create minted');
  assert.ok(!fresh.includes('--resume'), 'and does not also ask to resume');

  const back = launcher.streamArgvFor({ launchArgs: ['--session-id', 'minted-1'] },
    { runner: 'claude', resumeSessionId: 'already-mine' });
  assert.ok(back.includes('--resume'), 'a returning agent names its id');
  assert.equal(back[back.indexOf('--resume') + 1], 'already-mine');
  assert.ok(!back.includes('--session-id'), 'never both -- they are mutually exclusive');
});

test('#570 7c a RESUME writes no record, so one agent never gets two ownership records', () => {
  /* ⚠️ prepareSession WRITES the record. Calling it on a resume would file a
     SECOND row for one agent -- exactly the duplicate-name hazard win32live
     documents, arriving through the restart path that is supposed to be routine. */
  const before = Object.keys(win32sessions.read()).length;
  launcher.setSpawn(() => ({ pid: 556, stdin: {}, unref() {} }));

  const r = launcher.launchStreaming({
    name: 'streamer-2', cwd: SANDBOX, claudeBin: process.execPath, platform: 'win32',
    resumeSessionId: 'a-session-we-already-own',
  });

  assert.equal(r.ok, true, r.because);
  assert.equal(r.resumed, true);
  assert.equal(r.sessionId, 'a-session-we-already-own', 'it returns to the id it was given');
  assert.equal(Object.keys(win32sessions.read()).length, before, 'a resume records nothing new');
});

test('#570 a RESUME carries its OWN credential, or every self-report it sends is refused', () => {
  /* 🛑 THE DEFECT THIS PINS. A crash-restarted agent was resumed with no token:
     the resume branch passed `s.token || ''`, nobody ever set `token`, and
     childEnv DELETES the variable on an empty value. A Windows agent has no pane
     to fall back on, so the board refused every report it sent. The Mac mints a
     fresh token on every launch; so does this. */
  const calls = [];
  launcher.setSpawn((cmd, argv, opts) => { calls.push({ opts }); return { pid: 557, stdin: {}, unref() {} }; });
  const rowsBefore = Object.keys(win32sessions.read()).length;
  const liveBefore = sendertoken.live('streamer-3').length;

  const r = launcher.launchStreaming({
    name: 'streamer-3', cwd: SANDBOX, claudeBin: process.execPath, platform: 'win32',
    resumeSessionId: 'a-session-we-already-own-3',
  });

  assert.equal(r.ok, true, r.because);
  assert.match(String(calls[0].opts.env.KOSMOS_AGENT_TOKEN), /^[0-9a-f]+$/, 'the resumed agent carries a token');
  assert.equal(sendertoken.live('streamer-3').length, liveBefore + 1, 'exactly one new live credential');
  assert.ok(r.instance && sendertoken.live('streamer-3').includes(r.instance), 'and it is the run it returns');
  assert.equal(Object.keys(win32sessions.read()).length, rowsBefore, 'but still no second ownership record');
});

test('#570 a RESUME whose spawn throws retires the token it minted, and keeps the record', () => {
  /* The row must EXIST first, or a resume that wrongly forgot it would forget
     nothing and this test could not tell. */
  const owned = win32sessions.record('a-session-we-already-own-4', { name: 'streamer-4', runner: 'claude' });
  assert.equal(owned.ok, true, owned.because);
  launcher.setSpawn(() => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; });
  const rowsBefore = Object.keys(win32sessions.read()).length;
  const liveBefore = sendertoken.live('streamer-4').length;

  const r = launcher.launchStreaming({
    name: 'streamer-4', cwd: SANDBOX, claudeBin: process.execPath, platform: 'win32',
    resumeSessionId: 'a-session-we-already-own-4',
  });

  assert.equal(r.ok, false);
  assert.equal(sendertoken.live('streamer-4').length, liveBefore, 'no credential outlives a run that never started');
  assert.equal(Object.keys(win32sessions.read()).length, rowsBefore, 'and the record, which is the agent\'s, is untouched');
  assert.equal(win32sessions.read()['a-session-we-already-own-4'].name, 'streamer-4', 'the agent\'s own row survives a failed restart');
});

test('#570 7c a message is ONE json line, in the shape stream-json reads', () => {
  const line = launcher.messageLine('hello agent');
  assert.ok(line.endsWith('\n'), 'newline-delimited, or the reader never sees it');
  assert.equal(line.indexOf('\n'), line.length - 1, 'exactly one line -- a newline inside would split the message');
  const parsed = JSON.parse(line);
  assert.deepEqual(parsed, {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'hello agent' }] },
  });
});

test('#570 7c the streaming launch refuses the same things the detached one does', () => {
  launcher.setSpawn(() => ({ pid: 1, stdin: {}, unref() {} }));
  assert.match(launcher.launchStreaming({ name: 'x', cwd: SANDBOX, platform: 'darwin' }).because, /launchd/);
  assert.match(launcher.launchStreaming({ name: 'x', cwd: 'work/here', platform: 'win32' }).because, /absolute/);
});

test('#570 7c-2 the resolved runner path is a HINT, and a stale one falls back to PATH', () => {
  /* 🛑 WHY THIS EXISTS. Since 7c-2 the launcher is a Scheduled Task, and the task
     carries the path `create.js` resolved on the day the agent was made. That task
     is still firing months later -- across a Claude Code update, a reinstall, or
     somebody moving where they keep it. A stranded path spawns ENOENT forever, and
     the symptom is a supervisor throttle-looping into a task log nobody reads.
     Neither half is enough alone: the hint beats a logon PATH that does not carry
     %USERPROFILE%\.local\bin, and PATH beats a hint that has gone stale. */
  const spawns = [];
  launcher.setSpawn((bin, argv) => { spawns.push(bin); return { pid: 1, stdin: {}, unref() {} }; });

  const here = process.execPath;                       // exists on every box
  const gone = path.join(SANDBOX, 'no', 'such', 'claude.exe');

  launcher.launchStreaming({ name: 'hint-1', cwd: SANDBOX, claudeBin: here, platform: 'win32' });
  assert.equal(spawns[0], here, 'a path that is really there is the one we resolved -- use it');

  launcher.launchStreaming({ name: 'hint-2', cwd: SANDBOX, claudeBin: gone, platform: 'win32' });
  assert.equal(spawns[1], 'claude', 'a path that has gone must not strand the agent');

  /* 📌 AND THE FALLBACK SPELLING FOLLOWS THE RUNNER. `claudeBin` is the parameter's
     name for historical reasons; its VALUE is whichever runner this agent uses, so
     falling back to `claude` for a codex agent would spawn the wrong program on the
     one path where the hint is gone. */
  launcher.launchStreaming({ name: 'hint-3', cwd: SANDBOX, claudeBin: gone, runner: 'codex', platform: 'win32' });
  assert.equal(spawns[2], 'codex');
  launcher.setSpawn(null);
});
