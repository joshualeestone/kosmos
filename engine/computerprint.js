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
 *   Windows: MachineGuid (HKLM\SOFTWARE\Microsoft\Cryptography). Specified for the Windows owner (Homer), not built
 *     here, per the fleet's Windows rule: hardwareId() answers null on Windows until that lands.
 *   Anything else: null.
 * Known limits, stated on #5532: a cloned disk image or VM clone copies MachineGuid; a logic-board repair changes
 * IOPlatformUUID. Both end at the consent prompt to make this computer the enrolled one, never at lost data.
 *
 * Null means "cannot say", and a caller must treat it as such: send no print (an older board), never a made-up one.
 */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SALT = /^[0-9a-f]{32,128}$/;   // the coordinator's per-account salt: hex, 16 to 64 bytes

let cached;   // the hardware does not change while the board runs; read once

/* The raw IOPlatformUUID out of ioreg's text, or null. Pure, so the parse is tested on fixtures. */
function parseIoreg(text) {
  const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(String(text || ''));
  return m && UUID.test(m[1]) ? m[1].toUpperCase() : null;
}

/* This computer's hardware id, or null. opts.platform and opts.run are test seams. */
function hardwareId(opts) {
  const o = opts || {};
  if (!o.run && cached !== undefined) return cached;
  const platform = o.platform || process.platform;
  let id = null;
  if (platform === 'darwin') {
    try {
      const run = o.run || (() => execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
      id = parseIoreg(run());
    } catch { id = null; }
  }
  // win32: MachineGuid, by the Windows owner (spec on #5532). Until then: null, never a guess.
  if (!o.run) cached = id;
  return id;
}

/* The print the company pins: sha256 of the served salt and this computer's hardware id, or null when either is
   missing or malformed. */
function fingerprint(salt, opts) {
  if (typeof salt !== 'string' || !SALT.test(salt)) return null;
  const id = hardwareId(opts);
  if (!id) return null;
  return crypto.createHash('sha256').update(salt + ':' + id).digest('hex');
}

module.exports = { parseIoreg, hardwareId, fingerprint, UUID, SALT };
