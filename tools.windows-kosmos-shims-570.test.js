'use strict';
/**
 * #570: the Windows agent's `kosmos` shims, run for real by the shells an agent uses.
 *
 * 🛑 THE REGEX TESTS PASSED OVER TWO REAL DEFECTS. The first shim was a .cmd, and
 * through PowerShell cmd's %* kept only the FIRST LINE of a multi-line answer and
 * ran the tail of a message holding `"...&...` as a command -- exit 0 both times
 * (review round 1). Only running the shell shows that. So this puts the shipped
 * shims in a throwaway <zip>\bin beside a stub CLI that prints the arguments it
 * received (through the REAL kosmos-cli.js argvFrom), and calls a bare `kosmos`
 * from PowerShell and from Git Bash.
 *
 * Windows only, and it says so rather than passing: a Mac has neither shell.
 *
 *   node --test tools.windows-kosmos-shims-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const cli = require('./tools/windows/kosmos-cli');

const ON_WINDOWS = process.platform === 'win32';
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

/* A message with every character a shell hop has mangled: a newline, embedded
   quotes, &, %VAR%, a caret and a pipe. */
const HARD = 'She said "go & echo INJECTED" ok, 100%PATH% ^ | done';

function zipRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-shims-570-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'runtime'));
  const node = path.join(root, 'runtime', 'node.exe');
  try { fs.linkSync(process.execPath, node); } catch { fs.copyFileSync(process.execPath, node); }
  fs.copyFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos.ps1'), path.join(root, 'bin', 'kosmos.ps1'));
  /* As the build copies it: any CR stripped. */
  fs.writeFileSync(path.join(root, 'bin', 'kosmos'), fs.readFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos.sh'), 'utf8').replace(/\r/g, ''));
  const real = path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js').replace(/\\/g, '\\\\');
  fs.writeFileSync(path.join(root, 'bin', 'kosmos-cli.js'),
    [
      "const fs = require('fs'); const a = process.argv.slice(2);",
      "const file = a[0] === '--kosmos-argv-file' ? a[1] : null; const existed = file ? fs.existsSync(file) : null;",
      "try {",
      "  const w = require('" + real + "').argvFrom(a);",
      "  process.stdout.write(JSON.stringify(w) + '\\n');",
      "  if (w[0] === 'maybe') { process.stderr.write('stderr line one\\nstderr line two\\n'); process.exitCode = 3; } else { process.exitCode = 7; }",
      "} catch (e) { process.stdout.write('ERR ' + e.message + '\\n'); process.exitCode = 2; }",
      "process.stderr.write('FILE ' + JSON.stringify({ file, existed, after: file ? fs.existsSync(file) : null }) + '\\n');",
    ].join('\n') + '\n');
  return root;
}

test('PowerShell: a bare `kosmos` is kosmos.ps1, and a multi-line, quoted, &-laden answer arrives exactly', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  const root = zipRoot();
  try {
    const bin = path.join(root, 'bin');
    /* The command text is PowerShell; the message is in single quotes plus an
       explicit `n so the newline is PowerShell's own. */
    const script = [
      "$env:Path = '" + bin + ";' + $env:Path",
      "(Get-Command kosmos).Source",
      "kosmos reply ('line one' + \"`n\" + 'line two') '" + HARD.replace(/'/g, "''") + "' 3",
      "\"exit=$LASTEXITCODE\"",
    ].join('; ');
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 60000 });
    const lines = String(r.stdout).split(/\r?\n/).filter(Boolean);
    assert.equal(lines[0], path.join(bin, 'kosmos.ps1'), 'PowerShell did not resolve a bare kosmos to the .ps1 shim: ' + r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(lines[1]), ['reply', 'line one\nline two', HARD, '3'], 'the answer changed on the way: ' + r.stdout);
    assert.equal(lines[2], 'exit=7', 'the CLI\'s exit code did not come back through the shim');
    assert.ok(!/INJECTED" ok/.test(r.stdout.replace(lines[1], '')), 'part of the message ran as a command');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Git Bash: a bare `kosmos` is the sh shim, and the same answer arrives exactly, /c/ paths untouched', { skip: (!ON_WINDOWS || !fs.existsSync(GIT_BASH)) && 'Windows with Git Bash only' }, () => {
  const root = zipRoot();
  try {
    const posixBin = '/' + root.replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase()).replace(/\\/g, '/') + '/bin';
    const sh = path.join(root, 't.sh');
    fs.writeFileSync(sh, [
      'export PATH="' + posixBin + ':$PATH"',
      'command -v kosmos',
      "kosmos reply \"$(printf 'line one\\nline two')\" '" + HARD.replace(/'/g, "'\\''") + "' /c/some/path",
      'echo "exit=$?"',
    ].join('\n') + '\n');
    const r = cp.spawnSync(GIT_BASH, ['-l', sh], { encoding: 'utf8', timeout: 60000 });
    const lines = String(r.stdout).split(/\r?\n/).filter(Boolean);
    assert.equal(lines[0], posixBin + '/kosmos', 'Git Bash did not resolve a bare kosmos to the sh shim: ' + r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(lines[1]), ['reply', 'line one\nline two', HARD, '/c/some/path'], 'the answer changed on the way: ' + r.stdout);
    assert.equal(lines[2], 'exit=7');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function ps(root, lines) {
  const bin = path.join(root, 'bin');
  const script = ["$env:Path = '" + bin + ";' + $env:Path"].concat(lines).join('; ');
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 60000, maxBuffer: 1e7 });
  return { lines: String(r.stdout).split(/\r?\n/).filter(Boolean), stderr: String(r.stderr) };
}

test('PowerShell: a 40,000-character message (past one environment variable\'s limit) arrives intact', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  const root = zipRoot();
  try {
    const r = ps(root, ["kosmos post p1 ('x' * 40000)", "\"exit=$LASTEXITCODE\""]);
    const got = JSON.parse(r.lines[0]);
    assert.equal(got[2].length, 40000, 'a long room post was cut or lost: ' + r.stderr.slice(0, 300));
    assert.equal(r.lines[1], 'exit=7');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PowerShell: with no node.exe the shim says so and exits 1, never 0', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  const root = zipRoot();
  try {
    fs.rmSync(path.join(root, 'runtime', 'node.exe'));
    const r = ps(root, ['kosmos reply hello', '"exit=$LASTEXITCODE"']);
    assert.equal(r.lines[r.lines.length - 1], 'exit=1', 'a message nobody sent was reported as sent: ' + r.lines.join(' | '));
    assert.match(r.stderr + r.lines.join(' '), /kosmos could not run/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PowerShell: an unquoted table is refused (exit 2), not sent as "[object Object]"', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  const root = zipRoot();
  try {
    const r = ps(root, ['kosmos msg foo @{a=1}', '"exit=$LASTEXITCODE"']);
    assert.match(r.lines[0], /^ERR .*list or table/);
    assert.equal(r.lines[1], 'exit=2');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the argument file exists when the CLI reads it and is gone right after', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  const root = zipRoot();
  try {
    const r = ps(root, ['kosmos reply hello']);
    const info = JSON.parse((/FILE (\{.*\})/.exec(r.stderr) || [])[1] || 'null');
    assert.ok(info && info.file, 'the shim passed no argument file: ' + r.stderr.slice(0, 200));
    assert.equal(info.existed, true, 'the file was not there to read');
    assert.equal(info.after, false, 'the CLI left the file with the agent\'s words on disk');
    assert.equal(fs.existsSync(info.file), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PowerShell: the CLI\'s "maybe" (exit 3, on stderr) comes back as 3, redirected or not', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  /* Review round 3: with Stop in force, `2>&1` turned the first stderr line into
     a terminating error, and a 3 came back as 1, inviting the duplicate retry. */
  const root = zipRoot();
  try {
    for (const call of ['kosmos maybe x', '$o = kosmos maybe x 2>&1', 'kosmos maybe x 2>$null', '$o = kosmos maybe x *>&1 | Out-String']) {
      const r = ps(root, [call, '"exit=$LASTEXITCODE"']);
      assert.equal(r.lines[r.lines.length - 1], 'exit=3', call + ' lost the exit code: ' + r.lines.join(' | ') + ' ' + r.stderr.slice(0, 200));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ── win32-cli-verbs, review round 1: kosmos never hangs on an open stdin ───────
//
// 🛑 An agent's tool runner can give `kosmos` a stdin pipe it never writes to and
// never closes. The round-1 shim read PowerShell's $input, and under `powershell
// -File` that alone waited for stdin to close: EVERY verb hung, `reply` included.
// Each real way an agent runs `kosmos` is run here with exactly that stdin, through
// the shipped shims and the REAL kosmos-cli.js, and must exit on its own.

/* A throwaway zip with the real CLI, and `app` a junction to this checkout so the
   engine resolves the way it does in the bundle. */
function zipRootWithRealCli() {
  const root = zipRoot();
  fs.copyFileSync(path.join(__dirname, 'tools', 'windows', 'kosmos-cli.js'), path.join(root, 'bin', 'kosmos-cli.js'));
  fs.symlinkSync(__dirname, path.join(root, 'app'), 'junction');
  return root;
}
function removeZip(root) {
  try { fs.unlinkSync(path.join(root, 'app')); } catch { /* no junction */ }
  fs.rmSync(root, { recursive: true, force: true });
}

/* Well past the CLI's own quiet limit on stdin plus PowerShell's start-up, and far
   short of "hung". */
const MUST_EXIT_WITHIN_MS = cli.STDIN_QUIET_LIMIT_MS + 12000;
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const USR_BASH = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';

/* Run with stdin an OPEN pipe that is never written and never closed. Resolves
   { exited, code, ms, out }; a run past the limit is killed and reads exited:false. */
function withOpenStdin(file, args, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const started = Date.now();
    const env = Object.assign({}, process.env, o.env || {});
    for (const k of ['KOSMOS_AGENT_TOKEN', 'KOSMOS_WORLD', 'NODE_OPTIONS']) delete env[k];
    if (o.bin) { const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'Path'; env[key] = o.bin + ';' + env[key]; }
    const child = cp.spawn(file, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: Boolean(o.verbatim) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let killed = false;
    const timer = setTimeout(() => { killed = true; try { cp.execFileSync(path.join(SYSTEM32, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } }, MUST_EXIT_WITHIN_MS);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ exited: !killed, code, ms: Date.now() - started, out: out.trim() }); });
  });
}

/* Claude Code's PowerShell tool, as measured on Windows: cmd /d /s /c "chcp 65001 &
   powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <launcher>",
   where the launcher Invoke-Expressions the command. */
function claudeCodePowerShell(bin, command, env) {
  const inner = '"' + path.join(SYSTEM32, 'chcp.com') + '" 65001 >nul & "' + POWERSHELL + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$s = $env:KOSMOS_TEST_SCRIPT; Invoke-Expression -Command $s"';
  return withOpenStdin('cmd.exe', ['/d', '/s', '/c', '"' + inner + '"'], { bin, verbatim: true, env: Object.assign({ KOSMOS_TEST_SCRIPT: command + '; exit $LASTEXITCODE' }, env || {}) });
}

const HELP_FIRST_LINE = /^Usage: kosmos reply /;

test('no hang: Claude Code\'s PowerShell tool, `kosmos reply --help`, stdin an open pipe', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  const root = zipRootWithRealCli();
  try {
    const r = await claudeCodePowerShell(path.join(root, 'bin'), 'kosmos reply --help');
    assert.equal(r.exited, true, 'kosmos hung under Claude Code\'s PowerShell tool: ' + r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, HELP_FIRST_LINE);
  } finally { removeZip(root); }
});

test('no hang: powershell -File kosmos.ps1 (every verb), stdin an open pipe', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  const root = zipRootWithRealCli();
  try {
    const ps1 = path.join(root, 'bin', 'kosmos.ps1');
    const r = await withOpenStdin(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, 'reply', '--help']);
    assert.equal(r.exited, true, 'powershell -File kosmos.ps1 hung on an open stdin (the round-1 $input defect): ' + r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, HELP_FIRST_LINE);
  } finally { removeZip(root); }
});

test('no hang: powershell -Command (how Codex runs a command), stdin an open pipe', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  const root = zipRootWithRealCli();
  try {
    const r = await withOpenStdin(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'kosmos reply --help; exit $LASTEXITCODE'], { bin: path.join(root, 'bin') });
    assert.equal(r.exited, true, r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, HELP_FIRST_LINE);
  } finally { removeZip(root); }
});

test('no hang: Claude Code\'s Bash tool (Git Bash `bash -c`), stdin an open pipe', { skip: (!ON_WINDOWS || !fs.existsSync(USR_BASH)) && 'Windows with Git Bash only' }, async () => {
  const root = zipRootWithRealCli();
  try {
    const posixBin = '/' + path.join(root, 'bin').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase()).replace(/\\/g, '/');
    const r = await withOpenStdin(USR_BASH, ['-c', 'export PATH="' + posixBin + ':/usr/bin:$PATH"; kosmos reply --help']);
    assert.equal(r.exited, true, r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, HELP_FIRST_LINE);
  } finally { removeZip(root); }
});

test('no hang: `kosmos feedback write` with no text (the one verb that reads stdin) exits 2 with the sentence, by -File and by Git Bash, stdin an open pipe', { skip: !ON_WINDOWS && 'Windows only' }, async () => {
  const root = zipRootWithRealCli();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-shims-data-'));
  try {
    const runs = [await withOpenStdin(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'bin', 'kosmos.ps1'), 'feedback', 'write'], { env: { AGENT_WORKFORCE_DATA: data } })];
    if (fs.existsSync(USR_BASH)) {
      const posixBin = '/' + path.join(root, 'bin').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase()).replace(/\\/g, '/');
      runs.push(await withOpenStdin(USR_BASH, ['-c', 'export PATH="' + posixBin + ':/usr/bin:$PATH"; kosmos feedback write'], { env: { AGENT_WORKFORCE_DATA: data } }));
    }
    for (const r of runs) {
      assert.equal(r.exited, true, 'feedback write hung on an open stdin: ' + r.out);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /^Nothing to write/);
      assert.match(r.out, /in PowerShell, pass the text as an argument/);
    }
  } finally { removeZip(root); fs.rmSync(data, { recursive: true, force: true }); }
});

test('Git Bash: a report piped into `kosmos feedback write` is saved with its non-ASCII characters intact', { skip: (!ON_WINDOWS || !fs.existsSync(USR_BASH)) && 'Windows with Git Bash only' }, async () => {
  const root = zipRootWithRealCli();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-kosmos-shims-data-'));
  try {
    const posixBin = '/' + path.join(root, 'bin').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase()).replace(/\\/g, '/');
    const r = await withOpenStdin(USR_BASH, ['-c', 'export PATH="' + posixBin + ':/usr/bin:$PATH"; printf \'caf\\303\\251 piped\\n\' | kosmos feedback write && kosmos feedback show'], { env: { AGENT_WORKFORCE_DATA: data } });
    assert.equal(r.exited, true, r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Saved today's product-feedback report/);
    assert.match(r.out, /caf\u00e9 piped/, 'the piped report changed on the way: ' + r.out);
  } finally { removeZip(root); fs.rmSync(data, { recursive: true, force: true }); }
});

test('PowerShell: numbers go as the text the agent typed, not PowerShell\'s reading of it', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  const root = zipRoot();
  try {
    const r = ps(root, ['kosmos msg a 007 1kb 2.50 0x10']);
    assert.deepEqual(JSON.parse(r.lines[0]), ['msg', 'a', '007', '1kb', '2.50', '0x10']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
