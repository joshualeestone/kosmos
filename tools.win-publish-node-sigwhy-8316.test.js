'use strict';
/**
 * kosmos#8316, follow-up to #8285: publish-r2.ps1's Get-NodeExe falls back to the installed Kosmos app's own
 * runtime\node.exe only while its Authenticode signature is Valid and from the OpenJS Foundation.
 *  1. A signature read that THROWS used to be said as "its signature is unreadable", which reads like an unsigned node.
 *     The line now carries the exception's own first line; a command that cannot run at all (CommandNotFoundException,
 *     its module did not load) takes the "no working Get-AuthenticodeSignature" branch, which names the module path.
 *  2. The verdict is kept with node.exe's length and last-write time. A later call returns it without reading again
 *     while both are unchanged, and reads and says again when either changed (an update rewrote the file).
 *
 * Get-NodeExe and its script-level values are parsed out of the real script and run under the script's own Stop and
 * StrictMode, with Get-AuthenticodeSignature replaced by a stub function (a function wins over a cmdlet of the same
 * name, so this also holds on Windows). The stub counts its calls. So this runs wherever there is a PowerShell: pwsh
 * on a Mac or Linux host, and both PowerShells on the Windows job ("tools.win-" in the name puts it in
 * tools/windows-tests.js). With no PowerShell at all, the arms skip and say so.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'tools', 'windows', 'publish-r2.ps1');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8316-'));
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

function has(ps) { return spawnSync(ps, ['-NoProfile', '-Command', 'exit 0']).status === 0; }
const RUNTIMES = process.platform === 'win32'
  ? ['powershell.exe', ...(has('pwsh') ? ['pwsh'] : [])]
  : (has('pwsh') ? ['pwsh'] : []);
const NEEDS_PS = !RUNTIMES.length && 'no PowerShell on this host to run the script\'s function in';

/* $args: script, LOCALAPPDATA, stub mode, calls. Stub modes: throw (a plain read failure), noload (the command cannot
   run: CommandNotFoundException), valid (Valid from OpenJS Foundation), notsigned (a read that returns NotSigned). */
const HARNESS = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ast = [System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$null)
function Assignment($left) {
  $a = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq $left }, $true) | Select-Object -First 1
  if (-not $a) { throw "the script has no assignment to $left" }
  $a.Extent.Text
}
$env:PATH = ''
$env:LOCALAPPDATA = $args[1]
$script:Mode = $args[2]
$script:Reads = 0
# nocmd: Get-Command itself fails for the cmdlet, as Windows PowerShell 5.1 did when started (through cmd) from
# pwsh 7 on the release PC, 11-11. Every other lookup goes to the real Get-Command.
function Get-Command {
  [CmdletBinding()] param([Parameter(Position = 0)] $Name, $CommandType)
  if ($script:Mode -ceq 'nocmd' -and "$Name" -ceq 'Get-AuthenticodeSignature') {
    # A non-terminating error, as the real lookup writes: -ErrorAction decides whether it stops the caller.
    $e = [System.Management.Automation.CommandNotFoundException]::new("The 'Get-AuthenticodeSignature' command was found in the module 'Microsoft.PowerShell.Security', but the module could not be loaded.")
    $PSCmdlet.WriteError([System.Management.Automation.ErrorRecord]::new($e, 'CouldNotAutoloadMatchingModule', 'ObjectNotFound', $Name))
    return
  }
  Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
}
function Get-AuthenticodeSignature {
  [CmdletBinding()] param([string] $LiteralPath)
  $script:Reads += 1
  if ($script:Mode -ceq 'throw') { throw 'The process cannot access the file because it is being used by another process.' }
  if ($script:Mode -ceq 'multiline') { $nl = [string][char]10; throw ($nl + '  ' + $nl + 'first line of the reason' + $nl + 'second line') }
  if ($script:Mode -ceq 'blank') { throw [System.IO.IOException]::new('') }
  if ($script:Mode -ceq 'noload') { throw [System.Management.Automation.CommandNotFoundException]::new('The Get-AuthenticodeSignature command was found in the module Microsoft.PowerShell.Security, but the module could not be loaded.') }
  $cert = [pscustomobject]@{}
  $cert | Add-Member -MemberType ScriptMethod -Name GetNameInfo -Value { 'OpenJS Foundation' }
  if ($script:Mode -ceq 'valid') { return [pscustomobject]@{ Status = 'Valid'; SignerCertificate = $cert } }
  [pscustomobject]@{ Status = 'NotSigned'; SignerCertificate = $null }
}
. ([scriptblock]::Create((Assignment '$KosmosAppNode')))
. ([scriptblock]::Create((Assignment '$NodePublisher')))
. ([scriptblock]::Create((Assignment '$script:SaidRuntimeNode')))
. ([scriptblock]::Create((Assignment '$script:RuntimeNodeVerdict')))
. ([scriptblock]::Create((Assignment '$script:RuntimeNodeStamp')))
$d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-NodeExe' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($d.Extent.Text))
for ($i = 0; $i -lt [int] $args[3]; $i++) {
  if ($args.Count -gt 4 -and $i -eq ([int] $args[3] - 1)) {
    # Before the last call: TOUCHTIME moves only the app node's write time (same length); TOUCHLEN changes only its
    # length (write time put back); anything else is a PATH.
    $f = Join-Path $env:LOCALAPPDATA $KosmosAppNode
    if ($args[4] -ceq 'TOUCHTIME') { (Get-Item -LiteralPath $f).LastWriteTimeUtc = (Get-Item -LiteralPath $f).LastWriteTimeUtc.AddMinutes(5) }
    elseif ($args[4] -ceq 'TOUCHLEN') { $was = (Get-Item -LiteralPath $f).LastWriteTimeUtc; [IO.File]::WriteAllText($f, 'changed'); (Get-Item -LiteralPath $f).LastWriteTimeUtc = $was }
    else { $env:PATH = $args[4] }
  }
  $n = Get-NodeExe
  if ($n) { [Console]::Out.WriteLine('FOUND ' + $n.Source) } else { [Console]::Out.WriteLine('NONE') }
}
[Console]::Out.WriteLine('READS ' + $script:Reads)
`;

let n = 0;
function run(ps, mode, calls, laterPath) {
  const lad = path.join(SB, 'lad' + (n += 1));
  const app = path.join(lad, 'Programs', 'Kosmos', 'runtime', 'node.exe');
  fs.mkdirSync(path.dirname(app), { recursive: true });
  fs.writeFileSync(app, '');
  const h = path.join(SB, 'h' + n + '.ps1');
  fs.writeFileSync(h, HARNESS);
  const env = { ...process.env };
  if (ps === 'powershell.exe') for (const k of Object.keys(env)) if (/^psmodulepath$/i.test(k)) delete env[k];
  const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', h, SCRIPT, lad, mode, String(calls), ...(laterPath ? [laterPath] : [])], { env, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, ps + ' harness failed: ' + r.stderr);
  const out = r.stdout.trim().split(/\r?\n/);
  const lines = r.stderr.split(/\r?\n/).filter((l) => l.startsWith('publish-r2:'));
  return { results: out.filter((l) => /^(FOUND|NONE)/.test(l)), reads: Number((out.find((l) => l.startsWith('READS ')) || '').slice(6)), lines };
}

test('#8316: a PowerShell is here to run the script\'s function in', { skip: process.platform !== 'win32' && NEEDS_PS }, () => {
  assert.ok(RUNTIMES.length, 'no PowerShell found on a Windows host');
});

for (const ps of RUNTIMES) {
  test('#8316 ' + ps + ': a read that throws says why, in the exception\'s own words, and is not used', () => {
    const r = run(ps, 'throw', 1);
    assert.deepStrictEqual(r.results, ['NONE']);
    assert.strictEqual(r.lines.length, 1, 'one line: ' + r.lines.join(' | '));
    assert.match(r.lines[0], /its signature could not be read: The process cannot access the file because it is being used by another process\., so it is not known to be Valid from OpenJS Foundation$/);
    assert.doesNotMatch(r.lines[0], /unreadable/, 'not the old word, which read as an unsigned node');
  });

  test('#8316 ' + ps + ': a command whose module did not load takes the no-working-cmdlet branch, with its reason', () => {
    const r = run(ps, 'noload', 1);
    assert.deepStrictEqual(r.results, ['NONE']);
    assert.strictEqual(r.lines.length, 1);
    assert.match(r.lines[0], /no working Get-AuthenticodeSignature \(on Windows, check its module path\): The Get-AuthenticodeSignature command was found in the module Microsoft\.PowerShell\.Security, but the module could not be loaded\./);
    assert.doesNotMatch(r.lines[0], /could not be read/);
  });

  test('#8316 ' + ps + ': a read that returns NotSigned still says the status, with no reason (control)', () => {
    const r = run(ps, 'notsigned', 1);
    assert.deepStrictEqual(r.results, ['NONE']);
    // Only the text after the path: a temp folder may itself hold a bracket.
    assert.match(r.lines[0], /node\.exe: its signature is NotSigned, not Valid from OpenJS Foundation$/);
    assert.doesNotMatch(r.lines[0], /could not be read/);
  });

  test('#8316 ' + ps + ': three calls read the signature once, say one line, and all return what it said (Valid)', () => {
    const r = run(ps, 'valid', 3);
    assert.strictEqual(r.reads, 1, 'signature reads');
    assert.strictEqual(r.lines.length, 1);
    assert.match(r.lines[0], /using the installed Kosmos app's own \(signed by OpenJS Foundation\)/);
    assert.strictEqual(r.results.length, 3);
    assert.ok(r.results.every((x) => x.startsWith('FOUND ') && x === r.results[0]), r.results.join(' | '));
  });

  test('#8316 ' + ps + ': a node put on PATH after the verdict was kept still wins (PATH is looked at before the kept verdict)', () => {
    const bin = path.join(SB, 'pathbin' + (n += 1));
    fs.mkdirSync(bin, { recursive: true });
    const node = path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
    fs.writeFileSync(node, '');
    fs.chmodSync(node, 0o755);
    const r = run(ps, 'throw', 2, bin);
    assert.strictEqual(r.reads, 1, 'signature reads');
    assert.deepStrictEqual(r.results, ['NONE', 'FOUND ' + node]);
  });

  test('#8316 ' + ps + ': a Get-Command that itself fails for the cmdlet says why, and reads nothing', () => {
    const r = run(ps, 'nocmd', 1);
    assert.deepStrictEqual(r.results, ['NONE']);
    assert.strictEqual(r.reads, 0, 'no signature read');
    assert.match(r.lines[0], /no working Get-AuthenticodeSignature \(on Windows, check its module path\): The 'Get-AuthenticodeSignature' command was found in the module 'Microsoft\.PowerShell\.Security', but the module could not be loaded\.$/);
  });

  test('#8316 ' + ps + ': a multi-line reason is cut to its first non-blank line', () => {
    const r = run(ps, 'multiline', 1);
    assert.match(r.lines[0], /could not be read: first line of the reason, so it is not known/);
    assert.doesNotMatch(r.lines.join('\n'), /second line/);
  });

  test('#8316 ' + ps + ': a blank reason is named by the exception type', () => {
    const r = run(ps, 'blank', 1);
    assert.match(r.lines[0], /could not be read: IOException, so it is not known/);
  });

  for (const [how, what] of [['TOUCHTIME', 'write time alone'], ['TOUCHLEN', 'length alone']]) {
    test('#8316 ' + ps + ': a node file whose ' + what + ' changed after the verdict is read again, and said again', () => {
      const r = run(ps, 'valid', 2, how);
      assert.strictEqual(r.reads, 2, 'signature reads');
      assert.strictEqual(r.lines.length, 2, r.lines.join(' | '));
      assert.strictEqual(r.results.length, 2);
    });
  }

  test('#8316 ' + ps + ': a refusal is kept too: three calls, one read, three NONE', () => {
    const r = run(ps, 'throw', 3);
    assert.strictEqual(r.reads, 1, 'signature reads');
    assert.strictEqual(r.lines.length, 1);
    assert.deepStrictEqual(r.results, ['NONE', 'NONE', 'NONE']);
  });
}
