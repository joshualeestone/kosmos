'use strict';
/**
 * kosmos#5532 (Enterprise E0.3; contract v1.5, agreed 2026-10-07 with the coordinator's owner): a per-computer
 * fingerprint, so a company can tell its enrolled work Kosmos from a COPY of its data folder on another computer.
 *
 * WHY. The Kosmos+ signing key lives inside the world's data folder (<root>/remote, engine/remote.js), so a full copy of
 * that folder (a restored backup, Migration Assistant) is the same signer to the company. The hardware is not copied:
 * a restored backup or a migrated Mac lands on different hardware.
 *
 * WHAT IS SENT. Only sha256(salt + ':' + company id + ':' + hardware id). The salt is served by the coordinator in
 * status; the company id is the org this Kosmos is enrolled in, which the board already holds. The raw hardware id
 * never leaves this computer, and because the company id is in the hash, two companies always get different prints
 * for one computer, EVEN IF a coordinator served the same salt to both (review 3): unlinkability across companies
 * does not rest on the coordinator's salt alone.
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
 *
 * 🛑 TWO RULES THE GUARANTEE RESTS ON (review 1), because the print is reported by this computer, not proven:
 *   1. NEVER store the print (or the raw id) under a world's data root: a copied folder would carry it and replay it.
 *      Compute it fresh for each request from the salt and the hardware.
 *   2. The COORDINATOR must treat a missing print, after one has been pinned for that enrollment, as a mismatch: a copy
 *      could otherwise simply send none and pass as an older board.
 * The raw id is not exported: only fingerprint() leaves this module, so no caller can log or send the id by mistake.
 */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SALT = /^(?:[0-9a-f]{2}){16,64}$/;   // the coordinator's per-account salt: hex, 16 to 64 whole bytes

let cached;   // the hardware does not change while the board runs; a successful read is kept
const realRun = () => execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
let defaultRun = realRun;   // replaced only by tests, through _testRunner below
/* After a failed read, wait this long before asking ioreg again (review 2): a hung ioreg must not block the board for
   five seconds on every call. */
const RETRY_AFTER_FAIL_MS = 60 * 1000;
let failedAt = 0;

/* The raw IOPlatformUUID out of ioreg's text, or null. Pure, so the parse is tested on fixtures. */
function parseIoreg(text) {
  const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(String(text || ''));
  return m && UUID.test(m[1]) ? m[1].toUpperCase() : null;
}

/* Test state, set ONLY through _testRunner (review 4: no option on fingerprint() can change how the hardware is read, so
   no production caller can skip the cache or the retry wait). */
let testPlatform = null;
let testNow = null;

/* This computer's hardware id, or null. Module-private on purpose (see the rules above). */
function hardwareId() {
  const platform = testPlatform || process.platform;
  if (platform !== 'darwin') return null;   // no reader here (Windows: by its owner); not a failure, so no retry state
  if (cached) return cached;   // only a SUCCESSFUL read is kept (review 1); a failed one is tried again,
  const now = testNow != null ? testNow : Date.now();
  if (failedAt && now - failedAt < RETRY_AFTER_FAIL_MS) return null;   // but not at once (review 2)
  let id = null;
  try { id = parseIoreg(defaultRun()); } catch { id = null; }
  if (id) { cached = id; failedAt = 0; } else failedAt = now;
  return id;
}

/* The print the company pins: sha256(salt:company:hardware id), or null when any is missing or malformed. `company` is
   the enrolled org's id. The print is a stable identifier for this computer WITHIN one company: personal data, held by
   that company under its own policy, and never stored in a form that links companies (it cannot be: the company id is
   in the hash). */
const COMPANY = /^[A-Za-z0-9_-]{1,128}$/;
function fingerprint(salt, company) {
  if (typeof salt !== 'string' || !SALT.test(salt)) return null;
  if (typeof company !== 'string' || !COMPANY.test(company)) return null;
  const id = hardwareId();
  if (!id) return null;
  return crypto.createHash('sha256').update(salt + ':' + company + ':' + id).digest('hex');
}

/* TESTS ONLY: swap the reader, the platform and the clock, and clear the cache and the retry state. Call with no
   arguments to restore the real ones. Nothing in the board calls it; a guard test fails if anything outside the tests
   does. */
function _testRunner(fn, opts) {
  const o = opts || {};
  defaultRun = fn || realRun;
  testPlatform = o.platform || null;
  testNow = o.now != null ? o.now : null;
  cached = undefined;
  failedAt = 0;
}
/* TESTS ONLY: move the test clock without clearing the cache (for the retry-wait test). */
function _testClock(now) { testNow = now; }

// parseIoreg is exported for the fixture tests: it returns an id only from text the caller already holds.
module.exports = { parseIoreg, fingerprint, UUID, SALT, RETRY_AFTER_FAIL_MS, _testRunner, _testClock };
