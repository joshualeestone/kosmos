'use strict';
/**
 * #7951: publish-r2.ps1 runs node with its stdin closed and a time limit. This file exists so those functions run ON
 * WINDOWS, under BOTH runtimes the release PC can use: tools/windows-tests.js selects tools.win-* files. The rest of the
 * script's tests are bash (tools/test-publish-r2-3725.sh) and only run elsewhere.
 *
 *   node --test tools.win-publish-node-bounded-7951.test.js
 *
 * The functions are parsed out of the real script, under the same Stop and StrictMode the script runs with.
 */
// First: a pwsh ended by SIGTERM or SIGKILL leaves .NET diagnostic sockets in temp (measured), which fails the suite's
// leak check, so its temp folder is this process's own.
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

// Runs PowerShell with a stdin nobody closes, which is what a child inheriting it would wait on. Resolves when it exits.
function runHoldingStdin(ps, args, limitMs) {
  return new Promise((resolve) => {
    const child = spawn(ps, args, { env: envFor(ps), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); }, limitMs);
    child.on('exit', (status, signal) => {
      clearTimeout(timer);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      resolve({ status, signal, out, err, finished: signal === null });
    });
  });
}

// Off Windows pwsh keeps a startup profile under this folder, and a damaged shared one makes every start crash (#6352).
const CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-7951-cache-'));
const PS_ENV = { ...process.env, XDG_CACHE_HOME: CACHE };
// 5.1 reads an inherited PSModulePath and finds PowerShell 7's module folders first, which it cannot load.
const envFor = (ps) => {
  const env = { ...PS_ENV };
  if (ps === 'powershell.exe') for (const key of Object.keys(env)) if (/^psmodulepath$/i.test(key)) delete env[key];
  return env;
};
test.after(() => { fs.rmSync(CACHE, { recursive: true, force: true }); });

const SCRIPT = path.join(__dirname, 'tools', 'windows', 'publish-r2.ps1');

const HARNESS = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ast = [System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$null)
foreach ($f in 'ConvertTo-NativeArg', 'Invoke-ChildBounded') {
  $d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $f }, $true) | Select-Object -First 1
  . ([scriptblock]::Create($d.Extent.Text.Replace("function $f", "function global:$f")))
}
$Utf8 = New-Object Text.UTF8Encoding $false
$NodeTimeoutSec = 120
$node = $args[1]
$weird = @('a b', 'q"uote', 'trail\', 'sp ace\', '', 'back\\"slash', 'C:\Program Files\x y\', 'plain')
$res = @{}
function Row($r) { @{ rc = $r.Rc; out = $r.Out; undecided = $r.Undecided } }
if ($args[4] -ceq 'waits') {
  $NodeTimeoutSec = 5
  $res.hang = Row (Invoke-ChildBounded $node @('-e', "console.log('PASS');setInterval(()=>{},1000)"))
  $NodeTimeoutSec = 3
  $res.bigstdin = Row (Invoke-ChildBounded $node @('-e', "setInterval(()=>{},1000)") ('x' * 2000000))
  # #7959: a raw read that never ends is stopped too, and hands back no partial bytes that could be taken for the file.
  $r = Invoke-ChildBounded $node @('-e', "process.stdout.write('part');setInterval(()=>{},1000)") -Raw
  $res.rawhang = @{ rc = $r.Rc; undecided = $r.Undecided; noBytes = ($null -eq $r.Bytes) }
  $NodeTimeoutSec = 120
  # Something node started keeps its output open after node has exited 0: the handle inheritance is Windows's own.
  $res.held = Row (Invoke-ChildBounded $node @('-e', "require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'inherit',detached:true}).unref();console.log('PASS');process.exit(0)"))
} else {
  $res.eof = Row (Invoke-ChildBounded $node @('-e', "process.stdin.on('data',()=>{}).on('end',()=>{console.log('EOF');process.exit(0)})"))
  $r = Invoke-ChildBounded $node (@('-e', 'console.log(Buffer.from(JSON.stringify(process.argv.slice(1))).toString("base64"))') + $weird)
  $res.args = Row $r
  $res.want = $weird
  $res.script = Row (Invoke-ChildBounded $node @('-', 'one', 'two') "console.log('argc '+process.argv.length)")
  $res.utf8 = Row (Invoke-ChildBounded $node @('-') "console.log(process.argv.length, '$([char]0xe9)'.codePointAt(0), '$([char]0xe9)')")
  $res.exit4 = Row (Invoke-ChildBounded $node @('-e', "console.log('one');console.log('two');process.exit(4)"))
  $res.nostart = Row (Invoke-ChildBounded (Join-Path $args[2] 'no-such-node') @())
  # #7959: -Raw keeps every byte: a NUL, CRLF, and bytes that are not UTF-8, as an installer read from git must. Decoded, 0xFF would change.
  $r = Invoke-ChildBounded $node @('-e', "process.stdout.write(Buffer.from([0,255,13,10,128,65,10]))") -Raw
  $res.raw = @{ rc = $r.Rc; out = $r.Out; undecided = $r.Undecided; bytes = @($r.Bytes | ForEach-Object { [int] $_ }) }
  $r = Invoke-ChildBounded $node @('-e', "process.stdout.write(Buffer.from([255]))")
  $res.notraw = @{ out = $r.Out; hasBytes = ($null -ne $r.Bytes) }
  # #7959: -HoldStderr hands back what git says about a commit it cannot read, for the refusal to quote.
  $r = Invoke-ChildBounded $node @('-e', "console.error('fatal: not a tree');process.exit(128)") -HoldStderr
  $res.held128 = @{ rc = $r.Rc; err = $r.Err.Trim(); undecided = $r.Undecided }
  $r = Invoke-ChildBounded $node @('-e', "process.stdout.write('part');process.exit(3)") -Raw
  $res.rawfail = @{ rc = $r.Rc; noBytes = ($null -eq $r.Bytes) }
}
[IO.File]::WriteAllText($args[3], ($res | ConvertTo-Json -Depth 4), $Utf8)
`;

function runtimes() {
  const have = (exe) => spawnSync(exe, ['-NoProfile', '-Command', '1'], { env: envFor(exe), stdio: 'ignore' }).status === 0;
  const list = [];
  if (process.platform === 'win32') list.push('powershell.exe');
  if (have('pwsh')) list.push('pwsh');
  return list;
}

const RUNTIMES = runtimes();

// On CI only: Windows ships without pwsh, so a person's own computer may have just the one.
test('CI has both PowerShells to test with', { skip: process.platform !== 'win32' || !process.env.GITHUB_ACTIONS }, () => {
  assert.deepStrictEqual(RUNTIMES, ['powershell.exe', 'pwsh'], 'this job is the only place these functions run on Windows, so a missing runtime is a failure, not a skip');
});

if (!RUNTIMES.length) test('Invoke-ChildBounded', { skip: 'pwsh is not installed here, so it did not run on this computer' }, () => {});

// A real Ctrl+C reaches a console, not a signal, so this arm is off Windows; the waits it pins are the same code.
test('Ctrl+C is not held off by the limit, and takes node with it', { skip: process.platform === 'win32' || !RUNTIMES.includes('pwsh') }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-7951-'));
  try {
    const harness = path.join(dir, 'int.ps1');
    const pidFile = path.join(dir, 'node.pid');
    fs.writeFileSync(harness, HARNESS.slice(0, HARNESS.indexOf('$res = @{}')) + String.raw`
$NodeTimeoutSec = 40
[void] (Invoke-ChildBounded $node @('-e', "require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", $args[2]))
`);
    const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', harness, SCRIPT, process.execPath, pidFile], { env: PS_ENV, stdio: 'ignore' });
    const gone = new Promise((resolve) => child.on('exit', resolve));
    const until = Date.now() + 20000;
    while (!fs.existsSync(pidFile) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(pidFile), 'node never started');
    await new Promise((r) => setTimeout(r, 300));
    const sent = Date.now();
    child.kill('SIGINT');
    const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
    await gone;
    clearTimeout(timer);
    assert.ok(Date.now() - sent < 15000, `pwsh took ${Date.now() - sent} ms to stop after SIGINT, under a 40 s limit`);
    const nodePid = Number(fs.readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(nodePid, 0), /ESRCH/, 'the node it started is gone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const ps of RUNTIMES) {
  // Two tests, not one: on CI's loaded Mac a pwsh start alone took 17 s, and one harness holding every arm reached the
  // kill below.
  const harnessRun = async (group) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-7951-'));
    try {
      const harness = path.join(dir, 'harness.ps1');
      const out = path.join(dir, 'out.json');
      fs.writeFileSync(harness, '﻿' + HARNESS);
      const args = ['-NoProfile', '-NonInteractive'];
      if (process.platform === 'win32') args.push('-ExecutionPolicy', 'Bypass');
      args.push('-File', harness, SCRIPT, process.execPath, dir, out, group);
      // Under the 60 s tools/windows-tests.js gives one test, so a wedged harness is killed rather than orphaned.
      const limitMs = process.platform === 'win32' ? 55000 : 150000;   // #7998: the 60 s cap is the Windows job's; a loaded Mac needs longer
      const run = await runHoldingStdin(ps, args, limitMs);
      assert.ok(run.finished, `the harness had to be killed after ${limitMs / 1000} s: ${run.err}`);
      assert.ok(fs.existsSync(out), `harness wrote nothing: status ${run.status} ${run.err}`);
      return JSON.parse(fs.readFileSync(out, 'utf8'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };

  test(`Invoke-ChildBounded under ${ps}`, async () => {
    const res = await harnessRun('answers');
    assert.deepStrictEqual(res.eof, { rc: 0, out: 'EOF', undecided: '' }, 'node sees EOF on its stdin');
    assert.deepStrictEqual(JSON.parse(Buffer.from(res.args.out, 'base64').toString()), res.want, 'arguments arrive byte for byte');
    assert.strictEqual(res.script.out, 'argc 4', 'a script given on stdin runs, with its arguments');
    assert.match(res.utf8.out, /233 é$/, 'UTF-8 both ways');
    assert.deepStrictEqual(res.exit4, { rc: 4, out: 'one two', undecided: '' }, 'an exit code comes back');
    assert.strictEqual(res.nostart.rc, 99, 'a node that does not start');
    assert.ok(res.nostart.undecided, 'and it says so');
    assert.deepStrictEqual(res.raw, { rc: 0, out: '', undecided: '', bytes: [0, 255, 13, 10, 128, 65, 10] }, 'raw: every byte, exactly');
    assert.strictEqual(res.notraw.hasBytes, false, 'control: no raw bytes unless asked for');
    assert.notStrictEqual(res.notraw.out, '\xff', 'control: decoded, that byte does not survive, which is why -Raw exists');
    assert.deepStrictEqual(res.held128, { rc: 128, err: 'fatal: not a tree', undecided: '' }, 'held stderr comes back, and a refusal by git is an answer');
    assert.deepStrictEqual(res.rawfail, { rc: 3, noBytes: true }, 'a raw read that failed hands back no bytes either');
  });

  test(`Invoke-ChildBounded stops what does not finish, under ${ps}`, async () => {
    const res = await harnessRun('waits');
    assert.deepStrictEqual(res.hang, { rc: 98, out: 'PASS', undecided: 'it did not finish within 5 seconds and was stopped' }, 'a printed PASS that never exits is stopped');
    assert.strictEqual(res.bigstdin.rc, 98, 'a stdin node never reads cannot outlast the limit');
    assert.strictEqual(res.rawhang.rc, 98, 'a raw read that never ends is stopped');
    assert.ok(res.rawhang.undecided, 'and says so');
    assert.strictEqual(res.rawhang.noBytes, true, 'the bytes it had printed are not handed back as the file');
    assert.strictEqual(res.held.rc, 97, 'exit 0 with its output held open is not a pass');
    assert.ok(res.held.undecided, 'and it says so');
  });

  // Not judged either way: whether the shape the card saw reproduces here. It is printed, because the card's cause was
  // reasoned, and this is the only place the old form runs on Windows with a stdin held open.
  test(`what the old form does with a stdin held open, under ${ps} (reported, not judged)`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-7951-'));
    try {
      const f = path.join(dir, 'old.ps1');
      fs.writeFileSync(f, '& $args[0] -e "console.log(\'PASS\');process.exit(0)"\n"finished rc=$LASTEXITCODE"\n');
      const args = ['-NoProfile', '-NonInteractive'];
      if (process.platform === 'win32') args.push('-ExecutionPolicy', 'Bypass');
      args.push('-File', f, process.execPath);
      const run = await runHoldingStdin(ps, args, 30000);
      console.log(`MEASURED: #7951 ${ps} on ${process.platform}: old form ${run.finished ? 'exited' : 'still running after 30 s'}; printed: ${run.out.trim().replace(/\s+/g, ' ')}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
