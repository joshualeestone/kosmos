'use strict';
/**
 * kosmos#8285: publish-r2.ps1 refused to run when node was not on PATH, though the Kosmos runtime on the same PC carries
 * its own node.exe. Get-NodeExe now falls back to that (the app's runtime\node.exe, then the board runtime's copy) and
 * says so on stderr; PATH's own node, when there is a real one, still wins. "tools.win-" in this name is what puts it in
 * tools/windows-tests.js, so it runs under both PowerShells on the Windows CI job, as tools.win-publish-node-bounded-7951.
 *
 * Get-NodeExe and the list it reads are parsed out of the real script, under the script's own Stop and StrictMode, and
 * run against throwaway PATH and LOCALAPPDATA folders (empty files stand in for node.exe: Get-NodeExe only finds it).
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

const HARNESS = String.raw`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ast = [System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$null, [ref]$null)
$list = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -ceq '$KosmosRuntimeNodes' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($list.Extent.Text.Replace('$KosmosRuntimeNodes', '$global:KosmosRuntimeNodes')))
$d = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'Get-NodeExe' }, $true) | Select-Object -First 1
. ([scriptblock]::Create($d.Extent.Text.Replace('function Get-NodeExe', 'function global:Get-NodeExe')))
$env:PATH = $args[1]
$env:LOCALAPPDATA = $args[2]   # '' removes it, as on pwsh off Windows
if ($args.Count -gt 3 -and $args[3] -ceq 'twice') { [void](Get-NodeExe) }
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

function getNode(ps, where, twice) {
  const h = path.join(SB, 'h' + (n += 1) + '.ps1');
  fs.writeFileSync(h, HARNESS);
  const env = { ...process.env };
  if (ps === 'powershell.exe') for (const k of Object.keys(env)) if (/^psmodulepath$/i.test(k)) delete env[k];
  // The system folders stay on PATH so PowerShell itself starts; neither holds a node.
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', h, SCRIPT, where.bin + ';' + system, where.lad, ...(twice ? ['twice'] : [])], { env, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, ps + ' harness failed: ' + r.stderr);
  return { found: r.stdout.trim(), said: r.stderr };
}

test('#8285: the host has a PowerShell to run the script\'s function in', { skip: NEEDS_WINDOWS }, () => {
  assert.ok(RUNTIMES.includes('powershell.exe'), 'Windows PowerShell 5.1 is the release PC\'s runtime');
});

for (const ps of RUNTIMES) {
  test('#8285 ' + ps + ': no node on PATH -> the app runtime\'s node, said on stderr', () => {
    const w = pc([], [APP]);
    const r = getNode(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.lad, APP));
    assert.match(r.said, /node is not on PATH; using the Kosmos runtime's own:/);
  });
  test('#8285 ' + ps + ': only the board runtime\'s copy -> that one; both -> the app\'s first', () => {
    const only = pc([], [BOARD]);
    const r = getNode(ps, only);
    assert.strictEqual(r.found, 'FOUND ' + path.join(only.lad, BOARD));
    assert.ok(r.said.includes(path.join(only.lad, BOARD)), 'stderr names the copy used: ' + r.said);
    const both = pc([], [APP, BOARD]);
    assert.strictEqual(getNode(ps, both).found, 'FOUND ' + path.join(both.lad, APP));
  });
  test('#8285 ' + ps + ': a real node on PATH still wins, and nothing is said', () => {
    const w = pc(['node.exe'], [APP]);
    const r = getNode(ps, w);
    assert.strictEqual(r.found, 'FOUND ' + path.join(w.bin, 'node.exe'));
    assert.doesNotMatch(r.said, /Kosmos runtime/);
  });
  test('#8285 ' + ps + ': a node.cmd shim on PATH is still not used; the runtime\'s node is', () => {
    const w = pc(['node.cmd'], [APP]);
    assert.strictEqual(getNode(ps, w).found, 'FOUND ' + path.join(w.lad, APP));
  });
  test('#8285 ' + ps + ': the runtime line is said once per run, however often node is looked for', () => {
    const r = getNode(ps, pc([], [APP]), true);
    assert.strictEqual(r.found.startsWith('FOUND '), true);
    assert.strictEqual(r.said.split(/\r?\n/).filter((l) => /using the Kosmos runtime's own/.test(l)).length, 1, r.said);
  });
  test('#8285 ' + ps + ': no LOCALAPPDATA (as pwsh off Windows) -> none, and nothing looked for', () => {
    const w = pc([], [APP]);
    assert.strictEqual(getNode(ps, { bin: w.bin, lad: '' }).found, 'NONE');
  });
  test('#8285 ' + ps + ': neither -> none (the caller refuses, naming where it looked)', () => {
    assert.strictEqual(getNode(ps, pc([], [])).found, 'NONE');
    assert.strictEqual(getNode(ps, pc(['node.cmd'], [])).found, 'NONE', 'CONTROL: a shim alone is still no node');
  });
}

test('#8285: both refusals name where node was looked for', () => {
  const s = fs.readFileSync(SCRIPT, 'utf8');
  const refusals = s.split('\n').filter((l) => /Refuse "node \(an executable, not a \.cmd shim\) is required/.test(l));
  assert.strictEqual(refusals.length, 2, 'the two node refusals');
  for (const l of refusals) assert.match(l, /\$NoNodeWhere/, l.trim());
  assert.match(s, /\$NoNodeWhere = if \(\$env:LOCALAPPDATA\) \{ "none on PATH, and no Kosmos runtime node under %LOCALAPPDATA%/);
  assert.match(s, /\} else \{ 'none on PATH \(and no %LOCALAPPDATA% here/, 'off Windows it does not claim to have looked there');
});
