'use strict';
/**
 * kosmos#8285: publish-r2.ps1 refused to run when node was not on PATH, though the installed Kosmos app on the same PC
 * carries its own node.exe. Get-NodeExe now falls back to that one (%LOCALAPPDATA%\Programs\Kosmos\runtime\node.exe),
 * but ONLY while Windows reports its Authenticode signature Valid and from node's publisher (the OpenJS Foundation):
 * its folder is the user's to write, so a swapped binary must not decide whether a release passes. PATH's own node,
 * when there is a real one, still wins. "tools.win-" in this name puts it in tools/windows-tests.js, so it runs under
 * both PowerShells on the Windows CI job, as tools.win-publish-node-bounded-7951.
 *
 * Get-NodeExe, its one path, the publisher, the once-flag and the refusal words are parsed out of the real script and run
 * under the script's own Stop and StrictMode, against throwaway PATH and LOCALAPPDATA folders. A signed node is this
 * test's own node.exe (an official, OpenJS-signed build), hard-linked or copied in; an empty file is an unsigned one.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NEEDS_WINDOWS = process.platform !== 'win32' && 'the runtime folders are Windows ones (%LOCALAPPDATA%), and the script is Windows PowerShell';
const SCRIPT = path.join(__dirname, 'tools', 'windows', 'publish-r2.ps1');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-8285-'));
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));

/* $args: script, PATH, LOCALAPPDATA ('NO-LOCALAPPDATA' = none, as pwsh off Windows: 5.1's -File drops an empty
   argument and reads a bare - as a parameter), mode ('once', 'twice' or 'words'). */
const HARNESS = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ast = [System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$null)
function Assignment($left) {
  $a = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq $left }, $true) | Select-Object -First 1
  if (-not $a) { throw "the script has no assignment to $left" }
  $a.Extent.Text
}
$env:PATH = $args[1]
if ($args[2] -ceq 'NO-LOCALAPPDATA') { $env:LOCALAPPDATA = $null } else { $env:LOCALAPPDATA = $args[2] }
. ([scriptblock]::Create((Assignment '$KosmosAppNode')))
. ([scriptblock]::Create((Assignment '$NodePublisher')))
. ([scriptblock]::Create((Assignment '$script:SaidRuntimeNode')))
if ($args[3] -ceq 'words') {
  . ([scriptblock]::Create((Assignment '$NoNodeWhere')))
  [Console]::Out.WriteLine('WORDS ' + $NoNodeWhere)
  exit 0
}
$d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-NodeExe' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($d.Extent.Text))
if ($args[3] -ceq 'twice') { [void](Get-NodeExe) }
$n = Get-NodeExe
if ($n) { [Console]::Out.WriteLine('FOUND ' + $n.Source) } else { [Console]::Out.WriteLine('NONE') }
`;

const RUNTIMES = process.platform === 'win32'
  ? ['powershell.exe', ...(spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? ['pwsh'] : [])]
  : [];

/* Is this test's own node.exe signed by node's publisher? Official builds are; a runner with another build skips the
   arms that need one, saying so, rather than passing them on an unsigned file. */
const OWN_NODE_SIGNED = process.platform === 'win32' && spawnSync('powershell.exe', ['-NoProfile', '-Command',
  "$s = Get-AuthenticodeSignature -LiteralPath $env:K8285_NODE; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ceq 'OpenJS Foundation') { exit 0 } else { exit 1 }"],
{ env: Object.fromEntries([...Object.entries(process.env).filter(([k]) => !/^psmodulepath$/i.test(k)), ['K8285_NODE', process.execPath]]) }).status === 0;
const NEEDS_SIGNED = !OWN_NODE_SIGNED && 'this host\'s node.exe is not an OpenJS-signed build, so there is no signed node to stand in';

/* The signed node: copied ONCE into this run's folder (the runner's node may sit on another volume), then hard-linked
   per fixture, so a run copies about 80 MB once, not per test. The other-publisher file: Windows' own cmd.exe, Valid
   (catalog-signed, which a copy keeps) and signed by "Microsoft Windows", so only the PUBLISHER check can refuse it. */
let signedSrc = null;
function signedSource() {
  if (!signedSrc) { signedSrc = path.join(SB, 'signed-node.exe'); try { fs.linkSync(process.execPath, signedSrc); } catch { fs.copyFileSync(process.execPath, signedSrc); } }
  return signedSrc;
}
const OTHER_PUBLISHER = process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');

let n = 0;
/* A throwaway PC: a PATH folder holding `onPath` (file names), and a LOCALAPPDATA holding `runtimes`, each
   [relative path, 'signed' | 'other' | 'unsigned']: this test's own node.exe, a copy of cmd.exe, or an empty file. */
function pc(onPath, runtimes) {
  const root = path.join(SB, 'pc' + (n += 1));
  const bin = path.join(root, 'bin');
  const lad = path.join(root, 'LocalAppData');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(lad, { recursive: true });
  for (const f of onPath) fs.writeFileSync(path.join(bin, f), '');
  for (const [rel, kind] of runtimes) {
    const at = path.join(lad, rel);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    if (kind === 'signed') fs.linkSync(signedSource(), at);
    else if (kind === 'other') fs.copyFileSync(OTHER_PUBLISHER, at);
    else fs.writeFileSync(at, '');
  }
  return { bin, lad };
}
const APP = path.join('Programs', 'Kosmos', 'runtime', 'node.exe');
const BOARD = path.join('Kosmos', 'runtime', 'node.exe');

function harness(ps, where, mode) {
  const h = path.join(SB, 'h' + (n += 1) + '.ps1');
  fs.writeFileSync(h, HARNESS);
  const env = { ...process.env };
  if (ps === 'powershell.exe') for (const k of Object.keys(env)) if (/^psmodulepath$/i.test(k)) delete env[k];
  // The system folder stays on PATH so PowerShell itself starts; it holds no node.
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', h, SCRIPT, where.bin + ';' + system, where.lad, mode || 'once'], { env, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, ps + ' harness failed: ' + r.stderr);
  return { found: r.stdout.trim(), said: r.stderr };
}

test('#8285: the host has a PowerShell to run the script\'s function in', { skip: NEEDS_WINDOWS }, () => {
  assert.ok(RUNTIMES.includes('powershell.exe'), 'Windows PowerShell 5.1 is the release PC\'s runtime');
});
test('CI has a signed node to stand in for the app\'s', { skip: process.platform !== 'win32' || !process.env.GITHUB_ACTIONS }, () => {
  assert.ok(OWN_NODE_SIGNED, 'the Windows job\'s node is an official build; without a signed one the signed arms would not run there');
});

for (const ps of RUNTIMES) {
  test('#8285 ' + ps + ': no node on PATH -> the app\'s node when it is signed by node\'s publisher, said on stderr', { skip: NEEDS_SIGNED }, () => {
    const w = pc([], [[APP, 'signed']]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.lad, APP));
    assert.ok(r.said.includes('no node on PATH; using the installed Kosmos app\'s own (signed by OpenJS Foundation): ' + path.join(w.lad, APP)), r.said);
    assert.doesNotMatch(r.said, /shim/, 'CONTROL: with no shim on PATH, none is named');
  });
  test('#8285 ' + ps + ': an unsigned file at the app\'s path is NOT run, and the run is told why', () => {
    const w = pc([], [[APP, 'unsigned']]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'NONE');
    assert.match(r.said, /NOT using the Kosmos app's node at .*: its signature is \S+.*, not Valid from OpenJS Foundation/);
  });
  test('#8285 ' + ps + ': a Valid signature from ANOTHER publisher is NOT run (the publisher check, not the status, refuses it)', () => {
    const w = pc([], [[APP, 'other']]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'NONE');
    assert.match(r.said, /its signature is Valid from Microsoft Windows, not Valid from OpenJS Foundation/, r.said);
  });
  test('#8285 ' + ps + ': the board runtime\'s copy is never looked at, signed or not', { skip: NEEDS_SIGNED }, () => {
    assert.strictEqual(harness(ps, pc([], [[BOARD, 'signed']])).found, 'NONE');
  });
  test('#8285 ' + ps + ': a real node on PATH still wins, unchecked and unsaid (the person\'s choice)', () => {
    const w = pc(['node.exe'], [[APP, 'unsigned']]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.bin, 'node.exe'));
    assert.doesNotMatch(r.said, /Kosmos app/);
  });
  test('#8285 ' + ps + ': a node.cmd shim on PATH is still not used, and the line says why', { skip: NEEDS_SIGNED }, () => {
    const w = pc(['node.cmd'], [[APP, 'signed']]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.lad, APP));
    assert.ok(r.said.includes('skipped the shim ' + path.join(w.bin, 'node.cmd')), 'the line names the shim it skipped: ' + r.said);
  });
  test('#8285 ' + ps + ': the line is said once per run, however often node is looked for', () => {
    const r = harness(ps, pc([], [[APP, 'unsigned']]), 'twice');
    assert.strictEqual(r.found, 'NONE');
    assert.strictEqual(r.said.split(/\r?\n/).filter((l) => /Kosmos app's node/.test(l)).length, 1, r.said);
  });
  test('#8285 ' + ps + ': no LOCALAPPDATA (as pwsh off Windows) -> none, and nothing looked for or said', () => {
    const w = pc([], [[APP, 'unsigned']]);
    const r = harness(ps, { bin: w.bin, lad: 'NO-LOCALAPPDATA' });
    assert.strictEqual(r.found, 'NONE');
    assert.doesNotMatch(r.said, /Kosmos app/);
  });
  test('#8285 ' + ps + ': neither -> none; a shim alone is still no node', () => {
    assert.strictEqual(harness(ps, pc([], [])).found, 'NONE');
    assert.strictEqual(harness(ps, pc(['node.cmd'], [])).found, 'NONE');
  });
  test('#8285 ' + ps + ': the refusal words, built from the real assignment, say where it looked, and only there', () => {
    const w = pc([], []);
    assert.strictEqual(harness(ps, w, 'words').found, 'WORDS none on PATH, and no installed Kosmos app\'s node signed by OpenJS Foundation under %LOCALAPPDATA% (' + APP + ')');
    assert.strictEqual(harness(ps, { bin: w.bin, lad: 'NO-LOCALAPPDATA' }, 'words').found, 'WORDS none on PATH (and no %LOCALAPPDATA% here to look for the Kosmos app\'s node in)');
  });
}

test('#8285: both refusals carry the words, assigned at script level above both callers (line order: the script runs top to bottom)', () => {
  const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const refusals = lines.filter((l) => /Refuse "node \(an executable, not a \.cmd shim\) is required/.test(l));
  assert.strictEqual(refusals.length, 2, 'the two node refusals');
  for (const l of refusals) assert.match(l, /: \$NoNodeWhere\. Nothing was written\./, l.trim());
  const set = at(/^\$NoNodeWhere = /);
  assert.ok(set > 0 && at(/Invoke-WinManifest @\(/) > set, 'assigned above the first line that runs a manifest check');
  assert.ok(at(/^\$nodeExe = Get-NodeExe/) > set, 'and above the verification-record check');
});
