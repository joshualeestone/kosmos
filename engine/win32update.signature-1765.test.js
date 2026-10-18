'use strict';
/**
 * #1765: the Windows updater checks the new launcher's signature before installing, by the same rule
 * and the same pins tools/windows/setup.ps1 applies to a fresh install.
 *
 *   - signatureRefusal, the decision, is pure and runs everywhere;
 *   - the pins are read out of setup.ps1 and held equal to the updater's, everywhere;
 *   - authenticodeOf asks Windows itself, so those cases run on Windows only: the committed, signed
 *     tools/windows/Kosmos.exe passes; a copy with one byte changed, a copy with its signature cut off,
 *     and an exe signed by someone else are each refused.
 *
 * The prepare()/begin()/--apply cases are in engine/win32update.test.js (search #1765).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const win32update = require('./win32update');
const { SIGNED_KOSMOS } = require('../test-support/signedkosmos');

const REPO = path.join(__dirname, '..');
const SETUP_PS1 = path.join(REPO, 'tools', 'windows', 'setup.ps1');
const KOSMOS_EXE = path.join(REPO, 'tools', 'windows', 'Kosmos.exe');
const T = { timeout: 10000 };
const ON_WINDOWS = process.platform === 'win32';
const WINDOWS_ONLY = { timeout: 120000, skip: !ON_WINDOWS && 'asks Windows itself (Get-AuthenticodeSignature)' };

/* ─── the decision, everywhere ─────────────────────────────────────────────────────────────── */

test('#1765: Windows\' answer for a published Kosmos.exe passes', T, () => {
  assert.equal(win32update.signatureRefusal(SIGNED_KOSMOS), null);
  /* PowerShell's -ne and -match ignore case, so setup.ps1 does; so does the updater. */
  assert.equal(win32update.signatureRefusal({ ...SIGNED_KOSMOS, signer: 'KOSMOS AGENT MANAGER, INC.', rootThumbprint: SIGNED_KOSMOS.rootThumbprint.toLowerCase() }), null);
  /* The issuing CA's number can change (setup.ps1 says so); only the ID Verified PCA is required. */
  assert.equal(win32update.signatureRefusal({ ...SIGNED_KOSMOS, chain: [SIGNED_KOSMOS.chain[0], 'CN=Microsoft ID Verified Code Signing PCA 2031, O=Microsoft Corporation, C=US', SIGNED_KOSMOS.chain[3]] }), null);
});

test('#1765: every status but Valid is refused, and so is no answer at all', T, () => {
  for (const status of ['NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError', 'Incompatible', '', 'valid']) {
    assert.match(win32update.signatureRefusal({ ...SIGNED_KOSMOS, status }), /^the update's Kosmos\.exe is not validly signed \(Windows says: /, status);
  }
  for (const nothing of [undefined, null, {}, 'Valid']) {
    assert.match(win32update.signatureRefusal(nothing), /not validly signed \(Windows says: nothing\)/);
  }
});

test('#1765: a Valid signature by anyone else, or under any other chain, is refused', T, () => {
  const refused = (over) => win32update.signatureRefusal({ ...SIGNED_KOSMOS, ...over });
  assert.match(refused({ signer: 'OpenJS Foundation' }), /^the update's Kosmos\.exe is signed by 'OpenJS Foundation', not by Kosmos Agent Manager, Inc\.$/);
  assert.match(refused({ signer: 'Kosmos Agent Manager, Inc. ' }), /is signed by/, 'a near match is not the signer');
  assert.match(refused({ signer: '' }), /is signed by ''/);
  /* Lookalikes. JS's toLowerCase folds the Kelvin sign (U+212A) to 'k'; PowerShell's -ne does not. */
  for (const lookalike of ['\u212Aosmos Agent Manager, Inc.', '\uFF2Bosmos Agent Manager, Inc.', 'Kosmos Agent Manager\u2013 Inc.', 'Kosmos Agent Manager, Inc.\u200B']) {
    assert.match(refused({ signer: lookalike }), /is signed by/, JSON.stringify(lookalike));
  }
  const notMicrosoft = /^the update's Kosmos\.exe signature does not come from Microsoft's code-signing service for Kosmos Agent Manager, Inc\. \(its chain ends at /;
  assert.match(refused({ rootThumbprint: 'A'.repeat(40) }), notMicrosoft);
  assert.match(refused({ rootThumbprint: '' }), notMicrosoft);
  assert.match(refused({ rootThumbprint: SIGNED_KOSMOS.rootThumbprint.replace('F', '\uFF26') }), notMicrosoft);
  assert.match(refused({ chain: [SIGNED_KOSMOS.chain[0], 'CN=Microsoft ID Verified C\u043Ede Signing PCA 2021, O=Microsoft Corporation, C=US', SIGNED_KOSMOS.chain[3]] }), notMicrosoft, 'a Cyrillic o in the intermediate');
  assert.match(refused({ chain: [] }), /\(its chain ends at nothing\)$/);
  assert.match(refused({ chain: SIGNED_KOSMOS.chain.filter((s) => !/PCA/.test(s)) }), notMicrosoft, 'no ID Verified intermediate');
  /* The pattern is anchored at both ends, as setup.ps1's ^...\z is. */
  assert.match(refused({ chain: ['CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US, OU=extra'] }), notMicrosoft);
  assert.match(refused({ chain: ['OU=x, CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US'] }), notMicrosoft);
  assert.match(refused({ chain: ['CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US\n'] }), notMicrosoft);
  assert.match(refused({ chain: 'CN=Microsoft ID Verified Code Signing PCA 2021, O=Microsoft Corporation, C=US' }), notMicrosoft, 'a chain that is not a list');
});

/* ─── the pins are setup.ps1's, everywhere ─────────────────────────────────────────────────── */

test('#1765: the signer, root and intermediate the updater requires are exactly the ones setup.ps1 requires', T, () => {
  const text = fs.readFileSync(SETUP_PS1, 'utf8');
  const pinned = (name) => {
    const found = text.match(new RegExp(`^\\s*\\$${name} = '([^']*)'\\s*$`, 'm'));
    assert.ok(found, `setup.ps1 no longer pins $${name}`);
    return found[1];
  };
  assert.equal(win32update.EXPECTED_SIGNER, pinned('EXPECTED_SIGNER'));
  assert.equal(win32update.EXPECTED_ROOT_THUMBPRINT, pinned('EXPECTED_ROOT_THUMBPRINT'));
  const psPattern = pinned('EXPECTED_INTERMEDIATE_PATTERN');
  assert.match(psPattern, /\\z$/, 'setup.ps1\'s pattern no longer ends in \\z');
  assert.equal(win32update.EXPECTED_INTERMEDIATE_PATTERN.source, psPattern.replace(/\\z$/, '$'));
  assert.equal(win32update.EXPECTED_INTERMEDIATE_PATTERN.flags, 'i', 'PowerShell\'s -match ignores case, and nothing else');
  /* And setup.ps1 still asks the same three questions of the exe it is about to run. */
  assert.match(text, /\$signature\.Status -ne 'Valid'/);
  assert.match(text, /\$signer -ne \$EXPECTED_SIGNER/);
  assert.match(text, /\$root\.Thumbprint -ne \$EXPECTED_ROOT_THUMBPRINT -or \$intermediate\.Count -eq 0/);
});

/* ─── Windows' own answer ──────────────────────────────────────────────────────────────────── */

/* A Valid answer needs Microsoft's Identity Verification root (2020) in this computer's root store, as
   setup.ps1's check does. Every supported Windows has it; a box that does not is said, not failed. */
function microsoftRootInstalled() {
  if (!ON_WINDOWS) return false;
  try {
    const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `[Console]::Out.Write([string](Test-Path -LiteralPath 'Cert:\\LocalMachine\\Root\\${win32update.EXPECTED_ROOT_THUMBPRINT}'))`],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    return out.trim() === 'True';
  } catch { return false; }
}
const ROOT_THERE = microsoftRootInstalled();
const WITH_ROOT = { ...WINDOWS_ONLY, skip: WINDOWS_ONLY.skip || (!ROOT_THERE && 'Microsoft Identity Verification Root 2020 is not installed on this computer') };

let scratch = null;
function scratchCopy(name, bytes) {
  if (!scratch) scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sig-1765-'));
  const dir = fs.mkdtempSync(path.join(scratch, 'c-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}
test.after(() => { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }); });

test('#1765 on Windows: the committed, signed Kosmos.exe passes, chained as setup.ps1 requires', WITH_ROOT, async () => {
  const sig = await win32update.authenticodeOf(KOSMOS_EXE, 60000);
  assert.equal(sig.status, 'Valid');
  assert.equal(sig.signer, 'Kosmos Agent Manager, Inc.');
  assert.equal(sig.rootThumbprint, 'F40042E2E5F7E8EF8189FED15519AECE42C3BFA2');
  assert.equal(win32update.signatureRefusal(sig), null);
  /* A copy elsewhere (a path with a space and a quote) is the same file to Windows: the path rides in the
     environment, not the command. */
  const copy = scratchCopy("Kosmos o'clock.exe", fs.readFileSync(KOSMOS_EXE));
  assert.equal(win32update.signatureRefusal(await win32update.authenticodeOf(copy, 60000)), null);
});

test('#1765 on Windows: a copy with one byte changed is refused', WINDOWS_ONLY, async () => {
  const bytes = Buffer.from(fs.readFileSync(KOSMOS_EXE));
  bytes[0x400] ^= 0xff;
  const sig = await win32update.authenticodeOf(scratchCopy('Kosmos.exe', bytes), 60000);
  assert.equal(sig.status, 'HashMismatch');
  assert.match(win32update.signatureRefusal(sig), /not validly signed \(Windows says: HashMismatch\)/);
});

test('#1765 on Windows: the same launcher with its signature cut off is refused', WINDOWS_ONLY, async () => {
  /* The certificate table is the tail of the file, named by the optional header's Security entry
     (verify-launcher.ps1 reads it the same way); dropping it and zeroing the entry is the unsigned image. */
  const k = Buffer.from(fs.readFileSync(KOSMOS_EXE));
  const opt = k.readInt32LE(0x3c) + 24;
  const dirs = k.readUInt16LE(opt) === 0x20b ? opt + 112 : opt + 96;
  const secOff = k.readUInt32LE(dirs + 32);
  assert.ok(secOff > 0, 'the committed Kosmos.exe is not signed');
  const unsigned = Buffer.from(k.subarray(0, secOff));
  unsigned.writeUInt32LE(0, dirs + 32);
  unsigned.writeUInt32LE(0, dirs + 36);
  const sig = await win32update.authenticodeOf(scratchCopy('Kosmos.exe', unsigned), 60000);
  assert.equal(sig.status, 'NotSigned');
  assert.match(win32update.signatureRefusal(sig), /not validly signed \(Windows says: NotSigned\)/);
});

test('#1765 on Windows: an exe validly signed by someone else is refused', WITH_ROOT, async () => {
  /* This node.exe: Node.js's own release is Authenticode-signed by the OpenJS Foundation, measured
     (2026-10-17) under the very same Microsoft ID Verified chain and root as Kosmos.exe. So the chain
     alone proves nothing here; the signer's name is what refuses it. */
  const sig = await win32update.authenticodeOf(process.execPath, 60000);
  if (sig.status !== 'Valid') { assert.ok(win32update.signatureRefusal(sig)); return; }
  assert.notEqual(sig.signer, 'Kosmos Agent Manager, Inc.');
  assert.match(win32update.signatureRefusal(sig), /^the update's Kosmos\.exe is signed by '.+', not by Kosmos Agent Manager, Inc\.$/);
});

test('#1765 on Windows: a file that is not there cannot be checked, which is a refusal', WINDOWS_ONLY, async () => {
  const missing = path.join(os.tmpdir(), `kosmos-sig-1765-missing-${process.pid}.exe`);
  await assert.rejects(win32update.authenticodeOf(missing, 60000), (e) => {
    assert.doesNotMatch(e.message, /Command failed|powershell\.exe/i, 'the reason is the command line, not what went wrong');
    assert.ok(e.message.length > 0);
    return true;
  });
});

/* A signer name with characters the console's code page lacks must reach the decision as itself. A
   throwaway self-signed certificate (made in the current user's store and removed at once; its root is
   never trusted) signs a copy, so Windows' status is not Valid, but its signer name is what is compared. */
const SIGN_WITH_CN = [
  "$ErrorActionPreference = 'Stop'",
  "$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject ('CN=' + $env:KOSMOS_TEST_CN) -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddDays(1)",
  'try { [void] (Set-AuthenticodeSignature -LiteralPath $env:KOSMOS_TEST_EXE -Certificate $cert -HashAlgorithm SHA256) }',
  "finally { Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint) -Force }",
].join('\n');
function signedByLookalike(cn) {
  const exe = scratchCopy('Kosmos.exe', fs.readFileSync(KOSMOS_EXE));
  cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SIGN_WITH_CN],
    { windowsHide: true, timeout: 120000, env: { ...process.env, KOSMOS_TEST_CN: cn, KOSMOS_TEST_EXE: exe }, stdio: ['ignore', 'pipe', 'pipe'] });
  return exe;
}

test('#1765 on Windows: a signer whose name only looks like Kosmos Agent Manager reaches the check as itself, and is refused', WINDOWS_ONLY, async () => {
  for (const cn of ['\uFF2Bosmos Agent Manager, Inc.', '\u212Aosmos Agent Manager, Inc.', 'Kosmos Agent Manager\u2013 Inc.']) {
    const sig = await win32update.authenticodeOf(signedByLookalike(cn), 60000);
    assert.equal(sig.signer, cn, 'the signer name was changed on its way out of PowerShell');
    assert.match(win32update.signatureRefusal({ ...sig, status: 'Valid' }), /is signed by '.+', not by Kosmos Agent Manager, Inc\.$/, cn);
  }
});
