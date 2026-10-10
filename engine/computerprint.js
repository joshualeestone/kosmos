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
 *   Windows: MachineGuid, from `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid /reg:64` (readable by a
 *     standard user, no elevation). /reg:64 so a 32-bit node would still read the 64-bit hive, not WOW6432Node's copy.
 *     When reg.exe gives no GUID (the "Prevent access to registry editing tools" policy, an AppLocker rule: both common
 *     on the managed PCs this is for), the same value is read with PowerShell's Get-ItemPropertyValue, which works in
 *     Constrained Language mode. That covers the registry-tools policy and AppLocker rules aimed at reg.exe alone; a PC
 *     that also blocks powershell.exe has no way in, and its reads fail like a hung ioreg (the same retry rule below).
 *     A value that is missing or not in the GUID shape is a failed read too: Windows has no lasting "no id here".
 *   Anything else: null (no reader).
 * Known limits, stated on #5532: a cloned disk image or VM clone copies MachineGuid; a logic-board repair changes
 * IOPlatformUUID. Both end at the consent prompt to make this computer the enrolled one, never at lost data.
 *
 * CALLERS USE printFor() ONLY (review 11). It answers what to do: send the print, send none, wait, or report an error.
 * The bare print function is exported only under a tests-only name (`_testFingerprint`, kept out of the board by the
 * repo scan), because its null is ambiguous: "this computer can never print" means send
 * none, but "a read just failed" means wait, and a print-less request then would read as a copy.
 *
 * 🛑 THE COMPANY ID MUST COME FROM THIS BOARD'S OWN ENROLLMENT RECORD, NEVER FROM A COORDINATOR'S ANSWER (review 11).
 * Otherwise a coordinator could ask a computer enrolled in company B for its print under company A's id and salt, and
 * link the two with no list of hardware ids at all.
 *
 * The clock is monotonic, so a wall clock set back cannot hold a wait open; it also does not count time the computer is
 * asleep, so on a laptop the minute, the ten minutes and the backoff can stretch over more wall-clock time (safe).
 *
 * In memory: the raw id is kept in a module variable for the life of the board process once read (a heap snapshot or a
 * core dump would hold it), and so would the last ioreg dump or reg.exe/PowerShell answer until it is garbage-collected
 * (a JavaScript string cannot be wiped; review 15 corrected my claim that it was "dropped at once"). Nothing writes
 * either anywhere. After giving up, the reader still tries, but each wait doubles up to an hour (review 15): a reader
 * that recovers is noticed, and a reader that hangs for good costs one stall an hour (up to five seconds on a Mac,
 * fifteen on Windows when both reads hang), not one a minute. So one enrollment can see 'none' and later a print
 * (review 14). That is expected: an enroll with no print pins nothing
 * (the coordinator confirmed), so the later print cannot mismatch; enrolling again with the print pins it.
 *
 * The print does not rotate within one company: a computer that leaves and joins again, or is handed to someone else,
 * is recognisable to that company and to the coordinator for as long as that account's salt lives (review 11).
 *
 * 🛑 TWO RULES THE GUARANTEE RESTS ON (review 1), because the print is reported by this computer, not proven:
 *   1. NEVER store or LOG the print (or the raw id), nor a request body that carries it: not under a world's data root,
 *      not in board.log, activity records or any other log. A copied folder or a copied log would carry it and replay
 *      it (review 5). Compute it fresh for each request from the salt and the hardware.
 *   2. The COORDINATOR must treat a missing print, after one has been pinned for that enrollment, as a mismatch: a copy
 *      could otherwise simply send none and pass as an older board. SO A CALLER MUST NOT SEND A PRINT-LESS REQUEST WHILE
 *      THE READER IS WAITING (reviews 7 to 9): printFor() answers { send: 'later' } after a failed read, and the request
 *      is deferred. It answers { send: 'none' } only when no print can ever come from this computer.
 * 🛑 RESIDUAL, on the coordinator's side (review 10): a print is compared only once one is pinned. A computer that
 * pinned none (a Mac with no hardware id, a platform with no reader yet, or a read that gave up at enroll) can be
 * copied, and the copy, which also sends none, passes. Only a pin closes that; nothing here can.
 *
 * No exported function RETURNS the raw id (printFor and the tests-only print function read the hardware, but hand back
 * only a print), so no caller can log or send it by mistake. (parseIoreg, parseRegQuery and parsePsValue are exported for
 * the tests; each returns an id only from text its caller already holds.)
 */
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SALT = /^(?:[0-9a-fA-F]{2}){16,64}$/;   // the coordinator's per-account salt: hex either case, 16 to 64 whole bytes

let cached;   // the hardware does not change while the board runs; a successful read is kept

/* Windows' own reg.exe and powershell.exe by full path (for determinism, as machine.js and runners.js resolve System32;
   SystemRoot is as environment-controlled as PATH, so this is not a security boundary), and the queries they run.
   Exported so a test pins them: a dropped /reg:64 would make a 32-bit node read WOW6432Node's copy and fail with no
   error. PowerShell has no /reg:64, so a 32-bit node reaches the 64-bit powershell.exe through Sysnative. */
const REG_ARGS = Object.freeze(['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
const PS_ARGS = Object.freeze(['-NoProfile', '-NonInteractive', '-Command',
  "Get-ItemPropertyValue -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid"]);
function systemRoot() { return process.env.SystemRoot || process.env.windir || 'C:\\Windows'; }
function regExe() { return path.win32.join(systemRoot(), 'System32', 'reg.exe'); }
function powershellExe() {
  const sys = process.env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32';   // set only in a 32-bit process on 64-bit Windows
  return path.win32.join(systemRoot(), sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/* How long each read may hang the board. PowerShell starts slower than reg.exe, hence its longer wait; it runs only
   when reg.exe gave no GUID, so a Windows read that fails both ways stalls for up to fifteen seconds. */
const IOREG_TIMEOUT_MS = 5000;
const REG_TIMEOUT_MS = 5000;
const POWERSHELL_TIMEOUT_MS = 10000;
/* The real reads. Each returns the command's stdout or throws; module-private, because that stdout holds the raw id
   (review on #5557). */
const QUIET = Object.freeze({ encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
function readIoreg() { return execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: IOREG_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }); }
function readRegistry() { return execFileSync(regExe(), REG_ARGS, { ...QUIET, timeout: REG_TIMEOUT_MS }); }
function readPowerShell() { return execFileSync(powershellExe(), PS_ARGS, { ...QUIET, timeout: POWERSHELL_TIMEOUT_MS }); }
/* The first read on this platform: ioreg's dump on a Mac, reg.exe's answer on Windows. */
function realRun(platform) { return platform === 'win32' ? readRegistry() : readIoreg(); }
let defaultRun = realRun;   // replaced only by tests, through _testRunner below
let defaultFallback = readPowerShell;   // Windows' second read; a test that swaps the first read gets none unless it asks
/* After a failed read, wait this long before reading again (review 2): a hung ioreg must not block the board for five
   seconds on every call, nor a hung reg.exe and PowerShell for fifteen. One rule on both platforms (#5557 review). */
const RETRY_AFTER_FAIL_MS = 60 * 1000;
let failedAt = null;   // when the last read failed, or null (never 0 as a sentinel: a clock can read 0 in a test)
let firstFailAt = null;  // when the current run of failed reads began, or null
let backoff = RETRY_AFTER_FAIL_MS;   // the wait before the next read; doubles after giving up, up to MAX_BACKOFF_MS
let noIdHere = false;  // ioreg's hardware block was there and has no IOPlatformUUID (some VMs): a lasting answer
let noIdStreak = 0;    // such answers in a row: one can be a cut-off dump, so it takes two (review 12)
/* After failing for this long in a row (measured on the clock, not by how often a caller asks; review 15), stop
   deferring and send without a print (review 9). On a computer that had a print pinned, the company then asks the
   person to make this computer the work Kosmos again, with consent: a recoverable end, never an endless wait. */
const GIVE_UP_AFTER_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
function gaveUp(now) { return firstFailAt !== null && now - firstFailAt >= GIVE_UP_AFTER_MS; }
function clockNow() { return testNow != null ? testNow : Number(process.hrtime.bigint() / 1000000n); }

/* The raw IOPlatformUUID out of ioreg's text, or null. Pure, so the parse is tested on fixtures. */
function parseIoreg(text) {
  const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(String(text || ''));
  return m && UUID.test(m[1]) ? m[1].toUpperCase() : null;
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

/* Windows' read: reg.exe, then PowerShell when reg.exe gave no GUID. Returns the id or throws; the error never carries
   the value or either command's output. */
function readMachineGuid() {
  let id = null;
  try { id = parseRegQuery(defaultRun('win32')); } catch { id = null; }
  if (!id && defaultFallback) { try { id = parsePsValue(defaultFallback()); } catch { id = null; } }
  if (!id) throw new Error('no MachineGuid could be read');
  return id;
}

/* The platforms with a reader. Anywhere else no print can ever come (send none), which is not a failed read. */
const HAS_READER = Object.freeze(['darwin', 'win32']);

/* Test state, set ONLY through _testRunner (review 4: no option on fingerprint() can change how the hardware is read, so
   no production caller can skip the cache or the retry wait). */
let testPlatform = null;
let testNow = null;

/* This computer's hardware id, or null. Module-private on purpose (see the rules above). */
function hardwareId() {
  const platform = testPlatform || process.platform;
  if (!HAS_READER.includes(platform)) return null;   // no reader here; not a failure, so no retry state
  if (cached) return cached;   // only a SUCCESSFUL read is kept (review 1); a failed one is tried again,
  // A clock that never runs backwards (review 5): a wall clock set back would hold the wait open for hours.
  const now = clockNow();
  if (failedAt !== null && now - failedAt < backoff) return null;   // but not at once (review 2)
  let id = null;
  let ran = false;
  // 🛑 Never log this error: on a timeout or a non-zero exit its .stdout is the full ioreg dump, raw id and serial number.
  let out = '';
  if (platform === 'win32') {
    try { id = readMachineGuid(); } catch { id = null; }   // ran stays false: Windows has no lasting "no id here"
  } else {
    try { out = String(defaultRun(platform) || ''); ran = true; id = parseIoreg(out); } catch { id = null; }
  }
  if (id) { cached = id; failedAt = null; firstFailAt = null; backoff = RETRY_AFTER_FAIL_MS; noIdHere = false; return id; }
  failedAt = now;
  if (firstFailAt === null) firstFailAt = now;
  if (gaveUp(now)) backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);   // after giving up, back off (review 15)
  /* "No id here" only when ioreg answered WITH its hardware block and that block has no UUID key at all (review 9):
     a truncated or garbled answer is a failed read to retry, never a reason to send without a print. */
  /* The block must be WHOLE: its own header line, then its property list closed by a line holding only "}" (review 16).
     A dump cut off before the end, however often, is a failed read, not "no id here". */
  // A linear check, no regex backtracking (review 18): the block's header line, an opening brace after it, and a lone
  // "}" as the very last line of the text (review 17: the end of the TEXT, not of any line).
  const head = out.search(/(^|\n)\+-o [^\n]*<class IOPlatformExpertDevice\b/);
  const lines = out.replace(/\s+$/, '').split('\n');
  // A whole block that yields no valid id is "no id here", whether the key is absent or holds something that is not a
  // UUID (some VMs; review 19): either way no read will ever produce a print.
  const blockWithoutId = ran && head !== -1 && out.indexOf('{', head) !== -1 && lines.length > 1 && lines[lines.length - 1].trim() === '}';
  noIdStreak = blockWithoutId ? noIdStreak + 1 : 0;
  noIdHere = noIdStreak >= 2;   // the same answer twice, a minute apart: a lasting "no id", not a dump cut short
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
  // would change every print. The salt's bytes are the key; Node's hex decoding reads either case alike (review 13).
  return crypto.createHmac('sha256', Buffer.from(salt, 'hex')).update(company + ':' + id).digest('hex');
}

/**
 * What a caller sends, in ONE answer (review 9: a separate state and print could disagree):
 *   { send: 'print', print }   send the print
 *   { send: 'none' }           send WITHOUT a print: no reader on this platform, a computer whose hardware block has no
 *                              id, or reads failing for GIVE_UP_AFTER_MS in a row
 *   { send: 'later' }          DEFER the request: a read failed and its wait is running (a request without a print now
 *                              would read as a copy to the company)
 *   { send: 'error', because } the salt or the company is not well formed: a bug on one side, not a wait (review 10).
 *                              Say so (log the `because`, which never holds a print or an id) and send nothing; never
 *                              retry it silently forever.
 * Never reveals the id. fingerprint() alone answers only the print or null; callers should use this.
 */
function printFor(salt, company) {
  // Inputs first, on every platform (review 11): a malformed salt or company is the same visible error everywhere.
  if (typeof salt !== 'string' || !SALT.test(salt)) return { send: 'error', because: 'the company served a salt this board cannot use' };
  if (typeof company !== 'string' || !COMPANY.test(company)) return { send: 'error', because: 'the company id is not one this board can use' };
  const platform = testPlatform || process.platform;
  if (!HAS_READER.includes(platform)) return { send: 'none' };
  const print = fingerprint(salt, company);
  if (print) return { send: 'print', print };
  if (noIdHere || gaveUp(clockNow())) return { send: 'none' };
  return { send: 'later' };
}

/* TESTS ONLY: swap the reader, the platform and the clock, and clear the cache and the retry state. Call with no
   arguments to restore the real ones. `fn` is the first read (ioreg on a Mac, reg.exe on Windows); `opts.fallback` is
   Windows' second read: a function, 'real' for the production PowerShell read, or nothing, in which case a swapped
   first read runs no PowerShell at all (so a test never spawns it by accident). Nothing in the board calls it; a guard
   test fails if anything outside the tests does. */
function _testRunner(fn, opts) {
  const o = opts || {};
  defaultRun = fn || realRun;
  if (!fn || o.fallback === 'real') defaultFallback = readPowerShell;
  else defaultFallback = typeof o.fallback === 'function' ? o.fallback : null;
  testPlatform = o.platform || null;
  testNow = o.now != null ? o.now : null;
  cached = undefined;
  failedAt = null;
  firstFailAt = null;
  backoff = RETRY_AFTER_FAIL_MS;
  noIdHere = false;
  noIdStreak = 0;
}
/* TESTS ONLY: move the test clock without clearing the cache (for the retry-wait test). */
function _testClock(now) { testNow = now; }

// The parsers are exported for the fixture tests: each returns an id only from text the caller already holds. The
// Windows paths and arguments are exported so a test pins them; none of them reads anything.
module.exports = { parseIoreg, parseRegQuery, parsePsValue, regExe, powershellExe, REG_ARGS, PS_ARGS, printFor, _testFingerprint: fingerprint, UUID, SALT, RETRY_AFTER_FAIL_MS, GIVE_UP_AFTER_MS, MAX_BACKOFF_MS, _testRunner, _testClock };
