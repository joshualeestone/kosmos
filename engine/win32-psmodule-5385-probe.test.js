'use strict';
/**
 * kosmos#5385 PROBE (throwaway branch win-probe-5385, never merged). Measures, on the Windows CI runner, whether a
 * Windows PowerShell 5.1 started the way Codex starts it (`powershell.exe -Command`) with the environment childEnv
 * builds from a PowerShell 7 parent (the CI step's shell) can run what an agent runs: kosmos.ps1 (`kosmos --version`)
 * and commands from each module 5.1 autoloads. Each command runs in its own 5.1 process, under three envs:
 *   inherited  childEnv(process.env): the parent's PSModulePath passes through, as it does today;
 *   dropped    the same with PSModulePath removed (5.1 then builds its own default);
 *   fiveone    the same with PSModulePath set to 5.1's own system path only.
 * It prints a PROBE REPORT and passes; the report is the result.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const onWindows = process.platform === 'win32';

test('#5385 probe: Windows PowerShell 5.1 under a PowerShell 7 parent\'s module path', { skip: !onWindows && 'Windows only' }, () => {
  const launcher = require('./win32launch');
  const SYSROOT = process.env.SystemRoot || 'C:\\Windows';
  const POWERSHELL = path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const repo = path.join(__dirname, '..');

  // A zip-shaped folder: bin\ with the real kosmos.ps1 and a stub kosmos-cli.js, runtime\node.exe.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'k5385-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, 'runtime'));
  fs.copyFileSync(path.join(repo, 'tools', 'windows', 'kosmos.ps1'), path.join(bin, 'kosmos.ps1'));
  fs.writeFileSync(path.join(bin, 'kosmos-cli.js'), [
    "const a = process.argv.slice(2);",
    "const i = a.indexOf('--kosmos-argv-file');",
    "const words = i === -1 ? a : JSON.parse(require('fs').readFileSync(a[i + 1], 'utf8'));",
    "console.log('KOSMOS-STUB ' + JSON.stringify(words));",
  ].join('\n'));
  try { fs.linkSync(process.execPath, path.join(root, 'runtime', 'node.exe')); }
  catch { fs.copyFileSync(process.execPath, path.join(root, 'runtime', 'node.exe')); }

  const keyOf = (env, name) => Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  const base = launcher.childEnv(process.env, 't', null, bin, 'codex');
  const without = Object.assign({}, base);
  const pmKey = keyOf(without, 'PSModulePath');
  if (pmKey) delete without[pmKey];
  const fiveone = Object.assign({}, without, { PSModulePath: path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') });
  const envs = { inherited: base, dropped: without, fiveone };

  const commands = {
    version: '$PSVersionTable.PSVersion.ToString()',
    modulepath: '$env:PSModulePath',
    kosmos: 'kosmos --version',
    'policy-list': 'Get-ExecutionPolicy -List | Out-String',
    'policy-set': 'Set-ExecutionPolicy -Scope Process Bypass -Force; "ok"',
    json: 'ConvertTo-Json @{a=1} -Compress',
    hash: '(Get-FileHash -Algorithm SHA256 (Join-Path $env:SystemRoot "win.ini")).Algorithm',
    acl: '(Get-Acl $env:TEMP).Owner -ne $null',
    cert: '(Get-ChildItem Cert:\\CurrentUser | Measure-Object).Count',
    process: '(Get-Process -Id $PID).Id -gt 0',
    archive: '(Get-Command Expand-Archive).Source',
  };

  const lines = ['PROBE REPORT #5385', `parent PSModulePath: ${process.env[keyOf(process.env, 'PSModulePath') || 'PSModulePath'] || '(none)'}`];
  let ran = 0;
  for (const [envName, env] of Object.entries(envs)) {
    for (const [name, cmd] of Object.entries(commands)) {
      const r = spawnSync(POWERSHELL, ['-Command', cmd], { env, encoding: 'utf8', timeout: 60000, cwd: root });
      if (r.status !== null) ran += 1;
      const out = String(r.stdout || '').trim().replace(/\s+/g, ' ').slice(0, 300);
      const err = String(r.stderr || '').trim().replace(/\s+/g, ' ').slice(0, 300);
      lines.push(`${envName.padEnd(9)} ${name.padEnd(12)} rc=${r.status} out=${out}${err ? ' ERR=' + err : ''}`);
    }
  }
  console.log(lines.join('\n'));
  assert.ok(ran > 0, 'no PowerShell process ran at all');
});
