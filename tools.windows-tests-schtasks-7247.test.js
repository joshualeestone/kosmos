'use strict';
/**
 * #7247: a test run on a Windows computer is kept off its real Task Scheduler by tools/no-schtasks-preload.cjs, which
 * tools/windows-tests.js (and tools/run-tests.sh, through it) load by themselves there, except on CI and when
 * KOSMOS_TESTS_REAL_SCHTASKS=1 asks for the real scheduler. The rule and the matcher are pure and run on every
 * platform; the preload is loaded into a real child process the way the runner loads it, so every child_process arm is
 * checked for what a caller sees.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const wt = require('./tools/windows-tests');
const { callRuns, commandRuns } = require('./tools/lib/schtasks-call.cjs');

const WIN_DEV = { PATH: process.env.PATH || '' };   // a Windows computer that is not CI

/* ---------- the rule ---------- */

test('#7247: on a Windows computer that is not CI, every test file loads the preload, with forward slashes', () => {
  const env = wt.childEnv(WIN_DEV, 'win32');
  assert.equal(env.NODE_OPTIONS, '--require "' + wt.PRELOAD.replace(/\\/g, '/') + '"');
  assert.doesNotMatch(env.NODE_OPTIONS, /\\/, 'NODE_OPTIONS reads a backslash inside quotes as an escape');
  assert.equal(env.PATH, WIN_DEV.PATH, 'the rest of the environment is kept');
});

test('#7247: an existing NODE_OPTIONS is kept, the preload is not added twice, and another copy does not count', () => {
  const once = wt.childEnv({ NODE_OPTIONS: '--max-old-space-size=4096' }, 'win32');
  assert.match(once.NODE_OPTIONS, /^--max-old-space-size=4096 --require "/);
  assert.equal(wt.childEnv(once, 'win32').NODE_OPTIONS, once.NODE_OPTIONS);
  const other = wt.childEnv({ NODE_OPTIONS: '--require "C:/elsewhere/no-schtasks-preload.cjs"' }, 'win32');
  assert.ok(other.NODE_OPTIONS.includes(wt.PRELOAD.replace(/\\/g, '/')), 'this checkout\'s own preload is loaded too');
});

test('#7247: CI, an explicit ask for the real scheduler, and every other platform are left as they were', () => {
  for (const [env, platform] of [[{ CI: 'true' }, 'win32'], [{ KOSMOS_TESTS_REAL_SCHTASKS: '1' }, 'win32'], [{}, 'darwin'], [{}, 'linux']]) {
    assert.equal(wt.childEnv(env, platform), env, JSON.stringify([env, platform]));
    assert.equal(wt.guardsScheduler(env, platform), false);
  }
  // CONTROL: the same computer without those asks is guarded
  assert.equal(wt.guardsScheduler({ KOSMOS_TESTS_REAL_SCHTASKS: '0' }, 'win32'), true);
  // CI=false and CI=0, which some shells export, are not CI: the guard stays on
  assert.equal(wt.guardsScheduler({ CI: 'false' }, 'win32'), true);
  assert.equal(wt.guardsScheduler({ CI: '0' }, 'win32'), true);
});

test('#7247: a Windows run says which scheduler it uses, guarded or not; other platforms say nothing', () => {
  assert.match(wt.schedulerLine(WIN_DEV, 'win32'), /refused in every test/);
  assert.match(wt.schedulerLine({ CI: 'true' }, 'win32'), /REAL Task Scheduler \(CI is set/);
  assert.match(wt.schedulerLine({ KOSMOS_TESTS_REAL_SCHTASKS: '1' }, 'win32'), /REAL Task Scheduler \(KOSMOS_TESTS_REAL_SCHTASKS=1/);
  assert.equal(wt.schedulerLine({}, 'darwin'), null);
});

/* ---------- which calls run schtasks ---------- */

test('#7247: a call runs schtasks when schtasks is the program, by any path or case, or a shell starts it', () => {
  for (const [file, args, options] of [
    ['schtasks.exe', ['/Query']], ['schtasks', []], ['SCHTASKS.EXE', []], ['C:\\Windows\\System32\\schtasks.exe', ['/End']],
    ['"C:\\Windows\\System32\\schtasks.exe"', []], ['cmd', ['/c', 'schtasks /End /TN x']], ['cmd.exe', ['/d', '/s', '/c', 'schtasks.exe /Run']],
    ['powershell.exe', ['-NoProfile', '-Command', 'schtasks /Query']], ['schtasks /Query', [], { shell: true }],
  ]) assert.equal(callRuns(file, args, options), true, JSON.stringify([file, args, options]));
  for (const cmd of ['schtasks /Query', 'echo hi && schtasks /End', 'cd x & "C:\\Windows\\System32\\schtasks.exe" /Run', 'cmd /c schtasks /Delete', '(schtasks /Query)'])
    assert.equal(commandRuns(cmd), true, cmd);
});

test('#7247: quoted, switched, launched, nested and encoded shell forms that run schtasks are caught', () => {
  const encoded = Buffer.from('schtasks /End /TN x', 'utf16le').toString('base64');
  for (const cmd of [
    'cmd /c "schtasks /Query"', 'powershell -Command "schtasks /Query"', 'powershell -NoProfile -ExecutionPolicy Bypass -Command schtasks /End',
    'pwsh -ep Bypass -c "schtasks /Run /TN x"', 'powershell schtasks /Query', 'start /b schtasks /Run', 'start "title" /wait /d C:\\x schtasks /End',
    'call schtasks /Query', 'cmd /c cmd /c "schtasks /Delete"', 'powershell -EncodedCommand ' + encoded, 'echo a && cmd /c "schtasks /End"',
  ]) assert.equal(commandRuns(cmd), true, cmd);
  assert.equal(callRuns('cmd.exe', ['/d', '/s', '/c', '"schtasks /End /TN x"']), true);
  assert.equal(callRuns('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', 'schtasks /Query']), true);
});

test('#7247: shells and launchers that run something else are not refused', () => {
  const encoded = Buffer.from('Write-Output schtasks', 'utf16le').toString('base64');
  for (const cmd of [
    'cmd /c "echo schtasks"', 'powershell -Command "Write-Output schtasks"', 'powershell -File C:\\x\\job.ps1', 'start notepad',
    'start "schtasks" notepad', 'powershell -EncodedCommand ' + encoded, 'cmd /c git grep schtasks',
  ]) assert.equal(commandRuns(cmd), false, cmd);
  assert.equal(callRuns('cmd.exe', ['/c', 'echo', 'schtasks']), false);
});

test('#7247: the word schtasks anywhere else is not a call, so it runs as it always did', () => {
  for (const [file, args, options] of [
    ['git', ['grep', 'schtasks']], ['git', ['commit', '-m', 'fix schtasks quoting']], [process.execPath, ['-e', 'console.log("schtasks")']],
    ['schtasks-helper.exe', []], ['C:\\tools\\myschtasks.exe', []], ['cmd', ['/c', 'echo schtasks']], ['findstr', ['schtasks', 'log.txt']],
  ]) assert.equal(callRuns(file, args, options), false, JSON.stringify([file, args]));
  for (const cmd of ['git grep schtasks', 'echo schtasks', 'type schtasks.log', 'node -e "require(\'schtasks\')"'])
    assert.equal(commandRuns(cmd), false, cmd);
});

/* ---------- every arm, in a child that loads the preload as the runner does ---------- */

/* The child builds the name itself: this test may run under the preload too, and a command line that RAN schtasks
   would be refused here; the matcher only refuses calls that run it, so the probe's source naming it is fine. */
const PROBE = `
const cp = require('node:child_process');
const util = require('node:util');
const SCH = 'schtasks.exe';
const out = {};
const code = (e) => e && e.code;
try { cp.execFileSync(SCH, ['/Query']); out.execFileSync = 'ran'; } catch (e) { out.execFileSync = code(e); }
out.spawnSync = code(cp.spawnSync(SCH, ['/Query']).error);
try { cp.execSync('schtasks /Query', { stdio: 'pipe' }); out.execSync = 'ran'; } catch (e) { out.execSync = code(e); }
const other = cp.spawnSync(process.execPath, ['-e', 'process.stdout.write("ran")'], { encoding: 'utf8' });
out.other = other.stdout;
out.undefArgs = code(cp.spawnSync(SCH, undefined, { shell: false }).error);
const done = [];
const child = cp.spawn(SCH, ['/Query']);
out.spawnStdout = !!child.stdout;
done.push(new Promise((r) => child.on('error', (e) => { out.spawn = code(e); r(); })));
done.push(new Promise((r) => cp.execFile(SCH, ['/Query'], (e) => { out.execFile = code(e); r(); })));
done.push(new Promise((r) => cp.exec('schtasks /Query', (e) => { out.exec = code(e); r(); })));
done.push(new Promise((r) => cp.execFile(SCH, ['/Query'], null, (e) => { out.nullOptions = code(e); r(); })));
done.push(new Promise((r) => cp.execFile(SCH, ['/Query'], undefined, (e) => { out.undefOptions = code(e); r(); })));
done.push(new Promise((r) => cp.exec('schtasks /Query', null, (e) => { out.execNullOptions = code(e); r(); })));
done.push(util.promisify(cp.execFile)(SCH, ['/Query']).then(() => { out.pExecFile = 'ran'; }, (e) => { out.pExecFile = code(e); }));
done.push(util.promisify(cp.execFile)(process.execPath, ['-e', 'process.stdout.write("x")']).then((r) => { out.pShape = typeof r === 'object' && r.stdout === 'x' && 'stderr' in r; }));
done.push(util.promisify(cp.exec)('echo shape').then((r) => { out.pExecShape = typeof r === 'object' && /shape/.test(r.stdout); }));
Promise.all(done).then(() => process.stdout.write(JSON.stringify(out)));
`;

/* The probe runs from a file: Windows refuses (EPERM) a node started with this many lines as one -e argument. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-7247-'));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function probe(source, nodeOptions) {
  const file = path.join(DIR, 'probe-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(file, source);
  const e = { ...process.env };
  delete e.NODE_TEST_CONTEXT;   // the child is a plain script, not a test file
  delete e.NODE_OPTIONS;
  if (nodeOptions) e.NODE_OPTIONS = nodeOptions;
  return JSON.parse(cp.execFileSync(process.execPath, [file], { env: e, encoding: 'utf8', timeout: 60000 }));
}

test('#7247: under the preload every arm fails as a missing schtasks.exe would, and everything else runs unchanged', () => {
  const got = probe(PROBE, wt.childEnv(WIN_DEV, 'win32').NODE_OPTIONS);
  for (const arm of ['execFileSync', 'spawnSync', 'execSync', 'spawn', 'execFile', 'exec', 'pExecFile', 'undefArgs', 'nullOptions', 'undefOptions', 'execNullOptions']) {
    assert.equal(got[arm], 'ENOENT', arm + ': ' + JSON.stringify(got));
  }
  assert.equal(got.spawnStdout, true, 'a refused spawn still has its streams, as a missing program\'s child does');
  assert.equal(got.other, 'ran', 'a program that is not schtasks still runs');
  assert.equal(got.pShape, true, 'promisify(execFile) still resolves { stdout, stderr }');
  assert.equal(got.pExecShape, true, 'promisify(exec) still resolves { stdout, stderr }');
});

test('#7247 CONTROL: without the preload, a call to a program that does not exist is what ENOENT looks like, and promisify keeps its shape', () => {
  /* Never runs the real schtasks: the control aims the same arms at a program no computer has, so it shows the
     preload's refusals are Node's own ENOENT and not something it made up. */
  const got = probe(PROBE.replace("const SCH = 'schtasks.exe';", "const SCH = 'no-such-program-7247.exe';").replace(/schtasks \/Query/g, 'no-such-program-7247 /Query'), null);
  for (const arm of ['execFileSync', 'spawnSync', 'spawn', 'execFile', 'pExecFile']) assert.equal(got[arm], 'ENOENT', arm);
  assert.equal(got.pShape, true);
});

/* ---------- tools/run-tests.sh reads the rule from tools/windows-tests.js ---------- */

test('#7247: run-tests.sh\'s own node snippet reads the rule from windows-tests.js: the options line, then the scheduler line', () => {
  /* The snippet is taken from run-tests.sh itself, so renaming childEnv or schedulerLine, or editing the snippet,
     fails here rather than on the next Windows npm test (which #7257 keeps from running today). */
  const sh = fs.readFileSync(path.join(__dirname, 'tools', 'run-tests.sh'), 'utf8');
  const m = sh.match(/_rt_sched="\$\(node -e '([^']+)' "\$_rt_wt"\)"/);
  assert.ok(m, 'run-tests.sh still runs the rule through one node -e snippet');
  const run = (env) => {
    const e = { ...process.env, ...env };
    delete e.NODE_TEST_CONTEXT;
    for (const k of Object.keys(env)) if (env[k] === undefined) delete e[k];
    return cp.execFileSync(process.execPath, ['-e', m[1], path.join(__dirname, 'tools', 'windows-tests.js')], { env: e, encoding: 'utf8' }).split('\n');
  };
  const [opts, line] = run({ CI: undefined, KOSMOS_TESTS_REAL_SCHTASKS: undefined, NODE_OPTIONS: undefined });
  assert.equal(opts, '--require "' + wt.PRELOAD.replace(/\\/g, '/') + '"');
  assert.match(line, /refused in every test/);
  // CONTROL: on CI the options line carries nothing new and the line names the real scheduler
  const [ciOpts, ciLine] = run({ CI: 'true', NODE_OPTIONS: undefined });
  assert.equal(ciOpts, '');
  assert.match(ciLine, /REAL Task Scheduler/);
});
