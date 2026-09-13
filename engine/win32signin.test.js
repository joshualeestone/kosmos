'use strict';

/**
 * engine/win32signin.js: the Windows sign-in host, against a fake child.
 *
 *   node --test engine/win32signin.test.js
 *
 * ⚠️ NO REAL PROGRAM STARTS HERE. Every arm installs `setSpawn` with a fake child (an
 * EventEmitter with PassThrough pipes), so this runs the same on a Mac and on Windows,
 * and nothing can sign an account in or out.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

/* Sandbox BEFORE requiring: win32signin requires win32launch on open, and that pulls
   in modules that fix their data roots at require time. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'win32signin-test-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const win32signin = require('./win32signin');
const win32launch = require('./win32launch');
const liveExecution = require('./live-execution');

/* ── fixtures ────────────────────────────────────────────────────────────────
   ⚠️ SYNTHESISED FROM claude.exe 2.1.270 BINARY STRINGS; RE-CAPTURE IN SLICE 3.
   The design read these out of the binary (`process.stdout.write("Opening browser to
   sign in…")`, `"Paste code here if prompted > "`, `"Login successful.\n"`,
   `"Login failed: …"` on stderr). Nobody has watched a live run print them, and the
   text after "Login failed: " is invented. Slice 3's L-1 replaces them with captures. */
const OUT_BROWSER = 'Opening browser to sign in…\n';
const OUT_PROMPT = 'Paste code here if prompted > ';
const OUT_SUCCESS = 'Login successful.\n';
const ERR_FAILED = 'Login failed: Request failed with status code 400\n';

const CLAUDE_BIN = 'C:\\Users\\someone\\.local\\bin\\claude.exe';
const CODE = 'abCD1234#efGH5678';

function fakeChild(opts) {
  const o = opts || {};
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  child.killCalls = 0;
  child.stdinText = '';
  child.stdin.setEncoding('utf8');
  child.stdin.on('data', (d) => { child.stdinText += d; });
  let ended = false;
  child.exit = (code, signal) => {
    if (ended) return;
    ended = true;
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => {
      child.emit('exit', code, signal || null);
      child.emit('close', code, signal || null);
    });
  };
  child.kill = () => { child.killCalls += 1; child.exit(null, 'SIGTERM'); return true; };
  process.nextTick(() => { if (o.error) child.emit('error', o.error); else child.emit('spawn'); });
  return child;
}

function recordingSpawn(makeChild) {
  const calls = [];
  const fn = (file, args, opts) => {
    const child = (makeChild || fakeChild)();
    calls.push({ file, args, opts, child });
    return child;
  };
  return { calls, fn };
}

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

function withSpawn(t, makeChild) {
  const spawn = recordingSpawn(makeChild);
  win32signin.setSpawn(spawn.fn);
  t.after(() => win32signin.setSpawn(null));
  return spawn;
}

test('the environment carries no agent token and no child-session markers, and CLAUDE_CONFIG_DIR is set or deleted', async (t) => {
  const planted = {
    KOSMOS_AGENT_TOKEN: 'kat-somebody-elses-credential',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SESSION_ID: 'a-session',
    CLAUDECODE: '1',
    CLAUDE_CONFIG_DIR: 'C:\\leaked\\account',
  };
  const saved = {};
  for (const [k, v] of Object.entries(planted)) { saved[k] = process.env[k]; process.env[k] = v; }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();

  assert.equal((await host.open({ claudeBin: CLAUDE_BIN, launchDir: 'C:\\Kosmos\\accounts\\work' })).ok, true);
  const env = spawn.calls[0].opts.env;
  /* CONTROL: the parent really carries all of them, so the absences below are the host's doing. */
  for (const k of Object.keys(planted)) assert.ok(process.env[k], `the control lost ${k}`);
  assert.equal(env.KOSMOS_AGENT_TOKEN, undefined, 'the sign-in inherited an agent token');
  for (const marker of win32launch.INHERITED_MARKERS) {
    assert.equal(env[marker], undefined, `the sign-in inherited the child-session marker ${marker}`);
  }
  assert.equal(env.CLAUDE_CONFIG_DIR, 'C:\\Kosmos\\accounts\\work',
    'a named account lost its folder, so the login would land in whatever folder leaked in');

  assert.equal((await host.open({ claudeBin: CLAUDE_BIN, launchDir: null })).ok, true);
  assert.ok(!('CLAUDE_CONFIG_DIR' in spawn.calls[1].opts.env),
    '#1922: the default account must start with CLAUDE_CONFIG_DIR DELETED, not with the inherited value');
  assert.equal(spawn.calls[0].child.killCalls, 1, 'a second open left the first sign-in program running');
  await host.kill();
});

test('the program is started directly with auth login, and the code reaches stdin and nothing else', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  /* needsLogin false on purpose: on Windows the program is auth login regardless. */
  await host.open({ claudeBin: CLAUDE_BIN, launchDir: null, needsLogin: false });
  const call = spawn.calls[0];
  assert.equal(call.file, CLAUDE_BIN, 'something other than Claude Code was started');
  assert.deepEqual(call.args, ['auth', 'login', '--claudeai']);
  assert.ok(!call.opts.shell, 'the sign-in went through a shell');
  assert.doesNotMatch(call.file, /(^|[\\/])cmd(\.exe)?$/i, 'the sign-in went through cmd');
  assert.ok(!call.args.some((a) => /^\/c$/i.test(a)), 'the sign-in went through cmd /c');
  assert.equal(call.opts.windowsHide, true, 'a console window would flash on screen');
  assert.deepEqual(call.opts.stdio, ['pipe', 'pipe', 'pipe']);

  call.child.stdout.write(OUT_BROWSER + OUT_PROMPT);
  const sent = await host.sendCode(CODE);
  assert.equal(sent.ok, true);
  await settle();
  assert.equal(call.child.stdinText, CODE + '\n', 'the code did not arrive on stdin as one line');

  const before = call.child.stdinText;
  assert.equal((await host.sendEnter()).ok, true);
  await settle();
  assert.equal(call.child.stdinText, before, 'sendEnter wrote to stdin, which auth login would read as an empty code');

  const cap = await host.capture();
  for (const c of spawn.calls) {
    assert.ok(!JSON.stringify([c.file, c.args]).includes(CODE), 'the code is on a command line');
    assert.ok(!Object.values(c.opts.env).some((v) => String(v).includes(CODE)), 'the code is in the environment');
  }
  assert.ok(!JSON.stringify(sent).includes(CODE), 'sendCode handed the code back');
  assert.ok(!JSON.stringify(cap).includes(CODE), 'the capture carries the code');
  await host.kill();
  const late = await host.sendCode(CODE);
  assert.equal(late.ok, false);
  assert.ok(!JSON.stringify(late).includes(CODE), 'a refused code was echoed back');
});

test('escape codes are stripped and CRLF becomes LF, even across chunk boundaries', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const out = spawn.calls[0].child.stdout;
  out.write('\x1b[1mOpening browser\x1b[0m to sign in…\r\n');
  out.write('\x1b]8;;https://example.invalid/x\x07link\x1b]8;;\x07 text\r\n');
  out.write('split \x1b[3');
  await settle();
  const mid = await host.capture();
  assert.equal(mid.stdout, 'Opening browser to sign in…\nlink text\nsplit ',
    'an escape sequence cut by a chunk boundary showed through');
  out.write('2mred\x1b[0m done\r');
  out.write('\n' + OUT_PROMPT);
  await settle();
  const cap = await host.capture();
  assert.equal(cap.ok, true);
  assert.equal(cap.stdout, 'Opening browser to sign in…\nlink text\nsplit red done\n' + OUT_PROMPT);
  assert.doesNotMatch(cap.stdout, /[\x1b\r]/);
  await host.kill();
});

test('the kept text is capped at 64 KB, dropping the oldest', async (t) => {
  assert.equal(win32signin.SIGNIN_OUTPUT_LIMIT_CHARS, 64 * 1024);
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const out = spawn.calls[0].child.stdout;
  const line = (i) => `line ${String(i).padStart(6, '0')} ${'x'.repeat(90)}\n`;
  /* CONTROL: under the limit, everything is kept. */
  out.write(line(0));
  await settle();
  assert.match((await host.capture()).stdout, /^line 000000 /);
  for (let i = 1; i < 1000; i++) out.write(line(i));
  await settle();
  const cap = await host.capture();
  assert.ok(cap.stdout.length <= win32signin.SIGNIN_OUTPUT_LIMIT_CHARS, `kept ${cap.stdout.length} characters`);
  assert.ok(cap.stdout.endsWith(line(999)), 'the newest text was not kept');
  assert.ok(!cap.stdout.includes('line 000000 '), 'the oldest text was not dropped');
  await host.kill();
});

test('a line longer than the limit with nothing to cut at is dropped whole, never cut inside a token', () => {
  const keeper = win32signin.createTextKeeper(100);
  keeper.push('sk-ant-' + 'A'.repeat(200));
  const text = keeper.text();
  assert.ok(!text.includes('AAAAAAAAAA'), 'part of an undelimitable run survived');
  assert.match(text, /dropped/);
  /* CONTROL: a long line with a place to cut keeps its newest words. */
  const cuttable = win32signin.createTextKeeper(100);
  cuttable.push(Array.from({ length: 40 }, (_, i) => 'word' + i).join(' '));
  assert.match(cuttable.text(), /word39$/);
});

test('the first capture after exit returns the final text, later ones fail with the stderr tail and the exit code', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  child.stdout.write(OUT_BROWSER + OUT_PROMPT);
  for (let i = 0; i < 13; i++) child.stderr.write(`warning ${i}\n`);
  child.stderr.write(ERR_FAILED);
  await settle();
  assert.equal((await host.capture()).ok, true, 'a running program did not capture');
  child.exit(1);
  await settle();

  const first = await host.capture();
  assert.equal(first.ok, true, 'the final screen was not drained once');
  assert.match(first.stdout, /Login failed: Request failed/);

  const second = await host.capture();
  assert.equal(second.ok, false, 'a finished program kept capturing like a live one');
  assert.equal(second.exitCode, 1);
  assert.match(second.stderr, /Login failed: Request failed/);
  assert.match(second.stderr, /exited with code 1$/);
  const stderrLines = second.stderr.split('\n').slice(0, -1);
  assert.equal(stderrLines.length, win32signin.STDERR_TAIL_LINES, 'not the last 12 stderr lines');
  assert.doesNotMatch(second.stderr, /^warning 1$/m, 'older stderr than the tail came back');
  assert.match(second.stderr, /^warning 2$/m);

  assert.equal((await host.capture()).ok, false, 'the drain happened twice');
});

test('a success printed just before exit 0 is still seen', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  child.stdout.write(OUT_BROWSER + OUT_SUCCESS);
  child.exit(0);
  await settle();
  const cap = await host.capture();
  assert.equal(cap.ok, true);
  assert.match(cap.stdout, /Login successful\./);
  const after = await host.capture();
  assert.match(after.stderr, /exited with code 0/);
});

test('kill ends stdin, kills once, and is idempotent', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.kill(); // before any open: nothing to do, and no throw
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  await host.kill();
  await host.kill();
  await settle();
  assert.equal(child.killCalls, 1, 'kill was not idempotent');
  assert.equal(child.stdin.writableEnded, true, 'stdin was not ended');
  assert.equal((await host.capture()).ok, false, 'a killed sign-in still captured');
});

test('a token is redacted everywhere the host exposes text, including across chunks and on an unfinished line', async (t) => {
  assert.notEqual(win32signin.redactSecrets('x sk-ant-oat01-abc'), 'x sk-ant-oat01-abc', 'the redactor does nothing');
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  child.stdout.write('token sk-ant-oat01-ABCdef_123-xyz here\n');
  child.stdout.write('split sk-ant-oa');
  child.stdout.write('t01-SECRETPART more\n');
  child.stdout.write('partial sk-ant-api03-PARTIALSECRET');
  await settle();
  const cap = await host.capture();
  for (const secret of ['ABCdef_123', 'SECRETPART', 'PARTIALSECRET']) {
    assert.ok(!cap.stdout.includes(secret), `the capture exposed ${secret}`);
  }
  assert.equal((cap.stdout.match(/sk-ant-\[redacted\]/g) || []).length, 3, cap.stdout);

  child.stderr.write('Login failed: rejected sk-ant-oat01-STDERRSECRET\n');
  child.exit(1);
  await settle();
  await host.capture();
  const tail = await host.capture();
  assert.equal(tail.ok, false);
  assert.ok(!tail.stderr.includes('STDERRSECRET'), 'the stderr tail exposed a token');
  assert.match(tail.stderr, /sk-ant-\[redacted\]/);

  win32signin.setSpawn(() => { throw Object.assign(new Error('spawn failed near sk-ant-oat01-THROWNSECRET'), { code: 'EINVAL' }); });
  const failed = await host.open({ claudeBin: CLAUDE_BIN });
  assert.equal(failed.ok, false);
  assert.ok(!JSON.stringify(failed).includes('THROWNSECRET'), 'a start failure exposed a token');
  assert.match(failed.stderr, /EINVAL/);
});

test('a missing program is an honest failure, not a hang', async (t) => {
  const enoent = Object.assign(new Error('spawn C:\\nowhere\\claude.exe ENOENT'), { code: 'ENOENT' });
  withSpawn(t, () => fakeChild({ error: enoent }));
  const host = win32signin.createSigninHost();
  const made = await host.open({ claudeBin: 'C:\\nowhere\\claude.exe' });
  assert.equal(made.ok, false);
  assert.match(made.because, /could not find Claude Code/);
  assert.match(made.stderr, /ENOENT/);
  assert.equal((await host.capture()).ok, false, 'a program that never started captures as running');
});

test('after a code is sent the screen hides the old prompt, and only an Invalid code line brings it back', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  child.stdout.write(OUT_BROWSER + OUT_PROMPT);
  await settle();
  assert.match((await host.capture()).stdout, /Paste code here/, 'CONTROL: the prompt is on screen before the send');

  await host.sendCode(CODE);
  await settle();
  const pending = await host.capture();
  assert.equal(pending.ok, true);
  assert.doesNotMatch(pending.stdout, /Paste code here/,
    'the prompt stayed on screen while the code was being exchanged, so a slow valid code reads as rejected');
  assert.equal(pending.stdout, '', 'the screen since the send should be empty until the program answers');

  child.stderr.write('Invalid code\n');
  await settle();
  const refused = await host.capture();
  assert.match(refused.stdout, /Paste code here/, 'a refused code did not bring the prompt back');
  assert.match(refused.stdout, /Invalid code/);

  await host.sendCode('zyXW9876#vuTS5432');
  await settle();
  assert.doesNotMatch((await host.capture()).stdout, /Paste code here/, 'a second send did not hide the prompt again');
  child.stdout.write(OUT_SUCCESS);
  await settle();
  assert.equal((await host.capture()).stdout, OUT_SUCCESS, 'the answer to the second code is not what the screen shows');
  await host.kill();
});

test('an exit whose pipes never close still ends the sign-in after the grace', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  child.stdout.write(OUT_BROWSER + OUT_SUCCESS);
  await settle();
  /* 'exit' alone: a browser the program started still holds the pipes, so 'close' never comes. */
  child.emit('exit', 0, null);
  await settle();
  assert.equal((await host.capture()).ok, true, 'the pipes were treated as closed before the grace');
  assert.equal((await host.capture()).ok, true, 'a still-open program drained early');
  await new Promise((r) => setTimeout(r, 1300));
  const drained = await host.capture();
  assert.equal(drained.ok, true, 'the final screen was not drained once after the grace');
  assert.match(drained.stdout, /Login successful\./);
  const after = await host.capture();
  assert.equal(after.ok, false, 'an exited program whose pipes stay open captures as running forever');
  assert.match(after.stderr, /exited with code 0/);
});

test('a program that echoes the pasted code has it redacted, whole and by halves, but short fragments are left alone', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  child.stdout.write(OUT_PROMPT);
  await host.sendCode(CODE);
  child.stdout.write('received ' + CODE + '\n');
  child.stderr.write('exchange failed for abCD1234 with state efGH5678 about the code\n');
  await settle();
  const screen = await host.capture();
  for (const piece of [CODE, 'abCD1234', 'efGH5678']) {
    assert.ok(!screen.stdout.includes(piece), `the screen exposed ${piece}`);
  }
  assert.match(screen.stdout, /\[redacted code\]/);
  child.exit(1);
  await settle();
  await host.capture();
  const tail = await host.capture();
  for (const piece of [CODE, 'abCD1234', 'efGH5678']) {
    assert.ok(!tail.stderr.includes(piece), `the stderr tail exposed ${piece}`);
  }
  assert.match(tail.stderr, /about the code/, 'ordinary words were redacted too');

  /* A code with a half shorter than the floor: that half is not hunted for everywhere. */
  await host.open({ claudeBin: CLAUDE_BIN });
  const second = spawn.calls[1].child;
  second.stdout.write(OUT_PROMPT);
  await host.sendCode('ab#cdEFgh1234');
  second.stdout.write('about cdEFgh1234\n');
  await settle();
  const short = await host.capture();
  assert.match(short.stdout, /about/, 'a two-character half blanked ordinary words');
  assert.ok(!short.stdout.includes('cdEFgh1234'), 'the long half leaked');
  assert.equal(win32signin.SENT_FRAGMENT_MIN_CHARS, 8);
  await host.kill();
});

test('Claude Code resolved without an extension starts as claude.exe', async (t) => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'exe-'));
  fs.writeFileSync(path.join(dir, 'claude.exe'), '');
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: path.join(dir, 'claude') });
  assert.equal(spawn.calls[0].file, path.join(dir, 'claude.exe'), 'the program file was left for the loader to guess');
  await host.kill();
});

test('a script-only Claude Code gets one honest sentence, whether the start fails ENOENT or EINVAL', async (t) => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'cmd-'));
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\n');
  /* win32-signin-web-copy: plain words for a person new to Windows. The stuck card's open
     hatch says what to do next, so the sentence names no file, extension or script. */
  const SCRIPT_SENTENCE = /^Kosmos cannot start the copy of Claude Code on this computer by itself$/;
  const INTERNALS = /claude\.exe|script|program file|\.cmd|\.bat|\.ps1/i;

  const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  withSpawn(t, () => fakeChild({ error: enoent }));
  const host = win32signin.createSigninHost();
  const viaSibling = await host.open({ claudeBin: path.join(dir, 'claude') });
  assert.equal(viaSibling.ok, false);
  assert.match(viaSibling.because, SCRIPT_SENTENCE, 'a .cmd install was told Claude Code could not be found');

  win32signin.setSpawn(() => { throw Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' }); });
  const direct = await host.open({ claudeBin: path.join(dir, 'claude.cmd') });
  assert.equal(direct.ok, false);
  assert.match(direct.because, SCRIPT_SENTENCE, 'a full .cmd path failing EINVAL got a different sentence');
  assert.doesNotMatch(direct.because, INTERNALS, 'the script sentence explains Kosmos internals to the person again');
  assert.match(direct.stderr, /EINVAL/);

  /* CONTROL: nothing at all there is still "could not find". */
  win32signin.setSpawn(() => fakeChild({ error: enoent }));
  const nothing = await host.open({ claudeBin: path.join(fs.mkdtempSync(path.join(SANDBOX, 'none-')), 'claude') });
  assert.equal(nothing.because, 'Kosmos could not find Claude Code to run its sign-in');
});

/* Round 2 redaction arms. A real OAuth code has long halves; these are 38 and 35 characters. */
const LONG_CODE_HALF = 'CODEhalfQ7w9Zk3mP2vB8nL4tR6yH1jF5dS0aG';
const LONG_STATE_HALF = 'STATEhalfu2Wq8Er4Ty6Ui0Op1As3Df5Gh7';
const LONG_CODE = LONG_CODE_HALF + '#' + LONG_STATE_HALF;

/* Any prefix or suffix of either half of six characters or more, found in `text`. */
function sentCodeLeaks(text) {
  const found = [];
  for (const secret of [LONG_CODE_HALF, LONG_STATE_HALF]) {
    for (let len = 6; len <= secret.length; len++) {
      if (text.includes(secret.slice(0, len))) found.push(`${secret.slice(0, 5)} prefix ${len}`);
      if (text.includes(secret.slice(secret.length - len))) found.push(`${secret.slice(0, 5)} suffix ${len}`);
    }
  }
  return found;
}

test('R1: the 64 KB cap can never cut an echoed code and leave part of it readable', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  const limit = win32signin.SIGNIN_OUTPUT_LIMIT_CHARS;
  for (const [i, shift] of [5, 20, 40, 60].entries()) {
    await host.open({ claudeBin: CLAUDE_BIN });
    const child = spawn.calls[i].child;
    child.stdout.write(OUT_PROMPT);
    await host.sendCode(LONG_CODE);
    /* One long line: the code, then filler sized so the cap lands `shift` characters into it. */
    child.stdout.write('echo ' + LONG_CODE + ' ');
    const fillLen = limit - (LONG_CODE.length + 1 - shift);
    child.stdout.write('w '.repeat(Math.ceil(fillLen / 2)).slice(0, fillLen - 1) + '\n');
    await settle();
    const cap = await host.capture();
    assert.ok(cap.stdout.length <= limit);
    assert.deepEqual(sentCodeLeaks(cap.stdout), [], `shift ${shift}: the cap left part of the code readable`);
  }
  for (const [i, shift] of [10, 30].entries()) {
    await host.open({ claudeBin: CLAUDE_BIN });
    const child = spawn.calls[4 + i].child;
    child.stdout.write(OUT_PROMPT);
    await host.sendCode(LONG_CODE);
    /* The code on its own line, then newline-delimited filler. */
    child.stdout.write('\n' + LONG_CODE + '\n');
    let remaining = limit - (LONG_CODE.length + 1 - shift);
    let filler = '';
    while (remaining > 0) { const l = 'y'.repeat(Math.max(0, Math.min(99, remaining - 1))) + '\n'; filler += l; remaining -= l.length; }
    child.stdout.write(filler);
    await settle();
    const cap = await host.capture();
    assert.deepEqual(sentCodeLeaks(cap.stdout), [], `line shift ${shift}: the cap left part of the code readable`);
  }
  /* The stderr tail too: an echo, then enough stderr to cap the stderr keeper inside it. */
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[6].child;
  await host.sendCode(LONG_CODE);
  child.stderr.write('Login failed for ' + LONG_CODE + ' ');
  const fillLen = limit - (LONG_CODE.length + 1 - 25);
  child.stderr.write('e '.repeat(Math.ceil(fillLen / 2)).slice(0, fillLen - 1) + '\n');
  child.exit(1);
  await settle();
  await host.capture();
  const tail = await host.capture();
  assert.equal(tail.ok, false);
  assert.deepEqual(sentCodeLeaks(tail.stderr), [], 'the stderr tail kept part of the code');
  await host.kill();
});

test('R3: an echo split across chunks never shows a readable piece of the code on the unfinished line', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[0].child;
  child.stdout.write(OUT_PROMPT);
  await host.sendCode(LONG_CODE);
  child.stdout.write('got ' + LONG_CODE.slice(0, 20));
  await settle();
  const mid = await host.capture();
  assert.deepEqual(sentCodeLeaks(mid.stdout), [], 'the unfinished line showed the start of the code: ' + mid.stdout);
  assert.match(mid.stdout, /^got \[redacted code\]$/);
  child.stdout.write(LONG_CODE.slice(20) + ' ok\n');
  await settle();
  const end = await host.capture();
  assert.deepEqual(sentCodeLeaks(end.stdout), []);
  assert.equal(end.stdout, 'got [redacted code] ok\n');
  /* CONTROL: ordinary text that shares no four characters with the code is untouched. */
  child.stdout.write('Login successful.\n');
  await settle();
  assert.match((await host.capture()).stdout, /Login successful\.\n$/);
  await host.kill();
});

/* Any 8-character window of either half: an interior piece leaking. */
function sentCodeWindowLeaks(text) {
  const found = [];
  for (const secret of [LONG_CODE_HALF, LONG_STATE_HALF]) {
    for (let i = 0; i + 8 <= secret.length; i++) {
      if (text.includes(secret.slice(i, i + 8))) { found.push(`${secret.slice(0, 5)} window at ${i}`); break; }
    }
  }
  return found;
}
const allSentLeaks = (text) => sentCodeLeaks(text).concat(sentCodeWindowLeaks(text));

async function hostWithSentCode(t, spawn, host) {
  await host.open({ claudeBin: CLAUDE_BIN });
  const child = spawn.calls[spawn.calls.length - 1].child;
  child.stdout.write(OUT_PROMPT);
  await host.sendCode(LONG_CODE);
  return child;
}

test('round 3: a sent piece wrapped across real newlines leaks no readable part, in the capture or the stderr tail', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  const S = LONG_STATE_HALF;   // 35 characters
  const C = LONG_CODE_HALF;    // 38 characters
  const cases = [
    ['one newline, in one push', [`warn: saw ${S.slice(0, 20)}\n${S.slice(20)} (unexpected)\n`]],
    ['one newline, straddling two pushes (the review repro)', [`warn: saw ${S.slice(0, 20)}\n`, `${S.slice(20)} (unexpected)\n`]],
    ['two newlines: prefix / interior of 15 / suffix', [`saw ${C.slice(0, 10)}\n${C.slice(10, 25)}\n${C.slice(25)} end\n`]],
    ['three newlines: 9 / 9 / 9 / rest', [`${S.slice(0, 9)}\n`, `${S.slice(9, 18)}\n${S.slice(18, 27)}\n`, `${S.slice(27)}\n`]],
    ['CRLF line endings', [`saw ${C.slice(0, 10)}\r\n${C.slice(10, 25)}\r\n${C.slice(25)} end\r\n`]],
  ];
  for (const [name, chunks] of cases) {
    const child = await hostWithSentCode(t, spawn, host);
    for (const chunk of chunks) { child.stdout.write(chunk); await settle(); }
    const cap = await host.capture();
    assert.equal(cap.ok, true);
    assert.deepEqual(allSentLeaks(cap.stdout), [], `${name}: the capture left part of the code readable:\n${cap.stdout}`);
    assert.match(cap.stdout, /\[redacted code\]/, `${name}: nothing was redacted at all`);
    await host.kill();
  }
  /* The stderr tail: the same wraps, on stderr, after exit. */
  const child = await hostWithSentCode(t, spawn, host);
  child.stderr.write(`Login failed near ${S.slice(0, 12)}\n`);
  child.stderr.write(`${S.slice(12, 24)}\n${S.slice(24)}\n`);
  child.exit(1);
  await settle();
  await host.capture();
  const tail = await host.capture();
  assert.equal(tail.ok, false);
  assert.deepEqual(allSentLeaks(tail.stderr), [], 'the stderr tail left part of the code readable:\n' + tail.stderr);
  assert.match(tail.stderr, /^Login failed near \[redacted code\]$/m);
});

test('round 3 CONTROL: lines that share only a short edge or a short interior with the code, and the sign-in URL, are left intact', async (t) => {
  const spawn = withSpawn(t);
  const host = win32signin.createSigninHost();
  const child = await hostWithSentCode(t, spawn, host);
  const url = 'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=OTHERstate0123456789';
  const lines = [
    `we saw ${LONG_CODE_HALF.slice(0, 3)}`,                            // a 3-character prefix at a line end
    `${LONG_CODE_HALF.slice(-3)} is here`,                             // a 3-character suffix at a line start
    LONG_CODE_HALF.slice(10, 17),                                      // a 7-character interior line of its own
    'If the browser did not open, visit: ' + url,
    'Login successful.',
  ];
  child.stdout.write(lines.join('\n') + '\n');
  await settle();
  const cap = await host.capture();
  assert.equal(cap.stdout, lines.join('\n') + '\n', 'ordinary text was masked');
  await host.kill();
});

test('EFTYPE on a script gets the script sentence; EFTYPE on a broken program file does not', async (t) => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'eftype-'));
  fs.writeFileSync(path.join(dir, 'claude.ps1'), 'exit 0\n');
  fs.writeFileSync(path.join(dir, 'claude.exe'), '');
  withSpawn(t);
  const host = win32signin.createSigninHost();
  win32signin.setSpawn(() => { throw Object.assign(new Error('spawn EFTYPE'), { code: 'EFTYPE' }); });
  const script = await host.open({ claudeBin: path.join(dir, 'claude.ps1') });
  assert.equal(script.because, 'Kosmos cannot start the copy of Claude Code on this computer by itself',
    'a .ps1 failing EFTYPE got the general sentence');
  assert.match(script.stderr, /EFTYPE/);
  const broken = await host.open({ claudeBin: path.join(dir, 'claude.exe') });
  assert.equal(broken.because, 'Kosmos could not start the Claude sign-in on this computer',
    'a broken claude.exe was told it is a script');
  assert.match(broken.stderr, /EFTYPE/);
});

test('win32-signin-web-copy: the PowerShell sign-in line names a program file exactly, for the path shapes measured on PowerShell 5.1', () => {
  /* Each expected line below ran the exact stand-in claude.exe on Windows PowerShell 5.1 in real
     folders with one decoy sibling (the table is in engine/win32signin.js and the plan). The
     win32-only arm below re-runs the bracket shapes for real on every Windows run. */
  const line = win32signin.signinLineForClaudeFile;
  const TAIL = ' auth login --claudeai';
  const LEFT = String.fromCharCode(0x2018);
  const RIGHT = String.fromCharCode(0x2019);
  const LOW = String.fromCharCode(0x201A);
  const REVERSED = String.fromCharCode(0x201B);
  assert.deepEqual(win32signin.SIGNIN_ARGS, ['auth', 'login', '--claudeai'],
    'the line a person runs and the sign-in Kosmos runs no longer share one argument list');

  assert.equal(line('C:\\Users\\josh\\.local\\bin\\claude.exe'), "& 'C:\\Users\\josh\\.local\\bin\\claude.exe'" + TAIL);
  assert.equal(line('C:\\Users\\Mary Ann\\.local\\bin\\claude.exe'), "& 'C:\\Users\\Mary Ann\\.local\\bin\\claude.exe'" + TAIL, 'a space broke the line');
  assert.equal(line("C:\\Users\\Mary O'Brien\\.local\\bin\\claude.exe"), "& 'C:\\Users\\Mary O''Brien\\.local\\bin\\claude.exe'" + TAIL, 'an apostrophe was not doubled');
  assert.equal(line('C:\\Users\\a$env:USERNAME `n $(Get-Date)\\claude.exe'), "& 'C:\\Users\\a$env:USERNAME `n $(Get-Date)\\claude.exe'" + TAIL,
    '$ and a backtick with no bracket are literal inside single quotes, so nothing may be added around them');
  assert.equal(line('C:\\Users\\curly ' + LEFT + 'left' + RIGHT + ' ' + LOW + 'low' + REVERSED + '\\claude.exe'),
    "& 'C:\\Users\\curly " + LEFT + LEFT + 'left' + RIGHT + RIGHT + ' ' + LOW + LOW + 'low' + REVERSED + REVERSED + "\\claude.exe'" + TAIL,
    'PowerShell reads the typographic single quotes as quotes too, and they were not doubled');

  /* Brackets: `&` reads `[` `]` as a wildcard class even inside single quotes, so a path holding
     one has every backtick, `[` and `]` backtick-escaped. Unescaped, `z[a-c]` ran its sibling `zb`. */
  assert.equal(line('C:\\Users\\z[a-c]\\claude.exe'), "& 'C:\\Users\\z`[a-c`]\\claude.exe'" + TAIL, 'a bracket class was left for PowerShell to expand');
  assert.equal(line('C:\\Users\\a`b[c]\\claude.exe'), "& 'C:\\Users\\a``b`[c`]\\claude.exe'" + TAIL,
    'a backtick beside a bracket was not escaped, which PowerShell 5.1 then reads as an escape');
  assert.equal(line('C:\\Users\\a`[b]\\claude.exe'), "& 'C:\\Users\\a```[b`]\\claude.exe'" + TAIL);
  assert.equal(line("C:\\Users\\O'B[r]\\claude.exe"), "& 'C:\\Users\\O''B`[r`]\\claude.exe'" + TAIL, 'quote doubling and bracket escaping did not compose');
  assert.equal(line('C:\\Users\\O' + RIGHT + 'B[r]\\claude.exe'), "& 'C:\\Users\\O" + RIGHT + RIGHT + "B`[r`]\\claude.exe'" + TAIL);
  assert.equal(line('C:\\Users\\a[b\\claude.exe'), "& 'C:\\Users\\a`[b\\claude.exe'" + TAIL, 'a lone [ is an invalid wildcard pattern unescaped');
  assert.equal(line('C:\\Users\\x[1]\\y[2]\\claude.exe'), "& 'C:\\Users\\x`[1`]\\y`[2`]\\claude.exe'" + TAIL);

  /* No bracket, no wildcard escaping: these lines stay the ones already verified byte for byte. */
  assert.equal(line('C:\\Users\\back`tick\\claude.exe'), "& 'C:\\Users\\back`tick\\claude.exe'" + TAIL);
  assert.equal(line('C:\\Users\\two``ticks\\claude.exe'), "& 'C:\\Users\\two``ticks\\claude.exe'" + TAIL);

  for (const unusable of ['', null, undefined, 42, 'C:\\a\nb\\claude.exe', 'C:\\a\rb\\claude.exe', 'C:\\a\0b\\claude.exe']) {
    assert.equal(line(unusable), null, `an unusable path produced a line: ${JSON.stringify(unusable)}`);
  }
  /* A script is never given a line: cmd.exe expands %VAR% and splits at & in the pasted path. */
  for (const script of ['C:\\Users\\josh\\.local\\bin\\claude.cmd', 'C:\\x\\claude.bat', 'C:\\x\\claude.ps1', 'C:\\x\\CLAUDE.CMD']) {
    assert.equal(line(script), null, `a script install was given a line: ${script}`);
  }
});

test('win32-signin-web-copy: a script-only Claude Code install gets no line, and the program file beside a script does', () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'line-'));
  assert.ok(!/['[\]`]/.test(dir), 'this arm assumes a sandbox path with no quote, bracket or backtick of its own');
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo off\n');
  assert.equal(win32signin.signinLineForClaudeFile(path.join(dir, 'claude')), null, 'an extensionless path whose only file is a .cmd got a line');
  assert.equal(win32signin.signinLineForClaudeFile(path.join(dir, 'claude.cmd')), null, 'a .cmd got a line');
  fs.writeFileSync(path.join(dir, 'claude.exe'), '');
  assert.equal(win32signin.signinLineForClaudeFile(path.join(dir, 'claude')), "& '" + path.join(dir, 'claude.exe') + "' auth login --claudeai",
    'the program file beside the script was not the one named');
});

test('win32-signin-web-copy: on Windows, PowerShell runs exactly the file each line names, never a sibling its brackets match',
  { skip: process.platform === 'win32' ? false : 'needs Windows PowerShell and the Windows loader to run the lines' }, (t) => {
    const { spawnSync } = require('node:child_process');
    const root = fs.mkdtempSync(path.join(SANDBOX, 'psline-'));
    assert.ok(!/['[\]`]/.test(root), 'this arm assumes a sandbox path with no quote, bracket or backtick of its own');
    const out = path.join(root, 'ran.txt');
    /* The stand-in: this node.exe, hard-linked (or copied) in as claude.exe. Given `auth login
       --claudeai` it runs the script file `auth` from PowerShell's working folder, which records
       the path of the program that actually started. */
    const cwd = path.join(root, 'cwd');
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'auth'),
      "require('fs').writeFileSync(process.env.KOSMOS_LINE_PROBE_OUT, process.execPath + '\\n' + process.argv.slice(2).join(' '));\n");
    const plant = (rel) => {
      const dir = path.join(root, rel);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'claude.exe');
      try { fs.linkSync(process.execPath, file); } catch { fs.copyFileSync(process.execPath, file); }
      return file;
    };
    const run = (text) => {
      fs.rmSync(out, { force: true });
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(text, 'utf16le').toString('base64')],
        { cwd, env: { ...process.env, KOSMOS_LINE_PROBE_OUT: out }, encoding: 'utf8', timeout: 60000, windowsHide: true });
      const ran = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n') : null;
      return { error: r.error, ran, stderr: String(r.stderr || '').trim().split('\n')[0] };
    };
    if (run('exit 0').error) {
      t.skip('powershell.exe could not be started here');
      return;
    }
    /* Each case in its own folder with ONE decoy sibling its brackets would match. */
    const CASES = [['z[a-c]', 'zb'], ['a`b[c]', 'abc'], ['a`[b]', 'a[b]'], ["O'B[r]", "O'Br"], ['[s]tart', 'start'], ['plain', null]];
    CASES.forEach(([target, decoy], i) => {
      const file = plant(path.join('c' + i, target));
      const decoyFile = decoy ? plant(path.join('c' + i, decoy)) : null;
      const result = run(win32signin.signinLineForClaudeFile(file));
      assert.ok(result.ran, `the line for ${target} ran nothing: ${result.stderr}`);
      assert.equal(result.ran[0], file, `the line for ${target} ran a different program${decoyFile ? ' (its decoy sibling)' : ''}`);
      assert.equal(result.ran[1], 'login --claudeai');
      if (i === 0) {
        /* CONTROL: the same path left unescaped runs the decoy, so an exact run above is the escaping. */
        const naive = run("& '" + file + "' auth login --claudeai");
        assert.equal(naive.ran && naive.ran[0], decoyFile, 'CONTROL: the unescaped line did not run the decoy, so this arm cannot tell escaping from luck');
      }
    });
  });

test('every redaction this host writes carries the marker connect.js looks for', () => {
  assert.equal(win32signin.REDACTION_MARKER, '[redacted');
  assert.ok(win32signin.redactSecrets('sk-ant-oat01-abcdef').includes(win32signin.REDACTION_MARKER));
  const keeper = win32signin.createTextKeeper(1000, () => ['abcdefgh12345678']);
  keeper.push('x abcdefgh12345678 y\n');
  assert.ok(keeper.text().includes(win32signin.REDACTION_MARKER));
});

test('Convention 3: with no spawn seam and live execution not armed, nothing is started', async () => {
  win32signin.setSpawn(null);
  liveExecution.resetForTests();
  assert.equal(liveExecution.inTestProcess(), true, 'this process is not seen as a test, so the refusal below cannot throw');
  const host = win32signin.createSigninHost();
  await assert.rejects(
    () => host.open({ claudeBin: path.join(SANDBOX, 'no-such-claude.exe') }),
    /tried to execute/,
    'the host would have started a real program in a test with no seam');
});
