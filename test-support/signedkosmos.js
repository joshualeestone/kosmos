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
  rootThumbprint: 'F40042E2E5F7E8EF8189FED15519AECE42C3BFA2',
  chain: Object.freeze([
    'CN="Kosmos Agent Manager, Inc.", O="Kosmos Agent Manager, Inc.", L=Mckinney, S=Texas, C=US',
    'CN=Microsoft ID Verified CS AOC CA 03, O=Microsoft Corporation, C=US',
    'CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US',
    'CN=Microsoft Identity Verification Root Certificate Authority 2020, O=Microsoft Corporation, C=US',
  ]),
});

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
    const out = require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `[Console]::Out.Write([string](Test-Path -LiteralPath 'Cert:\\LocalMachine\\Root\\${SIGNED_KOSMOS.rootThumbprint}'))`],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    there = out.trim() === 'True';
  } catch { there = false; }
  rootSkip = there ? false : 'Microsoft Identity Verification Root 2020 is not installed on this computer';
  return rootSkip;
}

module.exports = { SIGNED_KOSMOS, microsoftRootSkip };
