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
    "process.stdout.write(JSON.stringify(require('" + real + "').argvFrom(process.argv.slice(2), process.env)) + '\\n');\nprocess.exitCode = 7;\n");
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
