'use strict';
/**
 * kosmos#5532 (Enterprise E0.3; contract v1.5, agreed 2026-10-07 with the coordinator's owner): a per-computer
 * fingerprint, so a company can tell its enrolled work Kosmos from a COPY of its data folder on another computer.
 *
 * WHY. The Kosmos+ signing key lives inside the world's data folder (<root>/remote, engine/remote.js), so a full copy of
 * that folder (a restored backup, Migration Assistant) is the same signer to the company. The hardware is not copied:
 * a restored backup or a migrated Mac lands on different hardware.
 *
 * WHAT IS SENT. Only sha256(salt + ':' + hardware id), where the salt is per account and served by the coordinator in
 * status. The raw hardware id never leaves this computer, and with a per-account salt the print cannot be matched
 * across accounts or companies.
 *
 * WHERE THE HARDWARE ID COMES FROM.
 *   macOS: IOPlatformUUID, from `ioreg -rd1 -c IOPlatformExpertDevice` (no permission prompt, no entitlement).
 *   Windows: MachineGuid, from `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid /reg:64` (readable by a
 *     standard user, no elevation). /reg:64 so a 32-bit node would still read the 64-bit hive, not WOW6432Node's copy.
 *     When reg.exe refuses (the "Prevent access to registry editing tools" policy, an AppLocker rule: both common on the
 *     managed PCs this is for), the same value is read with PowerShell's Get-ItemPropertyValue, which works in
 *     Constrained Language mode. That covers the registry-tools policy and AppLocker rules aimed at reg.exe alone; an
 *     AppLocker rule that also blocks powershell.exe leaves no way in, and the answer is null.
 *   Anything else: null.
 * Known limits, stated on #5532: a cloned disk image or VM clone copies MachineGuid; a logic-board repair changes
 * IOPlatformUUID. Both end at the consent prompt to make this computer the enrolled one, never at lost data. A PC that
 * blocks both reg.exe and PowerShell answers null (no print), the same as an older board.
 *
 * Null means "cannot say", and a caller must treat it as such: send no print (an older board), never a made-up one.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SALT = /^[0-9a-f]{32,128}$/;   // the coordinator's per-account salt: hex, 16 to 64 bytes

/* The hardware does not change while the board runs, so a read that SUCCEEDED is kept for the run. A failed one is not
   kept forever: a reg.exe or ioreg call that times out once (a logon-time Defender scan) would otherwise leave the board
   with no print until it restarts. But the read is a synchronous spawn (up to 15s on Windows when both reads time out),
   so a failure is retried only after RETRY_AFTER_MS[n] for the n-th failure in a row, and after the last one not again
   this run: a PC that blocks the read for good pays for it a few times, not every five minutes forever. The window is
   measured on the monotonic clock, so a logon-time clock correction cannot stretch or shrink it. Callers should still
   read the print off any request path. */
const RETRY_AFTER_MS = Object.freeze([5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000]);
let cached = null;
let failures = 0;
let failedAt = 0;

/* The raw IOPlatformUUID out of ioreg's text, or null. Pure, so the parse is tested on fixtures. */
function parseIoreg(text) {
  const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(String(text || ''));
  return m && UUID.test(m[1]) ? m[1].toUpperCase() : null;
}

/* Windows' own reg.exe and powershell.exe by full path (for determinism, as machine.js and runners.js resolve System32;
   SystemRoot is as environment-controlled as PATH, so this is not a security boundary), and the queries they run.
   Exported so a test pins them: a dropped /reg:64 would make a 32-bit node read WOW6432Node's copy and answer null with
   no error. PowerShell has no /reg:64, so a 32-bit node reaches the 64-bit powershell.exe through Sysnative. */
const REG_ARGS = Object.freeze(['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
const PS_ARGS = Object.freeze(['-NoProfile', '-NonInteractive', '-Command',
  "Get-ItemPropertyValue -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid"]);
function systemRoot() { return process.env.SystemRoot || process.env.windir || 'C:\\Windows'; }
function regExe() { return path.win32.join(systemRoot(), 'System32', 'reg.exe'); }
function powershellExe() {
  const sys = process.env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32';   // set only in a 32-bit process on 64-bit Windows
  return path.win32.join(systemRoot(), sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/* The raw MachineGuid out of `reg query` text, or null. Pure, so the parse is tested on fixtures. reg prints the value
   line as "    MachineGuid    REG_SZ    <guid>"; only a REG_SZ in the GUID shape counts. */
function parseRegQuery(text) {
  const m = /^[ \t]*MachineGuid[ \t]+REG_SZ[ \t]+(\S+)[ \t]*\r?$/im.exec(String(text || ''));
  return m && UUID.test(m[1]) ? m[1].toUpperCase() : null;
}

/* The MachineGuid out of the PowerShell fallback's output (the bare value on one line), or null. */
function parsePsValue(text) {
  const v = String(text || '').trim();
  return UUID.test(v) ? v.toUpperCase() : null;
}

/* One read attempt, never throwing: a refusal, a timeout or unparseable output is null. */
function attempt(run, parse) {
  try { return parse(run()); } catch { return null; }
}

/* The two real Windows reads, exactly as production runs them (exported so the real-registry test runs these, not
   copies). Each returns the command's stdout or throws. */
const QUIET = Object.freeze({ encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
function readRegistry() { return execFileSync(regExe(), REG_ARGS, { ...QUIET, timeout: 5000 }); }
// PowerShell starts slower than reg.exe, hence its longer timeout; it runs only when reg.exe gave nothing.
function readPowerShell() { return execFileSync(powershellExe(), PS_ARGS, { ...QUIET, timeout: 10000 }); }

/* May a failed read be tried again at `now`? No while inside the window for the current failure count, and never
   once every window has been used. */
function mayRetry(now) {
  if (!failures) return true;
  if (failures > RETRY_AFTER_MS.length) return false;
  return now - failedAt >= RETRY_AFTER_MS[failures - 1];
}

/* This computer's hardware id, or null. Test seams: opts.platform; opts.run (the first read: ioreg or reg.exe) and
   opts.runFallback (Windows' PowerShell read; with a stubbed run and no stubbed fallback, no fallback runs, so a test
   never spawns PowerShell); opts.now. A stubbed run bypasses the cache unless opts.useCache is true (its own test). */
function hardwareId(opts) {
  const o = opts || {};
  const useCache = !o.run || o.useCache === true;
  const now = typeof o.now === 'number' ? o.now : performance.now();   // monotonic: see RETRY_AFTER_MS
  if (useCache && cached) return cached;
  if (useCache && !mayRetry(now)) return null;
  const platform = o.platform || process.platform;
  let id = null;
  if (platform === 'darwin') {
    try {
      const run = o.run || (() => execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
      id = parseIoreg(run());
    } catch { id = null; }
  }
  if (platform === 'win32') {
    id = attempt(o.run || readRegistry, parseRegQuery);
    const fallback = o.runFallback || (o.run ? null : readPowerShell);
    if (!id && fallback) id = attempt(fallback, parsePsValue);
  }
  if (useCache) {
    if (id) { cached = id; failures = 0; failedAt = 0; } else { failures += 1; failedAt = now; }
  }
  return id;
}

/* For tests only: forget the kept id and any failures, so the cache's own test starts empty. */
function _resetCache() { cached = null; failures = 0; failedAt = 0; }

/* The print the company pins: sha256 of the served salt and this computer's hardware id, or null when either is
   missing or malformed. */
function fingerprint(salt, opts) {
  if (typeof salt !== 'string' || !SALT.test(salt)) return null;
  const id = hardwareId(opts);
  if (!id) return null;
  return crypto.createHash('sha256').update(salt + ':' + id).digest('hex');
}

module.exports = {
  parseIoreg, parseRegQuery, parsePsValue, regExe, powershellExe, readRegistry, readPowerShell, REG_ARGS, PS_ARGS, RETRY_AFTER_MS,
  hardwareId, _resetCache, fingerprint, UUID, SALT,
};
