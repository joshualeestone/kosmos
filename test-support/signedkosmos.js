'use strict';
/**
 * #1765: what Windows answers (engine/win32update.js authenticodeOf) for a published Kosmos.exe,
 * read on a Windows 11 box on 2026-10-17 off the committed, signed tools/windows/Kosmos.exe. The
 * suites whose staged Kosmos.exe is a stub hand this to prepare() in its place; the real check runs
 * in engine/win32update.signature-1765.test.js. Frozen, so a test that edits it fails loudly.
 */
const SIGNED_KOSMOS = Object.freeze({
  status: 'Valid',
  signer: 'Kosmos Agent Manager, Inc.',
  /* #6466: the leaf's whole subject, its EKUs and whether the chain built, read on the same box on 2026-10-19. */
  subject: 'CN="Kosmos Agent Manager, Inc.", O="Kosmos Agent Manager, Inc.", L=Mckinney, S=Texas, C=US',
  ekus: Object.freeze(['1.3.6.1.4.1.311.97.1.0', '1.3.6.1.5.5.7.3.3', '1.3.6.1.4.1.311.97.226463870.202526173.709419293.751579568']),
  chainBuilt: true,
  rootThumbprint: 'F40042E2E5F7E8EF8189FED15519AECE42C3BFA2',
  chain: Object.freeze([
    'CN="Kosmos Agent Manager, Inc.", O="Kosmos Agent Manager, Inc.", L=Mckinney, S=Texas, C=US',
    'CN=Microsoft ID Verified CS AOC CA 03, O=Microsoft Corporation, C=US',
    'CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US',
    'CN=Microsoft Identity Verification Root Certificate Authority 2020, O=Microsoft Corporation, C=US',
  ]),
});

/**
 * Run a script in Windows PowerShell 5.1 the way engine/win32update.js authenticodeOf does: by its full
 * path, with no inherited PSModulePath (a PowerShell 7 or CI module path leaves 5.1 without its own
 * modules, and so without the Cert: drive), and Microsoft.PowerShell.Security imported by its full path.
 * Returns stdout; throws as execFileSync does.
 */
function windowsPowerShell(script, extraEnv, timeoutMs) {
  const cp = require('node:child_process');
  const ps = require('node:path').win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const env = { ...process.env, ...(extraEnv || {}) };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  const prelude = "$ErrorActionPreference = 'Stop'; Import-Module -Name (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1')";
  return cp.execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', prelude + '\n' + script],
    { encoding: 'utf8', windowsHide: true, timeout: timeoutMs || 60000, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Why a test that needs Windows to call the signed Kosmos.exe Valid cannot run here, or false when it can.
 * Valid needs Microsoft's Identity Verification root (2020) in this computer's root store, as setup.ps1's
 * check does; every supported Windows has it, and a box that does not is said, not failed. Asked once.
 */
let rootSkip;
function microsoftRootSkip() {
  if (rootSkip !== undefined) return rootSkip;
  if (process.platform !== 'win32') { rootSkip = 'asks Windows itself (Get-AuthenticodeSignature)'; return rootSkip; }
  let there = false;
  try {
    /* Test-Path answers False for a drive that is not there, so the drive is asked about first: a
       missing Cert: drive is "could not ask", never "not installed". */
    const out = windowsPowerShell("[void] (Get-PSDrive -Name Cert -PSProvider Certificate); "
      + `[Console]::Out.Write([string](Test-Path -LiteralPath 'Cert:\\LocalMachine\\Root\\${SIGNED_KOSMOS.rootThumbprint}'))`);
    there = out.trim() === 'True';
  } catch (e) { rootSkip = `could not ask Windows whether Microsoft's root is installed (${String((e && e.message) || e).split('\n')[0]})`; return rootSkip; }
  rootSkip = there ? false : 'Microsoft Identity Verification Root 2020 is not installed on this computer';
  return rootSkip;
}

module.exports = { SIGNED_KOSMOS, microsoftRootSkip, windowsPowerShell };
