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
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'tools', 'windows', 'publish-r2.ps1');

const HARNESS = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ast = [System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$null)
foreach ($f in 'Get-NodeTimeoutSec', 'ConvertTo-NativeArg', 'Invoke-NodeBounded') {
  $d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $f }, $true) | Select-Object -First 1
  . ([scriptblock]::Create($d.Extent.Text.Replace("function $f", "function global:$f")))
}
$Utf8 = New-Object Text.UTF8Encoding $false
$FakeDir = 'test'
$env:KOSMOS_PUBLISH_R2_NODE_TIMEOUT_SEC = '6'
$node = $args[1]
$weird = @('a b', 'q"uote', 'trail\', 'sp ace\', '', 'back\\"slash', 'C:\Program Files\x y\', 'plain')
$res = @{}
function Row($r) { @{ rc = $r.Rc; out = $r.Out; undecided = $r.Undecided } }
$res.eof = Row (Invoke-NodeBounded $node @('-e', "process.stdin.on('data',()=>{}).on('end',()=>{console.log('EOF');process.exit(0)})"))
$r = Invoke-NodeBounded $node (@('-e', 'console.log(Buffer.from(JSON.stringify(process.argv.slice(1))).toString("base64"))') + $weird)
$res.args = Row $r
$res.want = $weird
$res.script = Row (Invoke-NodeBounded $node @('-', 'one', 'two') "console.log('argc '+process.argv.length)")
$res.utf8 = Row (Invoke-NodeBounded $node @('-') "console.log(process.argv.length, '$([char]0xe9)'.codePointAt(0), '$([char]0xe9)')")
$res.exit4 = Row (Invoke-NodeBounded $node @('-e', "console.log('one');console.log('two');process.exit(4)"))
$res.hang = Row (Invoke-NodeBounded $node @('-e', "console.log('PASS');setInterval(()=>{},1000)"))
$res.bigstdin = Row (Invoke-NodeBounded $node @('-e', "setInterval(()=>{},1000)") ('x' * 2000000))
$res.nostart = Row (Invoke-NodeBounded (Join-Path $args[2] 'no-such-node') @())
# The form publish-r2.ps1 starts git with, and the form it used to start node with.
$res.emptypipe = @(@() | & $node -e "process.stdin.on('data',()=>{}).on('end',()=>{console.log('EOF');process.exit(0)})") -join ' '
$FakeDir = $null
$res.limit = Get-NodeTimeoutSec
[IO.File]::WriteAllText($args[3], ($res | ConvertTo-Json -Depth 4), $Utf8)
`;

function runtimes() {
  const have = (exe) => spawnSync(exe, ['-NoProfile', '-Command', '1'], { stdio: 'ignore' }).status === 0;
  const list = [];
  if (process.platform === 'win32') list.push('powershell.exe');
  if (have('pwsh')) list.push('pwsh');
  return list;
}

const RUNTIMES = runtimes();

test('there is a PowerShell to test with on Windows, under both names', { skip: process.platform !== 'win32' }, () => {
  assert.deepStrictEqual(RUNTIMES, ['powershell.exe', 'pwsh']);
});

for (const ps of RUNTIMES) {
  test(`Invoke-NodeBounded under ${ps}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-7951-'));
    try {
      const harness = path.join(dir, 'harness.ps1');
      const out = path.join(dir, 'out.json');
      fs.writeFileSync(harness, '\ufeff' + HARNESS);
      const args = ['-NoProfile', '-NonInteractive'];
      if (process.platform === 'win32') args.push('-ExecutionPolicy', 'Bypass');
      args.push('-File', harness, SCRIPT, process.execPath, dir, out);
      const run = spawnSync(ps, args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
      assert.ok(fs.existsSync(out), `harness wrote nothing: status ${run.status} ${run.stderr}`);
      const res = JSON.parse(fs.readFileSync(out, 'utf8'));

      assert.deepStrictEqual(res.eof, { rc: 0, out: 'EOF', undecided: '' }, 'node sees EOF on its stdin');
      assert.deepStrictEqual(JSON.parse(Buffer.from(res.args.out, 'base64').toString()), res.want, 'arguments arrive byte for byte');
      assert.strictEqual(res.script.out, 'argc 4', 'a script given on stdin runs, with its arguments');
      assert.match(res.utf8.out, /233 \u00e9$/, 'UTF-8 both ways');
      assert.deepStrictEqual(res.exit4, { rc: 4, out: 'one two', undecided: '' }, 'an exit code comes back');
      assert.deepStrictEqual(res.hang, { rc: 98, out: 'PASS', undecided: 'it did not finish within 6 seconds and was stopped' }, 'a printed PASS that never exits is stopped');
      assert.strictEqual(res.bigstdin.rc, 98, 'a stdin node never reads cannot outlast the limit');
      assert.strictEqual(res.nostart.rc, 99, 'a node that does not start');
      assert.ok(res.nostart.undecided, 'and it says so');
      assert.strictEqual(res.emptypipe, 'EOF', 'the form git is started with closes stdin');
      assert.strictEqual(res.limit, 300, 'the time limit seam does nothing without the test transport');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
      const child = spawn(ps, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (d) => { text += d; });
      const finished = await new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill(); resolve(false); }, 30000);
        child.on('exit', () => { clearTimeout(timer); resolve(true); });
      });
      child.stdin.destroy();
      console.log(`#7951 measurement ${ps} on ${process.platform}: old form ${finished ? 'exited' : 'still running after 30 s'}; printed: ${text.trim().replace(/\s+/g, ' ')}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
