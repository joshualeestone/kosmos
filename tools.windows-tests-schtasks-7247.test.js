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

/* ---------- review 4 ---------- */

test('#7247: sh, bash and env in front of schtasks are read too; a script file is not', () => {
  for (const [file, args] of [
    ['bash', ['-c', 'schtasks /End /TN x']], ['sh', ['-c', 'echo a; schtasks /Query']], ['bash.exe', ['-lc', '"schtasks /Run"']],
    ['C:\\Program Files\\Git\\usr\\bin\\bash.exe', ['-ec', 'schtasks /Delete']], ['env', ['A=1', 'schtasks', '/Query']],
  ]) assert.equal(callRuns(file, args), true, JSON.stringify([file, args]));
  assert.equal(commandRuns('env FOO=bar schtasks /Query'), true);
  for (const [file, args] of [['bash', ['-c', 'echo schtasks']], ['bash', ['script.sh']], ['sh', ['-c', 'git grep schtasks']], ['env', ['A=1', 'node', 'x.js']]])
    assert.equal(callRuns(file, args), false, JSON.stringify([file, args]));
});

test('#7247: windows-tests.js hands each test file the environment childEnv builds', () => {
  /* Read from the source, as the run-tests.sh snippet is: dropping `env` from the per-file spawn would leave every
     other test here green while no file loaded the preload. */
  const src = fs.readFileSync(path.join(__dirname, 'tools', 'windows-tests.js'), 'utf8');
  assert.match(src, /const env = childEnv\(\);/);
  assert.match(src, /cp\.spawnSync\(process\.execPath, \[[^\]]*\], \{\s*cwd: root, env,/);
});

test('#7247: run-tests.sh reads CI as onCi does where it cannot ask windows-tests.js (no cygpath)', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'tools', 'run-tests.sh'), 'utf8');
  const m = sh.match(/case "\$\{CI:-\}" in ([^)]+)\) _rt_ci="" ;;/);
  assert.ok(m, 'the fallback reads CI with a case');
  const notCi = m[1].split('|').map((s) => s.replace(/"/g, ''));
  for (const v of ['', 'false', 'FALSE', 'False', '0']) {
    assert.ok(notCi.includes(v), JSON.stringify(v) + ' is not CI in run-tests.sh');
    assert.equal(wt.guardsScheduler(v ? { CI: v } : {}, 'win32'), true, JSON.stringify(v) + ' is not CI in windows-tests.js');
  }
});

test('#7247: zsh, dash, ksh and fish are read as sh is, and an option that takes a value does not end the scan', () => {
  for (const [file, args] of [
    ['zsh', ['-c', 'schtasks /Query']], ['dash', ['-c', 'schtasks /End']], ['ksh', ['-c', 'schtasks /Run']], ['fish', ['-c', 'schtasks /Query']],
    ['bash', ['-o', 'pipefail', '-c', 'schtasks /End /TN x']], ['bash', ['+o', 'errexit', '-lc', 'schtasks /Query']],
  ]) assert.equal(callRuns(file, args), true, JSON.stringify([file, args]));
  // CONTROL: the same shells running something else
  assert.equal(callRuns('bash', ['-o', 'pipefail', '-c', 'echo schtasks']), false);
  assert.equal(callRuns('zsh', ['-c', 'git grep schtasks']), false);
});

/* ---------- review 6: run-tests.sh's own Windows block, run in bash ---------- */

/* The block cut out of run-tests.sh as written (from its #7247 comment to the esac that closes it), run by bash with
   uname answering as Git Bash does and cygpath stubbed, so its real paths run on any platform: the export, the
   scheduler line, and the stop when cygpath is missing. npm test cannot run on Windows yet (#7257), so this is where
   that code runs. */
function bashBlock() {
  const sh = fs.readFileSync(path.join(__dirname, 'tools', 'run-tests.sh'), 'utf8');
  const start = sh.indexOf('# #7247: on a Windows computer');
  const end = sh.indexOf('\nesac\n', start);
  assert.ok(start >= 0 && end > start, 'run-tests.sh still carries its #7247 block');
  return sh.slice(start, end + 6);
}
const BASH = (() => { const r = cp.spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() === 'ok'; })();
function runBlock(env, cygpathWorks) {
  const wtPath = path.join(__dirname, 'tools', 'windows-tests.js').replace(/\\/g, '/');
  const script = 'uname() { echo MINGW64_NT-10.0-26100; }\n'
    + (cygpathWorks ? 'cygpath() { printf "%s\\n" "$STUB_WT"; }\n' : 'cygpath() { return 1; }\n')
    + bashBlock() + '\nprintf "%s" "${NODE_OPTIONS:-}"\n';
  const e = { ...process.env, ...env, STUB_WT: wtPath, REPO: __dirname, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '') };
  delete e.NODE_TEST_CONTEXT;
  for (const k of Object.keys(env)) if (env[k] === undefined) delete e[k];
  return cp.spawnSync('bash', ['-c', script], { env: e, encoding: 'utf8', timeout: 60000 });
}

test('#7247: run-tests.sh\'s Windows block exports the guard, or says the scheduler is real, as windows-tests.js decides', { skip: !BASH && 'no bash on this computer' }, () => {
  const guarded = runBlock({ CI: undefined, KOSMOS_TESTS_REAL_SCHTASKS: undefined, NODE_OPTIONS: undefined }, true);
  assert.equal(guarded.status, 0, guarded.stderr);
  assert.equal(guarded.stdout, '--require "' + wt.PRELOAD.replace(/\\/g, '/') + '"');
  assert.match(guarded.stderr, /refused in every test/);
  const onCi = runBlock({ CI: 'true', NODE_OPTIONS: undefined }, true);
  assert.equal(onCi.status, 0, onCi.stderr);
  assert.equal(onCi.stdout, '');
  assert.match(onCi.stderr, /REAL Task Scheduler/);
});

test('#7247: without cygpath the block stops rather than run unguarded, unless CI or the real-scheduler ask says so', { skip: !BASH && 'no bash on this computer' }, () => {
  for (const ci of [undefined, 'false', '0']) {
    const r = runBlock({ CI: ci, KOSMOS_TESTS_REAL_SCHTASKS: undefined, NODE_OPTIONS: undefined }, false);
    assert.equal(r.status, 2, 'CI=' + ci + ': ' + r.stderr);
    assert.match(r.stderr, /cygpath is missing/);
  }
  const asked = runBlock({ CI: undefined, KOSMOS_TESTS_REAL_SCHTASKS: '1', NODE_OPTIONS: undefined }, false);
  assert.equal(asked.status, 0, asked.stderr);
  assert.match(asked.stderr, /REAL Task Scheduler/);
});

test('#7247: env with an option that takes a value is read past it', () => {
  assert.equal(callRuns('env', ['-u', 'X', 'schtasks', '/Query']), true);
  assert.equal(callRuns('env', ['-C', 'C:/x', 'A=1', 'schtasks.exe']), true);
  assert.equal(callRuns('env', ['-u', 'X', 'node', 'x.js']), false);
});

test('#7247: a launcher given by a quoted path with a space is read as that launcher', () => {
  for (const cmd of [
    '"C:\\Program Files\\Git\\bin\\bash.exe" -c "schtasks /Query"', '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command schtasks',
    '"C:\\Program Files\\Git\\usr\\bin\\env.exe" A=1 schtasks /End', 'bash -O extglob -c schtasks', 'bash --rcfile x.rc -c "schtasks /Run"',
  ]) assert.equal(commandRuns(cmd), true, cmd);
  // CONTROL: the same launchers running something else, and -C (noclobber) is not -c
  assert.equal(commandRuns('"C:\\Program Files\\Git\\bin\\bash.exe" -c "echo schtasks"'), false);
  assert.equal(callRuns('bash', ['-C', 'script.sh']), false);
});

test('#7270: a prefix in front of schtasks does not end the scan', () => {
  for (const cmd of [
    'X=1 schtasks /Query', 'A=1 B=2 schtasks.exe /End', '@schtasks /Query', '@C:\\Windows\\System32\\schtasks.exe /Query',
    'if exist x schtasks /Query', 'if not exist C:\\x schtasks /Query', 'if /i not exist x schtasks /Query',
    'if errorlevel 1 schtasks /Query', 'if defined X schtasks /Query', 'if "%A%"=="1" schtasks /Query',
    'if %A% equ 1 schtasks /Query', 'nohup schtasks /Query', 'exec schtasks /Query', 'command schtasks /Query',
    'time schtasks /Query', 'time -p schtasks /Query', 'nice -n 10 schtasks /Query', 'timeout 5 schtasks /Query',
    'timeout -s KILL 5 schtasks /Query', 'schtasks>out.txt', 'schtasks>>out.txt /Query', '>out.txt schtasks /Query',
    '2>err.txt schtasks /Query', 'echo `schtasks /Query`', 'if schtasks /Query; then echo y; fi',
    'while true; do schtasks /Query; done', '! schtasks /Query',
  ]) assert.equal(commandRuns(cmd), true, cmd);
  assert.equal(callRuns('bash', ['-c', 'X=1 schtasks /End /TN Kosmos-board']), true);
  assert.equal(callRuns('cmd', ['/c', '@schtasks /Query']), true);
  // CONTROL: the same prefixes in front of something else, and Windows' timeout, which runs nothing
  for (const cmd of [
    'X=1 node x.js', '@echo schtasks', 'if exist schtasks.log echo found', 'if errorlevel 1 echo schtasks',
    'nohup node x.js', 'time git grep schtasks', 'timeout 5 node x.js', 'timeout /t 5 /nobreak', 'echo hi>schtasks',
    'type <schtasks', 'echo `git grep schtasks`', 'X="schtasks /End" node x.js',
  ]) assert.equal(commandRuns(cmd), false, cmd);
});

test('#7270: without a shell, each launcher argument is read as one word, as node passes it', () => {
  // these never run schtasks: cmd only echoes the one quoted argument
  assert.equal(callRuns('cmd', ['/c', 'echo', 'a & schtasks']), false);
  assert.equal(callRuns('cmd.exe', ['/d', '/s', '/c', 'echo', 'x | schtasks /End']), false);
  // CONTROL: what does run it still reads as running it
  assert.equal(callRuns('cmd', ['/c', 'schtasks /End']), true);
  assert.equal(callRuns('cmd', ['/c', 'echo a & schtasks /End']), true);
  assert.equal(callRuns('bash', ['-c', "cat <<'EOF'\nhello\nEOF\nschtasks /Query"]), true);
  assert.equal(callRuns('bash', ['-c', 'cat <<< schtasks; schtasks /Query']), true);
  assert.equal(callRuns('powershell', ['-Command', 'schtasks /Query']), true);
});

test('#7270: cmd\'s ""path" args" form and env -S are read as they run', () => {
  assert.equal(commandRuns('cmd /c ""C:\\Program Files\\x\\schtasks.exe" /End"'), true);
  assert.equal(commandRuns('cmd /s /c ""C:\\Program Files\\x\\schtasks.exe" /End /TN x"'), true);
  assert.equal(callRuns('cmd', ['/s', '/c', '""C:\\Program Files\\x\\schtasks.exe" /End"']), true);
  assert.equal(commandRuns('env -S "schtasks /End"'), true);
  assert.equal(callRuns('env', ['-S', 'schtasks /End']), true);
  // CONTROL
  assert.equal(commandRuns('cmd /c ""C:\\Program Files\\x\\node.exe" x.js"'), false);
  assert.equal(commandRuns('env -S "node x.js"'), false);
});

test('#7270 review 1: an argument with no space reaches the launcher bare, so what follows & ; | runs and is read', () => {
  for (const [file, args] of [
    ['cmd', ['/c', 'ver&schtasks']], ['cmd.exe', ['/d', '/s', '/c', 'schtasks|more']], ['bash', ['-c', 'true&&schtasks']],
    ['bash', ['-c', 'schtasks;echo']], ['powershell', ['-Command', 'schtasks;echo']], ['cmd', ['/c', 'schtasks>out.txt']],
    ['bash', ['-c', 'schtasks /Query >/dev/null; exec /bin/bash']], ['bash', ['-c', 'echo $((1<<X))\nschtasks /Query']],
  ]) assert.equal(callRuns(file, args), true, JSON.stringify([file, args]));
  // CONTROL: a lookup runs nothing; a quoted launcher path is still read as that launcher
  for (const cmd of ['command -v schtasks', 'command -v schtasks >/dev/null && echo yes', 'command -V schtasks'])
    assert.equal(commandRuns(cmd), false, cmd);
  assert.equal(commandRuns('"C:\\Program Files\\Git\\bin\\bash.exe" -c "echo schtasks"'), false);
  assert.equal(commandRuns('"C:\\Program Files\\Git\\bin\\bash.exe" -c "schtasks /Query"'), true);
  // a backtick is PowerShell's escape and plain text to cmd, so it does not cut their lines
  assert.equal(callRuns('powershell', ['-Command', 'Write-Output "a`nb" `schtasks']), false);
});

test('#7270 review 2: a here-document is read as commands, so no << can hide what comes after it', () => {
  for (const args of [
    ['-c', 'node -e "a<<b"\nschtasks /Query'], ['-c', "echo '<<EOF'\nschtasks /Query"], ['-c', '# see <<EOF in docs\nschtasks /Query'],
    ['-c', 'let x=1<<y\nschtasks /Query'], ['-c', 'bash <<EOF\nschtasks /Query\nEOF'], ['-c', 'sh -s <<EOF\nschtasks /End /TN x\nEOF'],
    ['-c', 'cat <<EOF\n$(schtasks /Query)\nEOF'],
    // refused though only cat reads it: telling a body from commands needs a real shell parser (the accepted side)
    ['-c', "cat <<'EOF'\nschtasks /Query\nEOF"],
  ]) assert.equal(callRuns('bash', args), true, JSON.stringify(args));
  assert.equal(commandRuns('bash -c "echo \'<<EOF\'\nschtasks /Query"'), true);
});

test('#7270 review 2: with windowsVerbatimArguments node passes the arguments as they are, so they are one command line', () => {
  assert.equal(callRuns('cmd', ['/c', 'echo', 'a & schtasks'], { windowsVerbatimArguments: true }), true);
  assert.equal(callRuns('cmd', ['/d', '/s', '/c', '"schtasks /End"'], { windowsVerbatimArguments: true }), true);
  // CONTROL: the same call quoted by node only echoes, and a verbatim call running something else is not refused
  assert.equal(callRuns('cmd', ['/c', 'echo', 'a & schtasks']), false);
  assert.equal(callRuns('cmd', ['/d', '/s', '/c', '"node x.js"'], { windowsVerbatimArguments: true }), false);
});

test('#7270 review 3: each launcher is read as it reads its arguments', () => {
  // PowerShell joins what follows -Command (checked live on 5.1), cmd reads the line node builds
  for (const [file, args] of [
    ['powershell.exe', ['-NoProfile', '-Command', 'Get-Date', '; schtasks /End /TN Kosmos\\board']],
    ['powershell.exe', ['-Command', 'Write-Output', 'a; schtasks /Query']],
    ['cmd.exe', ['/c', 'echo', 'x"&schtasks']], ['cmd.exe', ['/c', 'echo', 'x"y & schtasks /End']],
    ['cmd', ['/s', '/c', '""C:\\Program Files\\x\\schtasks.exe" /End"']],
  ]) assert.equal(callRuns(file, args), true, JSON.stringify([file, args]));
  // CONTROL: one quoted argument still only echoes; PowerShell running something else is not refused
  assert.equal(callRuns('cmd', ['/c', 'echo', 'a & schtasks']), false);
  assert.equal(callRuns('powershell.exe', ['-Command', 'Write-Output', 'schtasks']), false);
});

test('#7270 review 3: a quoted path is read both as a path and as a line, and either one running schtasks is enough', () => {
  for (const cmd of [
    '"D:\\wt - copy\\schtasks.exe" /Query', 'cmd /c "D:\\wt - copy\\schtasks.exe"', '"C:\\a -b\\Git\\bin\\bash.exe" -c "schtasks"',
    '>nul 2>&1 schtasks /Query', '2>&1 schtasks', 'X=1 2>&1 schtasks', 'env --split-string="schtasks /End"', 'env -S"schtasks /End"',
  ]) assert.equal(commandRuns(cmd), true, cmd);
  // CONTROL
  for (const cmd of ['"D:\\wt - copy\\node.exe" x.js', '"C:\\a -b\\Git\\bin\\bash.exe" -c "echo schtasks"', 'node x.js 2>&1',
    'command -p -v schtasks', 'env --split-string="node x.js"'])
    assert.equal(commandRuns(cmd), false, cmd);
});

test('#7270 review 4: cmd drops the first and last quote after /c, which can move an & out of quotes', () => {
  // each one runs its last command under cmd (checked live with echo in place of schtasks)
  for (const args of [
    ['/c', 'echo a b', 'x & schtasks'], ['/c', 'echo x y', 'z', '& schtasks'], ['/d', '/s', '/c', 'echo a b', 'x & schtasks'],
    ['/c', 'C:\\Program Files\\x\\tool.exe', 'arg & schtasks /End'],
  ]) assert.equal(callRuns('cmd', args), true, JSON.stringify(args));
  assert.equal(commandRuns('cmd /c "a b" "x & schtasks" /End'), true);
  // CONTROL: one quoted argument after a plain word still only echoes, and a tool path with a space runs that tool
  assert.equal(callRuns('cmd', ['/c', 'echo', 'a & schtasks']), false);
  assert.equal(callRuns('cmd', ['/c', 'C:\\Program Files\\x\\tool.exe', 'arg']), false);
});

test('#7270 review 5: a redirect stays in the cmd line, a lone backtick does not cut the command, a start title after switches', () => {
  // each one runs schtasks (the first and the start form checked live with echo in its place)
  assert.equal(callRuns('cmd', ['/c', 'echo a b', '>', 'x & schtasks']), true);
  for (const cmd of ['env A=`x schtasks /Query', 'start /wait "" schtasks /Query', 'start /b /wait "" cmd /c schtasks',
    'if [ -f x ]; then schtasks /Query; fi', 'nohup.exe schtasks /Query'])
    assert.equal(commandRuns(cmd), true, cmd);
  assert.equal(callRuns('cmd', ['/c', 'echo a`b & schtasks'], { windowsVerbatimArguments: true }), true);
  // CONTROL: a redirect to a file named for schtasks, a start title naming it, and a lookup in any case run nothing
  for (const cmd of ['echo hi > schtasks.log', 'node x.js 2> "schtasks & co.txt"', 'start "schtasks" node x.js',
    'Command -v schtasks', 'echo a`b'])
    assert.equal(commandRuns(cmd), false, cmd);
  // a backtick in a verbatim PowerShell line is its escape, not a command
  assert.equal(callRuns('powershell', ['-Command', 'Write-Output', '`schtasks'], { windowsVerbatimArguments: true }), false);
});

test('#7270 review 6: loops and groups, long options that take a value, and a redirect among a launcher\'s switches', () => {
  for (const cmd of ['while schtasks /Query; do sleep 1; done', 'until schtasks /Query; do sleep 1; done', '{ schtasks /Query; }',
    'env --chdir x schtasks', 'env --unset X schtasks', 'timeout --kill-after 5 10 schtasks', 'cmd 2>nul /c schtasks',
    'bash 2>/dev/null -c "schtasks /Query"', 'powershell >nul -Command schtasks'])
    assert.equal(commandRuns(cmd), true, cmd);
  // CONTROL: the same forms running something else
  for (const cmd of ['while true; do node x.js; done', '{ echo schtasks; }', 'env --chdir schtasks node x.js',
    'cmd 2>nul /c echo schtasks', 'bash 2>/dev/null -c "echo schtasks"'])
    assert.equal(commandRuns(cmd), false, cmd);
});

test('#7270 review 7: a redirect in the slot of a switch\'s value is skipped, and nice and time take their long values', () => {
  const enc = Buffer.from('schtasks /Query', 'utf16le').toString('base64');
  for (const cmd of ['powershell -ExecutionPolicy >nul Bypass -Command schtasks', 'bash -o >x pipefail -c schtasks',
    'env -u >x A schtasks', 'powershell -EncodedCommand >nul ' + enc, 'nice --adjustment 5 schtasks', 'time -f %e schtasks',
    'time -o t.txt schtasks', 'timeout -k >x 1 5 schtasks'])
    assert.equal(commandRuns(cmd), true, cmd);
  // CONTROL
  for (const cmd of ['powershell -ExecutionPolicy >nul Bypass -Command node x.js', 'nice --adjustment 5 node x.js',
    'time -o schtasks.txt node x.js', 'powershell -EncodedCommand >nul ' + Buffer.from('Write-Output schtasks', 'utf16le').toString('base64')])
    assert.equal(commandRuns(cmd), false, cmd);
});

test('#7299: a redirect among command\'s, nice\'s and timeout\'s switches is the outer shell\'s, not a switch', () => {
  // Each of these read the redirect's file as a switch on main (measured, 10-27): the first two refused a lookup or a
  // call of program "5"; the third let a real schtasks call through (the file -k was taken for timeout's -k, so the
  // duration became "schtasks").
  assert.equal(commandRuns('command >nul -v schtasks'), false);
  assert.equal(commandRuns('nice >-n 5 schtasks'), false);
  assert.equal(commandRuns('timeout >-k 5 schtasks'), true);
  // CONTROL: the same forms without the redirect trick read as before.
  for (const cmd of ['command >nul schtasks /Query', 'nice >x -n 5 schtasks', 'timeout >x -k 1 5 schtasks', 'exec -a name schtasks',
    'time -o t.txt schtasks', 'env -- schtasks /Query'])
    assert.equal(commandRuns(cmd), true, cmd);
  assert.equal(commandRuns('timeout >x 5 node x.js'), false);
});

test('#7299 review: a combined short switch ending in the keyword\'s valued letter takes the next word', () => {
  // Each was let through on main (measured, 10-27): the value was read as the command.
  for (const cmd of ['exec -la name schtasks', 'time -vo t.txt schtasks', 'timeout -vk 5 10 schtasks', 'nice -vn 5 schtasks'])
    assert.equal(commandRuns(cmd), true, cmd);
  // CONTROL: the same switches running something else.
  for (const cmd of ['exec -la name node x.js', 'time -vo schtasks.txt node x.js', 'timeout -vk 5 10 node x.js'])
    assert.equal(commandRuns(cmd), false, cmd);
});
