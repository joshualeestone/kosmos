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
