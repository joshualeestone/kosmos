'use strict';
/**
 * kosmos#5532 (Enterprise E0.3; contract v1.5, agreed 2026-10-07 with the coordinator's owner): a per-computer
 * fingerprint, so a company can tell its enrolled work Kosmos from a COPY of its data folder on another computer.
 *
 * WHY. The Kosmos+ signing key lives inside the world's data folder (<root>/remote, engine/remote.js), so a full copy of
 * that folder (a restored backup, Migration Assistant) is the same signer to the company. The hardware is not copied:
 * a restored backup or a migrated Mac lands on different hardware.
 *
 * WHAT IS SENT. Only HMAC-SHA256(key = salt, message = company id + ':' + hardware id). The salt is served by the coordinator in
 * status; the company id is the org this Kosmos is enrolled in, which the board already holds. The raw hardware id
 * never leaves this computer, and because the company id is in the hash, two companies always get different prints
 * for one computer, EVEN IF a coordinator served the same salt to both (review 3): unlinkability across companies
 * does not rest on the coordinator's salt alone. Within ONE company the print is a pseudonym that company can resolve:
 * it holds the salt and its own id, so with a list of candidate hardware ids (an MDM inventory often has them) it can
 * tell which computer a print is. The same is true of the coordinator's side (it serves every salt, knows every company
 * id and receives every print), and with candidate hardware ids it could also link one computer across companies. It is
 * NOT anonymous to the company or to Kosmos+; it hides the id from everyone else (reviews 5 and 7).
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
 *   1. NEVER store or LOG the print (or the raw id), nor a request body that carries it: not under a world's data root,
 *      not in board.log, activity records or any other log. A copied folder or a copied log would carry it and replay
 *      it (review 5). Compute it fresh for each request from the salt and the hardware.
 *   2. The COORDINATOR must treat a missing print, after one has been pinned for that enrollment, as a mismatch: a copy
 *      could otherwise simply send none and pass as an older board. SO A CALLER MUST NOT SEND A PRINT-LESS REQUEST WHILE
 *      THE READER IS WAITING (reviews 7 to 9): printFor() answers { send: 'later' } after a failed read, and the request
 *      is deferred. It answers { send: 'none' } only when no print can ever come from this computer.
 * No function that READS the hardware is exported, so no caller can log or send the raw id by mistake. (parseIoreg is
 * exported for the tests; it returns an id only from text its caller already holds.)
 */
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SALT = /^(?:[0-9a-fA-F]{2}){16,64}$/;   // the coordinator's per-account salt: hex either case, 16 to 64 whole bytes

let cached;   // the hardware does not change while the board runs; a successful read is kept
const realRun = () => execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
let defaultRun = realRun;   // replaced only by tests, through _testRunner below
/* After a failed read, wait this long before asking ioreg again (review 2): a hung ioreg must not block the board for
   five seconds on every call. */
const RETRY_AFTER_FAIL_MS = 60 * 1000;
let failedAt = null;   // when the last read failed, or null (never 0 as a sentinel: a clock can read 0 in a test)
let failures = 0;      // failed reads in a row
let noIdHere = false;  // ioreg's hardware block was there and has no IOPlatformUUID (some VMs): a lasting answer
/* After this many failed reads in a row (about ten minutes at one a minute), stop deferring and send without a print
   (review 9). On a computer that had a print pinned, the company then asks the person to make this computer the work
   Kosmos again, with consent: a recoverable end, where an endless wait would never let it enroll or leave. */
const GIVE_UP_AFTER = 10;

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
  // A clock that never runs backwards (review 5): a wall clock set back would hold the wait open for hours.
  const now = testNow != null ? testNow : Number(process.hrtime.bigint() / 1000000n);
  if (failedAt !== null && now - failedAt < RETRY_AFTER_FAIL_MS) return null;   // but not at once (review 2)
  let id = null;
  let ran = false;
  // 🛑 Never log this error: on a timeout or a non-zero exit its .stdout is the full ioreg dump, raw id and serial number.
  let out = '';
  try { out = String(defaultRun() || ''); ran = true; id = parseIoreg(out); } catch { id = null; }
  if (id) { cached = id; failedAt = null; failures = 0; noIdHere = false; return id; }
  failedAt = now;
  failures += 1;
  /* "No id here" only when ioreg answered WITH its hardware block and that block has no UUID key at all (review 9):
     a truncated or garbled answer is a failed read to retry, never a reason to send without a print. */
  noIdHere = ran && /IOPlatformExpertDevice/.test(out) && !/"IOPlatformUUID"/.test(out);
  return null;
}

/* The print the company pins: HMAC-SHA256(key = salt, company + ':' + hardware id), or null. `company` is
   the enrolled org's id. The print is a stable identifier for this computer WITHIN one company: personal data, held by
   that company under its own policy, and never stored in a form that links companies (it cannot be: the company id is
   in the hash). */
const COMPANY = /^[A-Za-z0-9_-]{1,128}$/;
function fingerprint(salt, company) {
  if (typeof salt !== 'string' || !SALT.test(salt)) return null;
  if (typeof company !== 'string' || !COMPANY.test(company)) return null;
  const id = hardwareId();
  if (!id) return null;
  // HMAC, the standard keyed construction (review 5), chosen before any company has pinned a print: changing it later
  // would change every print. The salt is the key, lower-cased so a coordinator's hex case cannot change the print.
  return crypto.createHmac('sha256', Buffer.from(salt.toLowerCase(), 'hex')).update(company + ':' + id).digest('hex');
}

/**
 * What a caller sends, in ONE answer (review 9: a separate state and print could disagree):
 *   { send: 'print', print }   send the print
 *   { send: 'none' }           send WITHOUT a print: no reader on this platform, a computer whose hardware block has no
 *                              id, or GIVE_UP_AFTER failed reads in a row
 *   { send: 'later' }          DEFER the request: a read failed and its wait is running, or the salt or company is not
 *                              well formed (a request without a print now would read as a copy to the company)
 * Never reveals the id. fingerprint() alone answers only the print or null; callers should use this.
 */
function printFor(salt, company) {
  const platform = testPlatform || process.platform;
  if (platform !== 'darwin') return { send: 'none' };
  if (typeof salt !== 'string' || !SALT.test(salt) || typeof company !== 'string' || !COMPANY.test(company)) return { send: 'later' };
  const print = fingerprint(salt, company);
  if (print) return { send: 'print', print };
  if (noIdHere || failures >= GIVE_UP_AFTER) return { send: 'none' };
  return { send: 'later' };
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
  failedAt = null;
  failures = 0;
  noIdHere = false;
}
/* TESTS ONLY: move the test clock without clearing the cache (for the retry-wait test). */
function _testClock(now) { testNow = now; }

// parseIoreg is exported for the fixture tests: it returns an id only from text the caller already holds.
module.exports = { parseIoreg, fingerprint, printFor, UUID, SALT, RETRY_AFTER_FAIL_MS, GIVE_UP_AFTER, _testRunner, _testClock };
