'use strict';
/**
 * kosmos#8285: publish-r2.ps1 refused to run when node was not on PATH, though the installed Kosmos app on the same PC
 * carries its own node.exe. Get-NodeExe now falls back to that one (%LOCALAPPDATA%\Programs\Kosmos\runtime\node.exe,
 * put there by the app's installer) and says so on stderr, once per run; PATH's own node, when there is a real one,
 * still wins. The board runtime's copy is deliberately NOT used (the running Kosmos and its agents can write it).
 * "tools.win-" in this name is what puts it in tools/windows-tests.js, so it runs under both PowerShells on the
 * Windows CI job, as tools.win-publish-node-bounded-7951.
 *
 * Get-NodeExe, the list it reads, the once-flag and the refusal words are parsed out of the real script and run under
 * the script's own Stop and StrictMode, against throwaway PATH and LOCALAPPDATA folders (empty files stand in for
 * node.exe: Get-NodeExe only finds it; a file that is not a working node fails safe at the check, as #7951 tests).
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

/* $args: script, PATH, LOCALAPPDATA ('NO-LOCALAPPDATA' = none, as pwsh off Windows: 5.1's -File drops an empty argument and reads a bare - as a parameter),
   mode ('once', 'twice' or 'words'). */
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
. ([scriptblock]::Create((Assignment '$KosmosRuntimeNodes')))
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

let n = 0;
/* A throwaway PC: a PATH folder holding `onPath` (file names), and a LOCALAPPDATA holding the runtime nodes named. */
function pc(onPath, runtimes) {
  const root = path.join(SB, 'pc' + (n += 1));
  const bin = path.join(root, 'bin');
  const lad = path.join(root, 'LocalAppData');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(lad, { recursive: true });
  for (const f of onPath) fs.writeFileSync(path.join(bin, f), '');
  for (const rel of runtimes) { fs.mkdirSync(path.dirname(path.join(lad, rel)), { recursive: true }); fs.writeFileSync(path.join(lad, rel), ''); }
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

for (const ps of RUNTIMES) {
  test('#8285 ' + ps + ': no node on PATH -> the installed app\'s node, said on stderr', () => {
    const w = pc([], [APP]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.lad, APP));
    assert.ok(r.said.includes('using the installed Kosmos app\'s own: ' + path.join(w.lad, APP)), r.said);
  });
  test('#8285 ' + ps + ': the board runtime\'s copy is never used, alone or beside the app\'s', () => {
    assert.strictEqual(harness(ps, pc([], [BOARD])).found, 'NONE', 'the copy the running Kosmos and its agents can write');
    const both = pc([], [APP, BOARD]);
    assert.strictEqual(harness(ps, both).found, 'FOUND ' + path.join(both.lad, APP));
  });
  test('#8285 ' + ps + ': a real node on PATH still wins, and nothing is said', () => {
    const w = pc(['node.exe'], [APP]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.bin, 'node.exe'));
    assert.doesNotMatch(r.said, /Kosmos app/);
  });
  test('#8285 ' + ps + ': a node.cmd shim on PATH is still not used; the app\'s node is, and the line says why', () => {
    const w = pc(['node.cmd'], [APP]);
    const r = harness(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.lad, APP));
    assert.match(r.said, /a \.cmd shim does not count/);
  });
  test('#8285 ' + ps + ': the line is said once per run, however often node is looked for', () => {
    const r = harness(ps, pc([], [APP]), 'twice');
    assert.ok(r.found.startsWith('FOUND '), r.found);
    assert.strictEqual(r.said.split(/\r?\n/).filter((l) => /using the installed Kosmos app's own/.test(l)).length, 1, r.said);
  });
  test('#8285 ' + ps + ': no LOCALAPPDATA (as pwsh off Windows) -> none, and nothing looked for', () => {
    const w = pc([], [APP]);
    assert.strictEqual(harness(ps, { bin: w.bin, lad: 'NO-LOCALAPPDATA' }).found, 'NONE');
  });
  test('#8285 ' + ps + ': neither -> none; a shim alone is still no node', () => {
    assert.strictEqual(harness(ps, pc([], [])).found, 'NONE');
    assert.strictEqual(harness(ps, pc(['node.cmd'], [])).found, 'NONE');
  });
  test('#8285 ' + ps + ': the refusal words, built from the real assignment, say where it looked, and only there', () => {
    const w = pc([], []);
    const here = harness(ps, w, 'words').found;
    assert.strictEqual(here, 'WORDS none on PATH, and no installed Kosmos app\'s node under %LOCALAPPDATA% (' + APP + ')');
    const off = harness(ps, { bin: w.bin, lad: 'NO-LOCALAPPDATA' }, 'words').found;
    assert.strictEqual(off, 'WORDS none on PATH (and no %LOCALAPPDATA% here to look for the Kosmos app\'s node in)');
  });
}

test('#8285: both refusals carry the words, and the words are set before either can run', () => {
  const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));
  const refusals = lines.map((l, i) => [l, i]).filter(([l]) => /Refuse "node \(an executable, not a \.cmd shim\) is required/.test(l));
  assert.strictEqual(refusals.length, 2, 'the two node refusals');
  for (const [l] of refusals) assert.match(l, /: \$NoNodeWhere\. Nothing was written\./, l.trim());
  const set = at(/^\$NoNodeWhere = /);
  const firstCall = at(/^\s*\S.*Invoke-WinManifest @\(/);   // the first top-level run of a check
  assert.ok(set > 0 && firstCall > set, 'the words are assigned at script level before the first check runs');
  assert.ok(at(/^\$nodeExe = Get-NodeExe/) > set, 'and before the verification-record check');
});
