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
      "  if (w[0] === 'stdin') process.stdout.write('STDIN ' + JSON.stringify(require('" + real + "').pipedInputFrom(a)) + '\\n');",
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

test('win32-cli-verbs: PowerShell pipeline input (`... | kosmos feedback write`) reaches the CLI\'s stdin, non-ASCII intact', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  /* PowerShell 5.1 pipes to a native command in $OutputEncoding, ASCII by default,
     which turns every non-ASCII character into `?`. The characters are built in
     PowerShell from code points so the command line itself carries only ASCII. */
  const root = zipRoot();
  try {
    const r = ps(root, ["('piped ' + [char]0x00E9 + ' ' + [char]0x2713) | kosmos stdin x", '"exit=$LASTEXITCODE"']);
    assert.deepEqual(JSON.parse(r.lines[0]), ['stdin', 'x']);
    const stdin = JSON.parse((/^STDIN (.*)$/.exec(r.lines[1]) || [])[1] || 'null');
    assert.equal(stdin, 'piped é ✓', 'the piped words changed on the way: ' + r.lines.join(' | ') + ' ' + r.stderr.slice(0, 200));
    assert.equal(r.lines[2], 'exit=7');
    const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^kosmos-stdin-/.test(f));
    assert.deepEqual(leftovers, [], 'the piped words were left on disk');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PowerShell: numbers go as the text the agent typed, not PowerShell\'s reading of it', { skip: !ON_WINDOWS && 'Windows only' }, () => {
  const root = zipRoot();
  try {
    const r = ps(root, ['kosmos msg a 007 1kb 2.50 0x10']);
    assert.deepEqual(JSON.parse(r.lines[0]), ['msg', 'a', '007', '1kb', '2.50', '0x10']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
