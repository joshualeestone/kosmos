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
 *   Anything else: null.
 * Known limits, stated on #5532: a cloned disk image or VM clone copies MachineGuid; a logic-board repair changes
 * IOPlatformUUID. Both end at the consent prompt to make this computer the enrolled one, never at lost data.
 *
 * Null means "cannot say", and a caller must treat it as such: send no print (an older board), never a made-up one.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SALT = /^[0-9a-f]{32,128}$/;   // the coordinator's per-account salt: hex, 16 to 64 bytes

/* The hardware does not change while the board runs, so a read that SUCCEEDED is kept for the run. A failed one is not:
   a reg.exe or ioreg call that times out once (a logon-time Defender scan) would otherwise leave the board with no
   print until it restarts. */
let cached = null;

/* The raw IOPlatformUUID out of ioreg's text, or null. Pure, so the parse is tested on fixtures. */
function parseIoreg(text) {
  const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(String(text || ''));
  return m && UUID.test(m[1]) ? m[1].toUpperCase() : null;
}

/* System32's reg.exe by full path, never one found on PATH, and the query it runs. Exported so a test pins both: a
   dropped /reg:64 would make a 32-bit node read WOW6432Node's copy and answer null with no error. */
const REG_ARGS = Object.freeze(['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
function regExe() { return path.win32.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'reg.exe'); }

/* The raw MachineGuid out of `reg query` text, or null. Pure, so the parse is tested on fixtures. reg prints the value
   line as "    MachineGuid    REG_SZ    <guid>"; only a REG_SZ in the GUID shape counts. */
function parseRegQuery(text) {
  const m = /^[ \t]*MachineGuid[ \t]+REG_SZ[ \t]+(\S+)[ \t]*\r?$/im.exec(String(text || ''));
  return m && UUID.test(m[1]) ? m[1].toUpperCase() : null;
}

/* This computer's hardware id, or null. opts.platform and opts.run are test seams; a stubbed run bypasses the cache
   unless opts.useCache is true (the cache's own test). */
function hardwareId(opts) {
  const o = opts || {};
  const useCache = !o.run || o.useCache === true;
  if (useCache && cached) return cached;
  const platform = o.platform || process.platform;
  let id = null;
  if (platform === 'darwin') {
    try {
      const run = o.run || (() => execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
      id = parseIoreg(run());
    } catch { id = null; }
  }
  if (platform === 'win32') {
    try {
      const run = o.run || (() => execFileSync(regExe(), REG_ARGS,
        { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
      id = parseRegQuery(run());
    } catch { id = null; }
  }
  if (useCache && id) cached = id;
  return id;
}

/* For tests only: forget the kept id, so the cache's own test starts empty. */
function _resetCache() { cached = null; }

/* The print the company pins: sha256 of the served salt and this computer's hardware id, or null when either is
   missing or malformed. */
function fingerprint(salt, opts) {
  if (typeof salt !== 'string' || !SALT.test(salt)) return null;
  const id = hardwareId(opts);
  if (!id) return null;
  return crypto.createHash('sha256').update(salt + ':' + id).digest('hex');
}

module.exports = { parseIoreg, parseRegQuery, regExe, REG_ARGS, hardwareId, _resetCache, fingerprint, UUID, SALT };
