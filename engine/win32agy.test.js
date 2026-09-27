'use strict';
/**
 * #3568: Antigravity (Google's agy) agents on Windows, one headless turn per message
 * (engine/win32agy.js), through the same per-turn supervisor as codex, Gemini and Grok. The agy here
 * is a stand-in (test-support/fake-agy.js) run as a real child process, so the spawn shape (argv,
 * cwd, stdin, PATH, TEMP) is what the real one gets. Runs on any platform.
 *
 *   node -r <no-schtasks-preload> --test engine/win32agy.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const agy = require('./win32agy');
const { superviseCodexStreaming } = require('./win32codexsup');
const win32launch = require('./win32launch');
const codexlive = require('./win32codexlive');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-win32agy-')));
const FAKE = path.join(__dirname, '..', 'test-support', 'fake-agy.js');
agy.setRootForTests(path.join(SANDBOX, 'data'));
test.after(() => {
  agy.setRootForTests(null); agy.setSpawn(null); agy.setExec(null); agy.setTreeKill(null); agy.setSwitchForTests(null);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* Run the stand-in as a real child in place of agy: node fake-agy.js <the args agy would get>. */
function fakeSpawn(mode, extraEnv) {
  const calls = [];
  agy.setSpawn((file, args, opts) => {
    calls.push({ file, args, opts });
    return spawn(process.execPath, [FAKE, ...args], Object.assign({}, opts, { env: Object.assign({}, opts.env, { FAKE_AGY_MODE: mode }, extraEnv || {}) }));
  });
  return calls;
}
/* `agy models`: signed in (exit 0, the model list) or signed out (exit 1, "Please sign in"). */
function fakeModels(signedIn) {
  const calls = [];
  agy.setExec((file, args, opts, done) => {
    calls.push({ file, args, opts });
    if (signedIn) setImmediate(() => done(null, 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n', ''));
    else setImmediate(() => done(Object.assign(new Error('exit 1'), { code: 1 }), '', 'Fetching available models...\nError: Please sign in to view available models. Launch the CLI without arguments to sign in.\n'));
  });
  return calls;
}
const readRecord = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

/* ---- the switch ----------------------------------------------------------------------------- */

test('the Windows switch is ON by default (proven signed in); the env or an .off file in the data folder turns it off (env wins)', () => {
  const was = process.env[agy.SWITCH_ENV];
  try {
    delete process.env[agy.SWITCH_ENV];
    assert.equal(agy.SWITCH_FILE, 'antigravity-windows.off');
    assert.equal(agy.switchOn(), true, 'on by default');
    fs.mkdirSync(path.join(SANDBOX, 'data'), { recursive: true });
    fs.writeFileSync(path.join(SANDBOX, 'data', agy.SWITCH_FILE), '');
    assert.equal(agy.switchOn(), false, 'the .off file turns it off, no restart');
    process.env[agy.SWITCH_ENV] = '1';
    assert.equal(agy.switchOn(), true, 'the env forces it on even with the file');
    fs.rmSync(path.join(SANDBOX, 'data', agy.SWITCH_FILE));
    process.env[agy.SWITCH_ENV] = '0';
    assert.equal(agy.switchOn(), false, 'the env turns it off');
  } finally {
    if (was === undefined) delete process.env[agy.SWITCH_ENV]; else process.env[agy.SWITCH_ENV] = was;
  }
});

/* ---- argv and parse ------------------------------------------------------------------------- */

test('turn argv: global flags first, the message glued to --print, JSON out, autonomy, --conversation only when resuming', () => {
  const a = agy.turnArgs({ geminiDir: 'C:\\K\\agy-home\\a\\.gemini', message: '-rf "x" & | %PATH%\nline two' });
  assert.deepEqual(a, ['--gemini_dir=C:\\K\\agy-home\\a\\.gemini', '--print=-rf "x" & | %PATH%\nline two', '--output-format', 'json', '--dangerously-skip-permissions']);
  const b = agy.turnArgs({ geminiDir: 'D', message: 'm', sessionId: 'c-1', model: 'gemini-3.8-flash-high' });
  assert.deepEqual(b.slice(-4), ['--conversation', 'c-1', '--model', 'gemini-3.8-flash-high']);
});

test('parseTurn reads the measured success line and the measured signed-out line', () => {
  const ok = '{"conversation_id":"7c2c","status":"SUCCESS","response":"banana","duration_seconds":3.1,"num_turns":1,"usage":{}}\n';
  assert.deepEqual(agy.parseTurn(ok, ''), { response: 'banana', sessionId: '7c2c', error: null, signedOut: false });
  const out = '{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out","duration_seconds":0,"num_turns":0,"usage":{}}\n';
  const r = agy.parseTurn(out, 'Error: authentication timed out.\nerror: authentication failed or timed out\n');
  assert.equal(r.error, 'authentication failed or timed out');
  assert.equal(r.signedOut, true);
  assert.equal(r.sessionId, null, 'an empty conversation id is no id');
});

/* ---- the environment: never a browser -------------------------------------------------------- */

test('every agy child gets the no-browser stub FIRST on its one PATH, its own TEMP, and no CLAUDE_CONFIG_DIR', () => {
  const env = agy.agyEnv({ Path: 'C:\\Windows\\System32', TEMP: 'C:\\T', tmp: 'C:\\T', CLAUDE_CONFIG_DIR: 'C:\\c' }, path.join(SANDBOX, 'tmp1'));
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');
  assert.deepEqual(keys, ['Path'], 'one PATH key, the case it came in');
  const stub = env.Path.split(path.win32.delimiter)[0];
  assert.equal(stub, agy.stubDir());
  const body = fs.readFileSync(path.join(stub, 'rundll32.cmd'), 'utf8');
  assert.equal(body, agy.STUB_BODY);
  assert.match(body, /^@exit 0\r$/m, 'exit (not exit /b): the rest of agy\'s unquoted link is never run by cmd');
  assert.equal(env.TEMP, path.join(SANDBOX, 'tmp1'));
  assert.equal(env.TMP, path.join(SANDBOX, 'tmp1'));
  assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === 'TMP').length, 1);
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
});

/* ---- one turn ------------------------------------------------------------------------------- */

test('a turn runs agy in the agent folder, stdin closed, its own home and TEMP, the stub first, the folder pre-trusted there', async () => {
  const rec = path.join(SANDBOX, 'rec-turn.jsonl');
  fakeSpawn('turn', { FAKE_AGY_RECORD: rec, FAKE_AGY_REPLY: 'done' });
  const models = fakeModels(true);
  const cwd = path.join(SANDBOX, 'agents', 'Ada'); fs.mkdirSync(cwd, { recursive: true });
  const r = await agy.runAgyTurn({ name: 'Ada', bin: 'C:\\K\\agy.exe', message: 'hello', cwd, env: agy.turnEnv({ Path: 'C:\\Windows', CLAUDE_CONFIG_DIR: 'x' }) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.response, 'done');
  assert.match(r.sessionId, /^conv-/);
  const home = agy.agentHome('Ada');
  const [seen] = readRecord(rec);
  assert.equal(seen.args[0], '--gemini_dir=' + home.geminiDir);
  assert.ok(seen.args.includes('--print=hello'));
  assert.ok(seen.args.includes('--dangerously-skip-permissions'));
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(cwd));
  assert.equal(seen.pathFirst, agy.stubDir(), 'the stub is first on the child PATH');
  assert.equal(seen.temp, home.tmp);
  assert.equal(seen.perTurn, '1');
  assert.equal(seen.claudeConfig, null);
  assert.equal(seen.stdinClosed, true, 'stdin is closed');
  assert.deepEqual(models[0].args, ['--gemini_dir=' + home.geminiDir, 'models'], 'the sign-in check: global flag BEFORE the subcommand');
  const settings = JSON.parse(fs.readFileSync(path.join(home.geminiDir, 'antigravity-cli', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.trustedWorkspaces, [fs.realpathSync(cwd)]);
  assert.ok(!home.root.startsWith(cwd), 'the agy home is not inside the agent folder');
});

test('signed out: the turn fails AT ONCE in words, and agy -p (a 60 s wait) is never started', async () => {
  const calls = fakeSpawn('turn');
  fakeModels(false);
  const t0 = Date.now();
  const r = await agy.runAgyTurn({ name: 'Bo', bin: 'agy.exe', message: 'hi', cwd: SANDBOX, sessionId: 'keep-me' });
  assert.equal(r.ok, false);
  assert.equal(r.signedOut, true);
  assert.match(r.error, /not signed in on this computer.*Sign in with Google/);
  assert.equal(r.sessionId, 'keep-me', 'the conversation is kept for when it is signed in again');
  assert.equal(calls.length, 0, 'no print run');
  assert.ok(Date.now() - t0 < 5000);
});

test('the second turn resumes the conversation the first one printed; a conversation agy has lost starts fresh', async () => {
  const rec = path.join(SANDBOX, 'rec-resume.jsonl');
  fakeSpawn('turn', { FAKE_AGY_RECORD: rec });
  fakeModels(true);
  const r1 = await agy.runAgyTurn({ name: 'Cy', bin: 'agy.exe', message: 'one', cwd: SANDBOX });
  const r2 = await agy.runAgyTurn({ name: 'Cy', bin: 'agy.exe', message: 'two', cwd: SANDBOX, sessionId: r1.sessionId });
  const seen = readRecord(rec);
  assert.ok(!seen[0].args.includes('--conversation'));
  assert.deepEqual(seen[1].args.slice(seen[1].args.indexOf('--conversation'), seen[1].args.indexOf('--conversation') + 2), ['--conversation', r1.sessionId]);
  assert.equal(r2.sessionId, r1.sessionId);
  fakeSpawn('lost');
  const r3 = await agy.runAgyTurn({ name: 'Cy', bin: 'agy.exe', message: 'three', cwd: SANDBOX, sessionId: r1.sessionId });
  assert.equal(r3.ok, false);
  assert.equal(r3.resetSession, true);
  assert.equal(r3.sessionId, null);
});

test('a turn still going at its cap is stopped, WHOLE TREE, and says so; a stop mid-turn kills the tree too', async () => {
  fakeSpawn('slow', { FAKE_AGY_SLEEP_MS: '20000' });
  fakeModels(true);
  const killed = [];
  agy.setTreeKill((c) => { killed.push(c.pid); try { process.kill(c.pid); } catch { /* gone */ } });
  const r = await agy.runAgyTurn({ name: 'Di', bin: 'agy.exe', message: 'x', cwd: SANDBOX, turnMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.error, /still going/);
  assert.equal(killed.length, 1);
  let child = null;
  const p = agy.runAgyTurn({ name: 'Di', bin: 'agy.exe', message: 'y', cwd: SANDBOX, onSpawn: (c) => { child = c; } });
  while (!child) await new Promise((res) => setTimeout(res, 20));
  child.kill();   // what win32codexsup's stop does
  await p;
  assert.equal(killed.length, 2, 'the stop went through the tree kill');
  assert.equal(killed[1], child.pid);
  agy.setTreeKill(null);
});

/* ---- the per-turn supervisor ------------------------------------------------------------------ */

test('win32codexsup runs an antigravity spec through runAgyTurn, with the agent name, KOSMOS_PER_TURN and the resumed conversation', async () => {
  const rec = path.join(SANDBOX, 'rec-sup.jsonl');
  fakeSpawn('turn', { FAKE_AGY_RECORD: rec });
  fakeModels(true);
  const cwd = path.join(SANDBOX, 'agents', 'Eve'); fs.mkdirSync(cwd, { recursive: true });
  const events = [];
  const h = superviseCodexStreaming({ name: 'Eve', cwd, runner: 'antigravity', claudeBin: 'C:\\K\\agy.exe' }, {
    bin: 'C:\\K\\agy.exe',
    prepare: () => ({ ok: true, sessionId: '11111111-1111-4111-8111-111111111111', token: 'tok', instance: null }),
    cliDir: null,
    sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
    onEvent: (e) => events.push(e.action),
  });
  await new Promise((res) => h.send('first', res));
  while (!events.includes('turn')) await new Promise((res) => setTimeout(res, 20));
  await new Promise((res) => h.send('second', res));
  while (events.filter((e) => e === 'turn').length < 2) await new Promise((res) => setTimeout(res, 20));
  h.stop();
  const seen = readRecord(rec);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].args[0], '--gemini_dir=' + agy.agentHome('Eve').geminiDir, 'the agent\'s own home, by its name');
  assert.equal(seen[0].perTurn, '1');
  assert.ok(seen[1].args.includes('--conversation'), 'the second turn resumes');
});

test('the Windows launch pieces know antigravity: the PowerShell policy for kosmos reply, the bare name, a per-turn live row', () => {
  const env = win32launch.childEnv({ Path: 'C:\\W' }, 'tok', null, null, 'antigravity');
  assert.equal(env.PSExecutionPolicyPreference, 'Bypass', 'agy\'s shell is PowerShell (measured: echo > file wrote UTF-16)');
  assert.equal(win32launch.binFor({ runner: 'antigravity' }), 'agy');
  const sid = '22222222-2222-4222-8222-222222222222';
  const rows = codexlive.liveSessions({
    record: { read: () => ({ [sid]: { name: 'Fay', runner: 'antigravity' } }) },
    identity: () => ({ pid: process.pid, sessionId: sid }),
    pidAlive: () => true,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runner, 'antigravity');
});
