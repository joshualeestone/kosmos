'use strict';

/**
 * The connect driver on the Windows sign-in host (engine/win32signin.js), and the
 * honest Windows dead end while that host is switched off.
 *
 *   node --test engine/connect.win32signin.test.js
 *
 * 🔑 THE REAL DRIVER, A FAKE PROGRAM. `connect.start()` runs unchanged: phases,
 * classifyPane, the #1922 capture-failure rescue, the #1937 login-evidence rules. Only
 * the spawn is faked (an EventEmitter with PassThrough pipes), and the host is forced
 * on through `setWindowsSigninHostForTests`, which is refused outside `node --test`.
 * Every arm pins the platform to win32, so this runs the same on a Mac.
 *
 * ⚠️ NOTHING REAL IS ASKED ANYTHING: `subscription.setRunner` answers the live check,
 * `connect.setRunner` answers the version probe and records every command, and
 * `win32signin.setSpawn` hands out the fake program.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

/* Sandbox BEFORE requiring, the same roots connect.test.js sandboxes. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'connect-win32signin-test-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = nodePath.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const connect = require('./connect');
const subscription = require('./subscription');
const win32signin = require('./win32signin');

connect.setSigninPlatformForTests('win32');

/* ── fixtures ────────────────────────────────────────────────────────────────
   ⚠️ SYNTHESISED FROM claude.exe 2.1.270 BINARY STRINGS; RE-CAPTURE IN SLICE 3.
   `auth login` writes "Opening browser to sign in…", then "Paste code here if
   prompted > "; its readline splits a pasted line on `#` and writes "Invalid code…" to
   stderr when either half is missing; success prints "Login successful." and exits 0;
   failure writes "Login failed: …" to stderr and exits 1. The text after "Invalid
   code" and "Login failed: " is invented. */
const OUT_BROWSER = 'Opening browser to sign in…\n';
const OUT_PROMPT = 'Paste code here if prompted > ';
const OUT_SUCCESS = 'Login successful.\n';
const ERR_INVALID = 'Invalid code\n';
const ERR_FAILED = 'Login failed: Request failed with status code 400\n';

const CODE = 'abCD1234#efGH5678';

const CONNECTED_CONFIG = {
  hasAvailableSubscription: false,
  oauthAccount: {
    organizationType: 'claude_max',
    billingType: 'stripe_subscription',
    organizationRateLimitTier: 'default_claude_max_20x',
  },
};
const writeClaudeConfig = (obj) => fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(obj));
const clearClaudeConfig = () => { try { fs.rmSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, { force: true }); } catch { /* fine */ } };

function until(fn, ms) {
  const deadline = Date.now() + (ms || 3000);
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      let v;
      try { v = fn(); } catch (e) { clearInterval(t); reject(e); return; }
      if (v) { clearInterval(t); resolve(v); return; }
      if (Date.now() > deadline) {
        clearInterval(t);
        reject(new Error('condition never became true; state: ' + JSON.stringify(connect.state())));
      }
    }, 10);
  });
}
const phase = () => connect.state().phase;

/* A fake `claude auth login`: say() and complain() write stdout and stderr, exit()
   ends it, and each line on stdin goes to `behaviour.onLine`. */
function fakeClaude(behaviour) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4343;
  child.killCalls = 0;
  child.stdinLines = [];
  let ended = false;
  child.say = (text) => { if (!ended) child.stdout.write(text); };
  child.complain = (text) => { if (!ended) child.stderr.write(text); };
  child.exit = (code, signal) => {
    if (ended) return;
    ended = true;
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => { child.emit('exit', code, signal || null); child.emit('close', code, signal || null); });
  };
  child.kill = () => { child.killCalls += 1; child.exit(null, 'SIGTERM'); return true; };
  let pending = '';
  child.stdin.setEncoding('utf8');
  child.stdin.on('data', (d) => {
    pending += d;
    let i;
    while ((i = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, i);
      pending = pending.slice(i + 1);
      child.stdinLines.push(line);
      if (behaviour.onLine) behaviour.onLine(child, line);
    }
  });
  process.nextTick(() => {
    if (behaviour.error) { child.emit('error', behaviour.error); return; }
    child.emit('spawn');
    if (behaviour.onSpawn) behaviour.onSpawn(child);
  });
  return child;
}

/* What auth login does with a pasted line, as read from the binary. */
function signsInOnAWholeCode(ctx) {
  return (child, line) => {
    const [first, second] = line.trim().split('#');
    if (!first || !second) { child.complain(ERR_INVALID); return; }
    writeClaudeConfig(CONNECTED_CONFIG);
    ctx.live.loggedIn = true;
    child.say(OUT_SUCCESS);
    child.exit(0);
  };
}

const TMUX_VERBS = ['new-session', 'capture-pane', 'send-keys', 'kill-session'];
const tmuxCommands = (calls) => calls.filter((c) => /tmux/i.test(String(c.file)) || TMUX_VERBS.includes(c.args[0]));

function winTest(name, fn) {
  test(name, async (t) => {
    connect.resetForTests();
    clearClaudeConfig();
    subscription.resetCache();
    connect.setTickInterval(15);
    connect.setUnknownGrace(300);
    connect.setAbandonedSigninMs(15 * 60 * 1000);
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = process.execPath;
    const ctx = { calls: [], spawns: [], live: { loggedIn: false }, behaviour: {} };
    connect.setRunner((file, args) => {
      ctx.calls.push({ file, args: args.slice() });
      return { ok: true, stdout: '' };
    });
    connect.setDryRun(false);
    subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: ctx.live.loggedIn }), err: null }));
    win32signin.setSpawn((file, args, opts) => {
      const child = fakeClaude(ctx.behaviour);
      ctx.spawns.push({ file, args: args.slice(), opts, child });
      return child;
    });
    connect.setWindowsSigninHostForTests(true);
    t.after(async () => {
      await connect.cancel().catch(() => {});
      connect.resetForTests();
      connect.setWindowsSigninHostForTests(false);
      connect.setSigninPlatformForTests('win32');
      connect.setRunner(null);
      win32signin.setSpawn(null);
      subscription.setRunner(null);
      connect.setTickInterval(700);
      connect.setUnknownGrace(10000);
      connect.setAbandonedSigninMs(15 * 60 * 1000);
      delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
      clearClaudeConfig();
      subscription.resetCache();
    });
    await fn(ctx, t);
  });
}

/* ── slice 1: the Windows host switched off ─────────────────────────────────── */

winTest('slice 1: with the Windows host off, a sign-in goes stuck with the true reason and issues no tmux command', async (ctx) => {
  connect.setWindowsSigninHostForTests(false);
  assert.equal(connect.WINDOWS_SIGNIN_HOST_ENABLED, false,
    'the Windows sign-in host ships switched ON, before the L-1 live check and Josh\'s go');
  await connect.start();
  await until(() => phase() === connect.PHASE.STUCK, 5000);
  const st = connect.state();
  assert.equal(st.because, 'Kosmos cannot run the Claude sign-in on Windows yet');
  assert.equal(st.because, connect.WINDOWS_SIGNIN_UNAVAILABLE_BECAUSE);
  assert.equal(st.canRunClaude, connect.claudeHatchAvailable(), 'the stuck record lost the hatch fact');
  assert.equal(st.canRunClaude, true, 'CONTROL: the binary here is present, so the hatch must be offered');
  assert.ok(!/['\u2018\u2019\u201A\u201B\r\n]/.test(process.execPath), 'this arm assumes a node path with no quote in it');
  assert.ok(!/[[\]`]/.test(process.execPath), 'this arm assumes a node path with no bracket or backtick in it');
  assert.equal(st.claudeSigninCommand, "& '" + process.execPath + "' auth login --claudeai",
    'the stuck record does not carry the sign-in line for the file this PC would run');
  await connect.cancel();
  assert.deepEqual(tmuxCommands(ctx.calls), [], 'a tmux command went out on Windows, where there is no tmux');
  assert.equal(ctx.spawns.length, 0, 'the switched-off Windows host started a program');
  /* CONTROL: the version probe went through the same recording runner, so an empty
     tmux list is not a runner that heard nothing. */
  assert.ok(ctx.calls.some((c) => c.args[0] === '--version'), 'the recording runner heard nothing at all');
});

winTest('slice 1 CONTROL: the same start on a Mac does launch through tmux', async (ctx) => {
  connect.setWindowsSigninHostForTests(false);
  connect.setSigninPlatformForTests('darwin');
  try {
    await connect.start();
    await until(() => tmuxCommands(ctx.calls).some((c) => c.args[0] === 'new-session'), 5000);
    assert.equal(ctx.spawns.length, 0, 'the Mac used the Windows host');
  } finally {
    await connect.cancel();
    connect.setSigninPlatformForTests('win32');
  }
});

winTest('win32-signin-web-copy #2645: an EXPIRED sign-in with the host off goes stuck recording the auth login line for the file this PC would run', async (ctx) => {
  connect.setWindowsSigninHostForTests(false);
  /* Claude Code under a user name with a space and an apostrophe. */
  const dir = nodePath.join(SANDBOX, "Mary O'Brien", '.local', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, 'claude.exe');
  fs.writeFileSync(file, '');
  fs.chmodSync(file, 0o755);
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = file;
  writeClaudeConfig(CONNECTED_CONFIG);   // the file says connected...
  ctx.live.loggedIn = false;             // ...and the live check says the credential is dead
  await connect.start();
  await until(() => phase() === connect.PHASE.STUCK, 5000);
  const st = connect.state();
  assert.equal(st.because, connect.WINDOWS_SIGNIN_UNAVAILABLE_BECAUSE, 'the expired sign-in did not reach the host-off stop');
  assert.equal(st.canRunClaude, true);
  assert.ok(!/'/.test(SANDBOX), 'this arm assumes a sandbox path with no quote of its own');
  assert.equal(st.claudeSigninCommand, "& '" + nodePath.join(SANDBOX, "Mary O''Brien", '.local', 'bin', 'claude.exe') + "' auth login --claudeai",
    'the record does not carry the auth login line, quoted, for the file this PC would run');
  assert.equal(ctx.spawns.length, 0, 'the switched-off Windows host started a program');
});

winTest('win32-signin-web-copy: a script-only Claude Code install goes stuck with canRunClaude but no line, so the card shows the install steps', async () => {
  connect.setWindowsSigninHostForTests(false);
  const dir = nodePath.join(SANDBOX, 'script-only', '.local', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, 'claude.cmd');
  fs.writeFileSync(file, '@echo off\n');
  fs.chmodSync(file, 0o755);
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = file;
  await connect.start();
  await until(() => phase() === connect.PHASE.STUCK, 5000);
  const st = connect.state();
  assert.equal(st.because, connect.WINDOWS_SIGNIN_UNAVAILABLE_BECAUSE);
  assert.equal(st.canRunClaude, true, 'CONTROL: the script is runnable, so a missing line is the script rule, not the file');
  assert.equal(st.claudeSigninCommand, null, 'a script-only install was given a PowerShell line, which cmd.exe would run with %VAR% expanded');
});

winTest('win32-signin-web-copy CONTROL: a Mac flow that goes stuck records no Windows sign-in line', async (ctx) => {
  connect.setWindowsSigninHostForTests(false);
  connect.setSigninPlatformForTests('darwin');
  connect.setRunner((file, args) => {
    ctx.calls.push({ file, args: args.slice() });
    return args[0] === 'new-session' ? { ok: false, stdout: '', stderr: 'no tmux here' } : { ok: true, stdout: '' };
  });
  try {
    await connect.start();
    await until(() => phase() === connect.PHASE.STUCK, 5000);
    const st = connect.state();
    assert.equal(st.canRunClaude, true, 'CONTROL: Claude Code is present, so a missing line is the platform, not the file');
    assert.equal(st.claudeSigninCommand, null, 'a Mac stuck record carries a PowerShell line');
  } finally {
    await connect.cancel();
    connect.setSigninPlatformForTests('win32');
  }
});

test('the Windows host cannot be forced on outside a node --test process', () => {
  const { execFileSync } = require('node:child_process');
  const script = [
    "const connect = require(" + JSON.stringify(nodePath.join(__dirname, 'connect.js')) + ");",
    "try { connect.setWindowsSigninHostForTests(true); console.log('ALLOWED'); }",
    "catch (e) { console.log('REFUSED ' + e.message); }",
  ].join('\n');
  const env = { ...process.env, AGENT_WORKFORCE_DATA: nodePath.join(SANDBOX, 'child-data') };
  const out = execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.match(out, /^REFUSED .*WINDOWS_SIGNIN_HOST_ENABLED/m, 'a plain process switched the Windows host on: ' + out);
});

winTest('slice 1: start() on an already-connected machine kills no tmux session on Windows', async (ctx) => {
  connect.setWindowsSigninHostForTests(false);
  writeClaudeConfig(CONNECTED_CONFIG);
  ctx.live.loggedIn = true;
  let liveChecks = 0;
  subscription.setRunner(async () => { liveChecks += 1; return { stdout: JSON.stringify({ loggedIn: true }), err: null }; });
  const view = await connect.start();
  assert.equal(view.phase, connect.PHASE.CONNECTED);
  assert.ok(liveChecks >= 1, 'CONTROL: the live check never ran, so this did not reach the #1560 leftover-session kill');
  assert.deepEqual(tmuxCommands(ctx.calls), [], 'the #1560 leftover-session kill sent a tmux command on Windows');
  assert.equal(ctx.spawns.length, 0);
});

/* ── slice 2: the driver on the Windows host ───────────────────────────────── */

winTest('Windows host: browser, the code prompt, the code on stdin, then Login successful and exit 0 is CONNECTED', async (ctx) => {
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER), onLine: signsInOnAWholeCode(ctx) };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_BROWSER_OPEN, 5000);
  const { child } = ctx.spawns[0];
  child.say(OUT_PROMPT);
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE, 5000);
  assert.equal(connect.submitCode(CODE).ok, true);
  await until(() => phase() === connect.PHASE.CONNECTED, 15000);

  assert.deepEqual(child.stdinLines, [CODE], 'the code did not reach the program on stdin, once');
  assert.deepEqual(ctx.spawns[0].args, ['auth', 'login', '--claudeai'],
    'on Windows the program is auth login even on a fresh machine');
  assert.ok(!JSON.stringify(ctx.spawns.map((s) => [s.file, s.args])).includes(CODE), 'the code is on a command line');
  assert.ok(!fs.readFileSync(connect.STATE_FILE(), 'utf8').includes(CODE), 'the code reached the state file');
  assert.deepEqual(tmuxCommands(ctx.calls), [], 'a tmux command went out on Windows');
});

winTest('#1937 on Windows: a reauth of a LIVE credential finishes once Claude says Login successful and exits 0', async (ctx) => {
  writeClaudeConfig(CONNECTED_CONFIG);
  ctx.live.loggedIn = true;
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER) };
  await connect.start({ reauth: true });
  await until(() => phase() === connect.PHASE.SIGNIN_BROWSER_OPEN, 5000);
  /* The file and the live check both say connected from the first tick, off the OLD
     credential; the flow must still wait for the login. */
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(phase(), connect.PHASE.SIGNIN_BROWSER_OPEN, 'a reauth finished before any login evidence');
  const { child } = ctx.spawns[0];
  child.say(OUT_SUCCESS);
  child.exit(0);
  await until(() => phase() === connect.PHASE.CONNECTED, 15000);
});

winTest('#1937 on Windows: the same reauth exiting 0 WITHOUT Login successful goes stuck, never connected off the old credential', async (ctx) => {
  writeClaudeConfig(CONNECTED_CONFIG);
  ctx.live.loggedIn = true;
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER) };
  await connect.start({ reauth: true });
  await until(() => phase() === connect.PHASE.SIGNIN_BROWSER_OPEN, 5000);
  ctx.spawns[0].child.exit(0);
  await until(() => phase() === connect.PHASE.STUCK || phase() === connect.PHASE.CONNECTED, 15000);
  const st = connect.state();
  assert.equal(st.phase, connect.PHASE.STUCK,
    '#1937: a reauth whose program ended with no login evidence was reported connected off the old credential');
  assert.match(st.because, /closed before Claude finished/);
  assert.match(st.tail, /exited with code 0/);
});

winTest('#2645/#1922 on Windows: a DEAD credential whose program exits 0 without the success text finishes once the live check says connected', async (ctx) => {
  writeClaudeConfig(CONNECTED_CONFIG);   // the file says connected...
  ctx.live.loggedIn = false;             // ...and the live check says the credential is dead
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER) };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_BROWSER_OPEN, 5000);
  /* The login lands (dead -> live) and the program exits before any "Login successful." is read. */
  ctx.live.loggedIn = true;
  ctx.spawns[0].child.exit(0);
  await until(() => phase() === connect.PHASE.CONNECTED || phase() === connect.PHASE.STUCK, 15000);
  assert.equal(phase(), connect.PHASE.CONNECTED,
    'a dead credential repaired by a login whose success text was missed was not finished through deadCredential: '
    + connect.state().because);
});

winTest('Windows host: a VALID code whose exchange takes 9 s is never told it did not work', async (ctx, t) => {
  /* The blank grace is 4.5x the unknown grace: 45 s in production. This suite's 300 ms
     would make it 1.35 s, shorter than the exchange, so the arm uses 3 s (13.5 s). */
  connect.setUnknownGrace(3000);
  let exchange = null;
  t.after(() => clearTimeout(exchange));   // never let a late sign-in land in the next arm
  ctx.behaviour = {
    onSpawn: (c) => c.say(OUT_BROWSER + OUT_PROMPT),
    onLine: (child, line) => {
      if (child.stdinLines.length !== 1) return;
      exchange = setTimeout(() => { if (child.killCalls === 0) signsInOnAWholeCode(ctx)(child, line); }, 9000);
    },
  };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE, 5000);
  assert.equal(connect.submitCode(CODE).ok, true);
  const seen = [];
  const watch = setInterval(() => {
    const s = connect.state();
    const k = s.phase + ' | ' + (s.because || '');
    if (seen[seen.length - 1] !== k) seen.push(k);
  }, 20);
  try {
    await until(() => phase() === connect.PHASE.CONNECTED || phase() === connect.PHASE.STUCK, 25000);
  } finally { clearInterval(watch); }
  assert.ok(!seen.some((k) => /did not work/.test(k)),
    'a valid code still being exchanged was reported as not working:\n' + seen.join('\n'));
  assert.equal(phase(), connect.PHASE.CONNECTED, seen.join('\n'));
  assert.deepEqual(ctx.spawns[0].child.stdinLines, [CODE], 'a second code reached a program still handling the first');
});

winTest('Windows host: exit 1 with Login failed goes stuck, and the tail shows what Claude said', async (ctx) => {
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER + OUT_PROMPT) };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE, 5000);
  const { child } = ctx.spawns[0];
  child.complain(ERR_FAILED);
  child.exit(1);
  await until(() => phase() === connect.PHASE.STUCK, 15000);
  const st = connect.state();
  assert.match(st.tail, /Login failed: Request failed with status code 400/);
  assert.match(st.tail, /exited with code 1/);
});

winTest('Windows host: an Invalid code takes the rejection arm, and a second code is then accepted', async (ctx) => {
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER + OUT_PROMPT), onLine: signsInOnAWholeCode(ctx) };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE, 5000);
  assert.equal(connect.submitCode('abcdefgh').ok, true, 'CONTROL: the first code passes validCode, so auth login is what rejects it');
  await until(() => phase() === connect.PHASE.SIGNIN_COMPLETING, 5000);
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE && /did not work/.test(connect.state().because || ''), 15000);
  assert.equal(connect.submitCode(CODE).ok, true, 'the second code was refused');
  await until(() => phase() === connect.PHASE.CONNECTED, 15000);
  assert.deepEqual(ctx.spawns[0].child.stdinLines, ['abcdefgh', CODE]);
  assert.equal(ctx.spawns.length, 1, 'a retry started a second program');
});

winTest('R4: a wrong paste that equals the URL state is refused, and the stored sign-in link is not replaced by a redacted one', async (ctx) => {
  const STATE = 'STATEhalfu2Wq8Er4Ty6Ui0Op1As3Df5Gh7';
  /* Synthesised: whether auth login prints its URL at all is an L-1 measurement. */
  const URL = 'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=' + STATE;
  ctx.behaviour = {
    onSpawn: (c) => c.say(OUT_BROWSER + 'If the browser did not open, visit: ' + URL + '\n' + OUT_PROMPT),
    onLine: signsInOnAWholeCode(ctx),
  };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE && connect.state().url, 5000);
  assert.equal(connect.state().url, URL, 'CONTROL: the link was stored before the paste');
  assert.equal(connect.submitCode(STATE).ok, true);
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE && /did not work/.test(connect.state().because || ''), 15000);
  assert.equal(connect.state().url, URL, 'the rejection arm replaced the sign-in link with a redacted, broken one');
});

winTest('Windows host: cancel kills the program', async (ctx) => {
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER + OUT_PROMPT) };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE, 5000);
  const { child } = ctx.spawns[0];
  const after = await connect.cancel();
  assert.equal(after.phase, connect.PHASE.IDLE);
  assert.equal(child.killCalls, 1, 'cancel left the sign-in program running');
  assert.equal(child.stdin.writableEnded, true, 'cancel did not end the program\'s input');
});

winTest('Windows host: the abandoned sign-in limit expires the flow and kills the program', async (ctx) => {
  connect.setAbandonedSigninMs(200);
  ctx.behaviour = { onSpawn: (c) => c.say(OUT_BROWSER + OUT_PROMPT) };
  await connect.start();
  await until(() => phase() === connect.PHASE.SIGNIN_AWAITING_CODE, 5000);
  await until(() => phase() === connect.PHASE.STUCK, 5000);
  assert.match(connect.state().because, /expired/);
  await until(() => ctx.spawns[0].child.killCalls >= 1, 2000);
});

winTest('Windows host: a Claude Code that is not there is stuck with an honest sentence', async (ctx) => {
  ctx.behaviour = { error: Object.assign(new Error('spawn C:\\nowhere\\claude.exe ENOENT'), { code: 'ENOENT' }) };
  await connect.start();
  await until(() => phase() === connect.PHASE.STUCK, 5000);
  const st = connect.state();
  assert.equal(st.because, 'Kosmos could not find Claude Code to run its sign-in');
  assert.match(st.tail, /ENOENT/);
  assert.deepEqual(tmuxCommands(ctx.calls), [], 'a tmux command went out on Windows');
});
