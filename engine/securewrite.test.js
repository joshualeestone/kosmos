'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * #1787: direct arms for the shared secret writer.
 *
 * 🛑 WHY THIS FILE EXISTS SEPARATELY FROM `sendertoken.test.js`. The writer's
 * five mutation-verified guards arrived with #1776 and all of them live in
 * `engine/sendertoken.test.js`, reaching the writer THROUGH `mint()`. That was
 * fine while `sendertoken.js` was the only caller. It is not fine now: four
 * modules share this writer, and if `sendertoken.js` ever stops using it the
 * other three lose their coverage SILENTLY, with nothing going red to say so.
 *
 * ⭐ That is the same call-site-coverage shape this branch already paid for once
 * (deleting the production call to `refuseSymlinkTarget` left the suite fully
 * green), arriving one layer further out: coverage attached to a CONSUMER rather
 * than to the thing being guarded.
 *
 * These arms call `writeSecret` and `secureDir` directly, so they hold whatever
 * happens to the consumers.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const securewrite = require('./securewrite');
const WIN = process.platform === 'win32';   // kosmos#8378: mode lines only, inside arms whose subject runs there
const NO_POSIX_MODES = require('../test-support/skip-on-win32').skipOnWin32('it checks POSIX file modes, which Windows does not keep');   // kosmos#8378

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-securewrite-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const fresh = (name) => path.join(SANDBOX, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const modeOf = (p) => fs.statSync(p).mode & 0o777;

/* 🛑 THE DEFECT THIS WRITER EXISTS FOR, ASSERTED ON THE INODE RATHER THAN THE MODE.
   Both the old shape (write in place, then chmod) and this one END at 0600, so a
   mode assertion passes either way and cannot be the guard. `rename` REPLACES the
   inode; a write in place REUSES it. That is the only observable that differs. */
// kosmos#8378: the subject is the inode, which Windows has too (its file index); only the mode lines are POSIX.
test('#1787: writeSecret REPLACES a pre-existing loose file rather than rewriting it', () => {
  const f = fresh('replace');
  fs.writeFileSync(f, 'OLD');
  if (!WIN) {
    fs.chmodSync(f, 0o644);
    assert.equal(modeOf(f), 0o644, 'the loose plant did not take, so this arm would pass without the fix');
  }
  const inodeBefore = fs.statSync(f).ino;
  assert.ok(inodeBefore > 0, 'CONTROL: this file system reports an inode, so the comparison below can fail');

  securewrite.writeSecret(f, 'NEW-SECRET', 0o600);

  assert.notEqual(fs.statSync(f).ino, inodeBefore,
    'the secret was written IN PLACE: same inode means no rename, so the bytes were '
    + 'on disk at 0644 before any chmod');
  if (!WIN) assert.equal(modeOf(f), 0o600, 'the file was left loose');
  assert.equal(fs.readFileSync(f, 'utf8'), 'NEW-SECRET');
});

/* The create-time mode is a real mechanism and it is NOT what this module is for:
   this arm is the CONTROL that the fresh-create case was never broken, so a reader
   can see which case the inode arm above is actually about. */
test('#1787: CONTROL, a fresh path was never the broken case', { skip: NO_POSIX_MODES }, () => {
  const f = fresh('fresh');
  securewrite.writeSecret(f, 'SECRET', 0o600);
  assert.equal(modeOf(f), 0o600);
  assert.equal(fs.readFileSync(f, 'utf8'), 'SECRET');
});

/* #1763: mkdirSync's mode is create-only too, so a directory that already exists at
   0755 stays there. A loose directory discloses the FILENAMES even when every file
   inside is 0600. */
test('#1787: secureDir tightens a pre-existing loose directory, not just a fresh one', { skip: NO_POSIX_MODES }, () => {
  const d = fresh('dir');
  fs.mkdirSync(d, { recursive: true });
  fs.chmodSync(d, 0o755);
  assert.equal(modeOf(d), 0o755, 'the loose plant did not take, so this arm would pass without the fix');

  securewrite.secureDir(d, 0o700);

  assert.equal(modeOf(d), 0o700, 'a pre-existing loose directory stayed loose');
});

/* 🛑 THE WIN32 PATH, WHICH A GREEN macOS SUITE CANNOT OTHERWISE SPEAK ABOUT.
   `refuseSymlinkTarget` is called with `undefined` on purpose so the hand check runs
   on EVERY platform. On macOS `O_NOFOLLOW` would make the kernel refuse instead, so
   without this arm the guard is dead code here and its deletion is invisible.
   The guard is the SENTENCE: a kernel refusal says ELOOP, ours says so in words. */
test('#1787: a symlink planted at the target is REFUSED, by our code and not the kernel', () => {
  const victim = fresh('victim');
  fs.writeFileSync(victim, 'ORIGINAL');
  const link = fresh('linked');
  fs.symlinkSync(victim, link);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the symlink was not planted');

  /* 🛑 ASSERT THE CODE, NOT ONLY THE MESSAGE, AND THE TITLE OF THIS ARM IS WHY.
     The operator-facing strings report `err.code` and deliberately NOT `err.message`,
     because the message carries the absolute path of a credential file. So the message
     is a discriminator NOTHING IN PRODUCTION READS. Measured: reverting the code to
     `ELOOP` -- the exact iteration-7 fix -- left this arm GREEN, and the only thing that
     reddened was an arm in `sendertoken.test.js`, i.e. coverage attached to a CONSUMER
     rather than to the thing being guarded. That is the shape this file's own header
     was written to stop, arriving again one field over. */
  let caught = null;
  assert.throws(
    () => securewrite.refuseSymlinkTarget(link, undefined),
    (err) => { caught = err; return /refusing to write a secret through a symlink/.test(err.message); },
    'a planted symlink was not refused',
  );
  assert.equal(caught.code, 'ERR_KOSMOS_SYMLINK',
    `our refusal reported code ${caught.code}: on macOS the KERNEL also refuses a symlink `
    + 'with ELOOP, so sharing that code makes our refusal indistinguishable from the '
    + 'kernel\'s -- and that distinction is the whole guard on win32, where there is no '
    + 'kernel refusal at all');
  /* Not asserted: the victim is untouched here BY CONSTRUCTION, because the call under
     test only lstats. An assertion that cannot fail reads as coverage. */
});

/* 🛑 THE ATOMIC PATH'S REASON FOR GIVING UP MUST SURVIVE, AND NEITHER SITE THAT
   ATTACHES IT HAD AN ARM. Measured by mutation before writing these: deleting the
   cause-attach on the symlink branch reddened NOTHING across all five per-file runs,
   and deleting the pre-existing one at the fallback failure reddened nothing either.
   Both sites carry a paragraph of comment explaining why they matter, which is exactly
   the shape that reads as covered and is not. */
test('#1787: a symlink refusal in the fallback still carries WHY the atomic path was abandoned', () => {
  const victim = fresh('cause-victim');
  fs.writeFileSync(victim, 'ORIGINAL');
  const link = fresh('cause-link');
  fs.symlinkSync(victim, link);

  const realRename = fs.renameSync;
  /* Force the atomic path to exhaust its three attempts. EXDEV is the realistic
     trigger: a temp and a target on different filesystems can never be renamed. */
  fs.renameSync = () => { const e = new Error('forced cross-device'); e.code = 'EXDEV'; throw e; };
  let caught = null;
  try { securewrite.writeSecret(link, 'NEW-SECRET', 0o600); } catch (e) { caught = e; } finally {
    fs.renameSync = realRename;
  }

  assert.notEqual(caught, null, 'the forced failure did not fail, so nothing was tested');
  assert.equal(caught.code, 'ERR_KOSMOS_SYMLINK', 'the symlink was not what refused the write');
  assert.equal(caught.cause && caught.cause.code, 'EXDEV',
    'the symlink refusal was thrown with no cause, so a persistent EXDEV that drove the '
    + 'write onto the fallback in the first place is invisible to the caller');
  /* Not asserted: on macOS the kernel's O_NOFOLLOW protects the victim whether or not
     our refusal exists, so the assertion could not fail and read as coverage. The
     TOCTOU arm below is the one that can. */
});

test('#1787: a fallback that fails carries WHY the atomic path was abandoned', () => {
  const f = fresh('cause-fallback');
  fs.writeFileSync(f, 'PREVIOUS');
  fs.chmodSync(f, 0o600);

  const realRename = fs.renameSync;
  const realWrite = fs.writeFileSync;
  fs.renameSync = () => { const e = new Error('forced cross-device'); e.code = 'EXDEV'; throw e; };
  /* Scoped to fd writes only, and the fallback's `writeFileSync(fd, data)` is the ONLY
     writeFileSync the module still makes (the atomic loop opens wx and writeSyncs; the
     restore writeSyncs through the fd), so this stub reaches exactly the call it means
     to. A blanket stub once broke the temp write too and failed the arm for an unrelated
     reason, the way three earlier arms on this branch passed with the fix reverted. */
  fs.writeFileSync = function (target, data, ...rest) {
    if (typeof target === 'number') { const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e; }
    return realWrite.call(fs, target, data, ...rest);
  };
  let caught = null;
  try { securewrite.writeSecret(f, 'NEW-SECRET', 0o600); } catch (e) { caught = e; } finally {
    fs.renameSync = realRename;
    fs.writeFileSync = realWrite;
  }

  assert.notEqual(caught, null, 'the forced failure did not fail, so nothing was tested');
  assert.equal(caught.code, 'ENOSPC', 'the fallback failed for a different reason than the one forced');
  assert.equal(caught.cause && caught.cause.code, 'EXDEV',
    'the fallback error was thrown with no cause, so the reason the atomic path was '
    + 'abandoned is lost behind it -- which is the case the comment at that site describes');
});

test('#1787: CONTROLS for the refusal, so it is not refusing everything', () => {
  const plain = fresh('plain');
  fs.writeFileSync(plain, 'x');
  assert.doesNotThrow(() => securewrite.refuseSymlinkTarget(plain, undefined),
    'a plain file was refused');
  assert.doesNotThrow(() => securewrite.refuseSymlinkTarget(fresh('absent'), undefined),
    'an absent path was refused, but there is nothing there to follow');
  const link = fresh('linked2');
  fs.symlinkSync(fresh('anything'), link);
  assert.doesNotThrow(() => securewrite.refuseSymlinkTarget(link, 256),
    'the check ran even though a real O_NOFOLLOW was passed, which is the kernel\'s job');
});

/* 🛑 A FAILED WRITE MUST NOT DESTROY WHAT IT FAILED TO REPLACE. The fallback opens
   with O_TRUNC, so the target is EMPTY from the moment of the open; a write that
   then fails leaves nothing. ENOSPC is both the realistic reason that write fails
   and a realistic reason the atomic path failed, so they are correlated. */
test('#1787: a failed fallback preserves the previous contents', () => {
  const f = fresh('preserve');
  fs.writeFileSync(f, 'PREVIOUS-SECRET');
  fs.chmodSync(f, 0o600);

  const realRename = fs.renameSync;
  const realWrite = fs.writeFileSync;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  fs.writeFileSync = function (target, ...rest) {
    if (typeof target === 'number') { const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e; }
    return realWrite.call(fs, target, ...rest);
  };
  let threw = false;
  try { securewrite.writeSecret(f, 'NEW', 0o600); } catch { threw = true; } finally {
    fs.renameSync = realRename;
    fs.writeFileSync = realWrite;
  }

  assert.equal(threw, true, 'the forced failure did not fail, so nothing was tested');
  assert.equal(fs.readFileSync(f, 'utf8'), 'PREVIOUS-SECRET',
    'a failed write destroyed the secret it failed to replace');
});

/* The atomic path must not leave its scratch file behind, in a directory that holds
   credentials and that an uninstall deliberately preserves. */
test('#1787: a successful write leaves no temp behind', () => {
  const d = fresh('tmpdir');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, 'secret');
  securewrite.writeSecret(f, 'SECRET', 0o600);
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.endsWith('.tmp')), [],
    'the write left its temp file in a credential directory');
  assert.deepEqual(fs.readdirSync(d), ['secret']);
});

/* ⚠️ NEVER DELETE A FILE WE DID NOT CREATE. `wx` means a pre-existing file at the
   temp path makes the write throw, and unlinking then would destroy somebody else's
   file. The retry uses a fresh name instead, which is what keeps the destructive
   fallback essentially unreachable. */
test('#1787: a planted file at a temp path is never deleted, and the write still succeeds', () => {
  const d = fresh('planted');
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, 'secret');

  let planted = null;
  const realOpen = fs.openSync;
  fs.openSync = function (target, flags, ...rest) {
    if (typeof target === 'string' && target.endsWith('.tmp') && flags === 'wx' && planted === null) {
      planted = target;
      fs.writeFileSync(target, 'SOMEBODY ELSE FILE');
      /* Then the REAL wx open, which the kernel refuses with EEXIST. */
    }
    return realOpen.call(fs, target, flags, ...rest);
  };
  try { securewrite.writeSecret(f, 'SECRET', 0o600); } finally { fs.openSync = realOpen; }

  assert.notEqual(planted, null, 'no temp write was attempted, so this arm proves nothing');
  assert.equal(fs.existsSync(planted), true, 'the writer deleted a file it did not create');
  assert.equal(fs.readFileSync(planted, 'utf8'), 'SOMEBODY ELSE FILE',
    'the writer overwrote a file it did not create');
  assert.equal(fs.readFileSync(f, 'utf8'), 'SECRET', 'the retry did not complete the write');
});

/* 🛑 THE CALL, NOT THE BODY. The symlink arm above calls `refuseSymlinkTarget`
   DIRECTLY, which guards the function and says nothing about whether `writeSecret`
   still invokes it. Measured: deleting the call from the fallback left this file
   fully green at 8/8 while `sendertoken.test.js` went red, so the guard for the
   invocation lived only in a consumer. That is precisely the #1776 shape this file's
   header cites, reproduced inside the file written to prevent it.
   ⭐ On macOS the kernel refuses via `O_NOFOLLOW` with ELOOP whether or not our call
   is there, so the SENTENCE is the guard: ours says so in words, the kernel's does
   not. An `assert.throws` with no message matcher would pass either way. */
test('#1787: writeSecret CALLS the refusal on its fallback, not merely defines it', () => {
  const victim = fresh('call-victim');
  fs.writeFileSync(victim, 'ORIGINAL');
  const link = fresh('call-linked');
  fs.symlinkSync(victim, link);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the symlink was not planted');

  const realRename = fs.renameSync;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  let err = null;
  try { securewrite.writeSecret(link, 'SECRET', 0o600); } catch (e) { err = e; } finally {
    fs.renameSync = realRename;
  }

  assert.notEqual(err, null, 'the forced fallback did not throw, so nothing was tested');
  assert.match(String(err.message), /refusing to write a secret through a symlink/,
    'the refusal came from the kernel, not from our call: on win32 there is no kernel '
    + 'to refuse, so this path would follow the symlink');
  /* Not asserted: same reason as the two arms above, the kernel protects the victim on
     this platform whether or not our call is there. The SENTENCE is the guard here. */
});

/* 🛑 THE CHMOD ON THE TEMP MUST NOT BE FATAL, and counting ATTEMPTS is the only way
   to see it. Both shapes end at the right mode, because a fatal chmod just costs an
   attempt and the retry succeeds. What the wrap changes is whether the FIRST attempt
   survives, so that is what this counts. */
// kosmos#8378: the retry count runs on Windows too (the fchmod stub fires there as well); only the mode lines are POSIX.
test('#1787: a chmod failure on the temp costs ZERO retries, because it is not fatal', () => {
  const f = fresh('chmod-eperm');
  fs.writeFileSync(f, 'OLD');
  if (!WIN) fs.chmodSync(f, 0o644);

  let temps = 0;
  const realOpen = fs.openSync;
  const realFchmod = fs.fchmodSync;
  fs.openSync = function (target, flags, ...rest) {
    if (typeof target === 'string' && target.endsWith('.tmp') && flags === 'wx') temps += 1;
    return realOpen.call(fs, target, flags, ...rest);
  };
  /* The temp is chmodded on its fd now (no path to swap under it), so the failure is
     planted on fchmodSync. The atomic path succeeds here, so the fallback's own
     fchmod is never reached and the stub cannot fire twice for two reasons. */
  fs.fchmodSync = function () {
    const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e;
  };
  try { securewrite.writeSecret(f, 'SECRET', 0o600); } finally {
    fs.openSync = realOpen;
    fs.fchmodSync = realFchmod;
  }

  assert.equal(temps, 1,
    `a chmod failure on the temp cost ${temps} attempts: it is best effort like the `
    + 'other two chmods, so it must not abandon the atomic path');
  if (!WIN) assert.equal(modeOf(f), 0o600, 'the pre-existing loose file was left loose');
  assert.equal(fs.readFileSync(f, 'utf8'), 'SECRET');
});

/* 🛑 THE FALLBACK MUST TIGHTEN BEFORE THE BYTES LAND, and no end-state assertion can
   see it: the file is 0600 either way. Catching it needs observation from INSIDE the
   write, and the fd is the first argument to `fs.writeFileSync`, so a stub can read
   `fs.fstatSync(fd).mode` at the instant the bytes land.
   ⚠️ A two-line swap renders as a ONE-LINE git diff and reads like a comment change,
   so confirm the region rather than trusting the diff shape. */
test('#1787: the fallback tightens BEFORE the bytes land, observed from inside the write', { skip: NO_POSIX_MODES }, () => {
  const f = fresh('fb-order');
  fs.writeFileSync(f, 'OLD');
  fs.chmodSync(f, 0o644);
  assert.equal(modeOf(f), 0o644, 'the loose plant did not take, so this arm would pass without the fix');

  let observed = null;
  const realRename = fs.renameSync;
  const realWrite = fs.writeFileSync;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  fs.writeFileSync = function (target, data, opts) {
    if (typeof target === 'number' && observed === null) observed = fs.fstatSync(target).mode & 0o777;
    return realWrite.call(fs, target, data, opts);
  };
  try { securewrite.writeSecret(f, 'SECRET', 0o600); } finally {
    fs.renameSync = realRename;
    fs.writeFileSync = realWrite;
  }

  assert.notEqual(observed, null, 'the fallback never wrote through an fd, so this arm proves nothing');
  assert.equal(observed, 0o600,
    `the secret bytes landed while the file was still 0${(observed || 0).toString(8)}: `
    + 'the fallback chmodded AFTER the write, which is the exact defect this module exists for');
});

/* 🛑 WHEN THE OPEN ITSELF FAILS, NOTHING WAS TRUNCATED, SO THERE MUST BE NO RESTORE.
   The restore used to be gated on `wrote`, which is true in that case too, and it was
   a bare `writeFileSync(file, prior)` with no `O_NOFOLLOW` and no symlink refusal. A
   link planted at `file` after the check, or present on win32 where the hand check is
   the only defence, would have made the RECOVERY write the previous secret through it
   and chmod the victim to 0600: the exact write this module refuses, reached through
   error handling.
   ⭐ The observable is that no PATH-ADDRESSED write to the target happens at all. An
   assertion about the file's contents cannot see it, because on this platform the
   restore would put back the same bytes that are already there.
   📌 SCOPE, measured at iteration 12: with the restore now fd-addressed, re-gating it
   on `wrote` no longer reddens this arm (a null fd throws inside the swallowed try),
   so this arm does NOT guard that gate. It guards against a PATH write being added
   back to the recovery, which is the defect the prose above describes. */
test('#1787: a failed OPEN performs no path-addressed restore write', () => {
  const f = fresh('noopen');
  fs.writeFileSync(f, 'PREVIOUS-SECRET');
  fs.chmodSync(f, 0o600);

  const realRename = fs.renameSync;
  const realOpen = fs.openSync;
  const realWrite = fs.writeFileSync;
  let pathWritesToTarget = 0;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  /* ⚠️ THROW ONLY FOR THE FALLBACK'S OWN OPEN. A blanket `openSync` stub also breaks
     `fs.readFileSync`, so `prior` comes back null and the restore never runs at all:
     the arm then passes for the wrong reason, measuring an absent restore rather than
     a gated one. Second effect from one stub, which is the fixture defect this branch
     has now hit three times. `O_TRUNC` is only on the fallback's write open. */
  fs.openSync = function (target, flags, ...rest) {
    if ((flags & fs.constants.O_TRUNC) !== 0) {
      const e = new Error('simulated open failure'); e.code = 'ELOOP'; throw e;
    }
    return realOpen.call(fs, target, flags, ...rest);
  };
  fs.writeFileSync = function (target, ...rest) {
    if (target === f) pathWritesToTarget += 1;
    return realWrite.call(fs, target, ...rest);
  };
  let threw = false;
  try { securewrite.writeSecret(f, 'NEW', 0o600); } catch { threw = true; } finally {
    fs.renameSync = realRename;
    fs.openSync = realOpen;
    fs.writeFileSync = realWrite;
  }

  assert.equal(threw, true, 'the forced open failure did not throw, so nothing was tested');
  assert.equal(pathWritesToTarget, 0,
    `the recovery made ${pathWritesToTarget} path-addressed write(s) to the target after `
    + 'the open failed: nothing had been truncated, so there was nothing to restore, and '
    + 'a path write there has no symlink refusal');
  assert.equal(fs.readFileSync(f, 'utf8'), 'PREVIOUS-SECRET', 'the previous secret was lost');
});

/* 🛑 THE PARTIAL-WRITE CASE, WHICH THE ARM ABOVE CANNOT SEE. That one throws on the
   FIRST fd write, so the descriptor's offset is still 0 and a restore that ignores
   position happens to land correctly. ENOSPC mid-write is the realistic trigger and
   it leaves the offset PAST the bytes already written; `ftruncateSync(fd, 0)` does
   not rewind it.
   ⭐ Measured before this arm existed: an 8-byte partial write, then truncate, then a
   position-less restore put the secret after EIGHT NUL BYTES. For `sendertoken` that
   file is JSON, so it stops parsing and every live token is lost, which is the exact
   outcome the restore exists to prevent. It was also a REGRESSION against main, whose
   path-addressed restore always started at zero. */
test('#1787: a fallback that fails PART WAY through still restores the previous bytes exactly', () => {
  const f = fresh('partial');
  fs.writeFileSync(f, 'PREVIOUS-SECRET-EXACTLY');
  fs.chmodSync(f, 0o600);
  const prior = fs.readFileSync(f);

  const realRename = fs.renameSync;
  const realWrite = fs.writeFileSync;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  fs.writeFileSync = function (target, data, ...rest) {
    if (typeof target === 'number') {
      /* Write SOME of it, moving the descriptor's offset, then fail: this is what a
         disk filling up mid-write does, and it is the case the sibling arm skips. */
      fs.writeSync(target, Buffer.from('12345678'));
      const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e;
    }
    return realWrite.call(fs, target, data, ...rest);
  };
  let threw = false;
  try { securewrite.writeSecret(f, 'NEW-SECRET', 0o600); } catch { threw = true; } finally {
    fs.renameSync = realRename;
    fs.writeFileSync = realWrite;
  }

  assert.equal(threw, true, 'the forced failure did not fail, so nothing was tested');
  const after = fs.readFileSync(f);
  assert.equal(after.length, prior.length,
    `the restore wrote ${after.length} bytes where the previous secret was ${prior.length}: `
    + 'the descriptor offset was not reset, so the secret landed after the partial write');
  assert.equal(after.toString(), prior.toString(),
    'the restored bytes are not the previous secret');
  assert.equal(after[0], prior[0], 'the restore is NUL-prefixed');
});

/* ==========================================================================
   ITERATION 9: THE THREE MUTATIONS THAT REDDENED NOTHING.
   A mutation battery over this module found eight behaviours the suite sees and
   three it cannot: drop O_NOFOLLOW from the fallback open, restore through a PATH
   instead of the descriptor, and drop `mode` from secureDir's mkdir. The first two
   are the module's two symlink defences. Each arm below was measured red BY NAME
   against exactly that mutation and green against the shipped code.
   ========================================================================== */

/* The ordering in the fallback is: path check, then readFileSync(prior), then the
   open. So a symlink planted from INSIDE readFileSync lands after the path check has
   passed and before the open: a real TOCTOU, and `O_NOFOLLOW` is the only defence
   left. The kernel refuses with ELOOP; without the flag it follows the link, fchmods
   the VICTIM to 0600 and writes the new secret into it. Both are observable. */
test('#1787: the fallback OPEN refuses a symlink swapped in AFTER the path check, which only O_NOFOLLOW can do', (t) => {
  if (fs.constants.O_NOFOLLOW === undefined) { t.skip('no O_NOFOLLOW on this platform; the path check is the only defence here'); return; }
  const f = fresh('toctou');
  fs.writeFileSync(f, 'PREVIOUS');
  fs.chmodSync(f, 0o600);
  const victim = fresh('toctou-victim');
  fs.writeFileSync(victim, 'VICTIM-BYTES');
  fs.chmodSync(victim, 0o644);

  const realRename = fs.renameSync;
  const realRead = fs.readFileSync;
  let swapped = false;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  fs.readFileSync = function (target, ...rest) {
    const out = realRead.call(fs, target, ...rest);
    if (target === f && !swapped) {
      /* After the read, so `prior` is real and the restore path stays live too. */
      fs.unlinkSync(f);
      fs.symlinkSync(victim, f);
      swapped = true;
    }
    return out;
  };
  let caught = null;
  try { securewrite.writeSecret(f, 'NEW-SECRET', 0o600); } catch (e) { caught = e; } finally {
    fs.renameSync = realRename;
    fs.readFileSync = realRead;
  }

  assert.equal(swapped, true, 'the symlink was never planted, so nothing was tested');
  assert.notEqual(caught, null, 'the write through a swapped-in symlink SUCCEEDED');
  assert.equal(caught.code, 'ELOOP',
    `refused with ${caught.code}, not the kernel's ELOOP: the path check cannot have seen a link `
    + 'planted after it ran, so this is not the O_NOFOLLOW refusal');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM-BYTES',
    'the new secret was written THROUGH the swapped-in link into the victim');
  assert.equal(modeOf(victim), 0o644, 'the victim was fchmod-ed to 0600 through the followed link');
});

/* The restore must go through the descriptor the open proved was not a link. A
   path-addressed restore can be redirected by a link swapped in AFTER the open: the
   previous secret then lands in the victim, and the real inode stays truncated. The
   swap happens from inside the failing write, which is the realistic moment: the
   file is open and empty, the process is mid-failure. A hard link keeps the original
   inode reachable by name so the arm can read what the descriptor wrote. */
test('#1787: the restore writes through the DESCRIPTOR, so a link swapped in after the open cannot redirect the previous secret', () => {
  const f = fresh('restore-fd');
  fs.writeFileSync(f, 'PREVIOUS-SECRET');
  fs.chmodSync(f, 0o600);
  const victim = fresh('restore-victim');
  fs.writeFileSync(victim, 'VICTIM-BYTES');
  const kept = fresh('restore-kept'); // will hard-link the original inode

  const realRename = fs.renameSync;
  const realWrite = fs.writeFileSync;
  let swapped = false;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  fs.writeFileSync = function (target, ...rest) {
    if (typeof target === 'number') {
      fs.linkSync(f, kept);      // the open inode keeps a name
      fs.unlinkSync(f);
      fs.symlinkSync(victim, f); // the PATH now points elsewhere
      swapped = true;
      const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e;
    }
    return realWrite.call(fs, target, ...rest);
  };
  let threw = false;
  try { securewrite.writeSecret(f, 'NEW-SECRET', 0o600); } catch { threw = true; } finally {
    fs.renameSync = realRename;
    fs.writeFileSync = realWrite;
  }

  assert.equal(swapped, true, 'the swap never happened, so nothing was tested');
  assert.equal(threw, true, 'the forced failure did not fail');
  assert.equal(fs.readFileSync(kept, 'utf8'), 'PREVIOUS-SECRET',
    'the restore did not reach the inode the descriptor was open on: the previous secret is gone from it');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM-BYTES',
    'the restore was PATH-addressed and wrote the previous secret through the swapped-in link into the victim');
});

/* A directory created loose and tightened afterwards is the directory-shaped twin of
   the defect this module exists for: for the length of the window it lists the
   credential filenames to everybody. The end state is 0700 either way, so the arm
   observes the mode AT THE MOMENT chmod is called, before chmod applies. */
test('#1787: secureDir creates the directory AT the mode, not loose and then tightened', { skip: NO_POSIX_MODES }, () => {
  const d = fresh('dir-at-mode');
  const realChmod = fs.chmodSync;
  let seenAtChmod = null;
  fs.chmodSync = function (target, ...rest) {
    if (target === d && seenAtChmod === null) seenAtChmod = modeOf(d);
    return realChmod.call(fs, target, ...rest);
  };
  try { securewrite.secureDir(d, 0o700); } finally { fs.chmodSync = realChmod; }

  const expected = 0o700 & ~process.umask();
  assert.notEqual(seenAtChmod, null, 'chmod was never called on the directory, so the window was not observed');
  assert.equal(seenAtChmod, expected,
    `the directory sat at ${seenAtChmod.toString(8)} before the chmod tightened it; mkdir was asked for `
    + `no mode, so it was created at the umask default and every name in it was listable meanwhile`);
  assert.equal(modeOf(d), 0o700, 'CONTROL: the end state is not 0700, so the arm above is measuring the wrong thing');
});

/* Finding from the iteration-8 read half: create and write were ONE call and the
   `created` flag flipped after it, so a write that failed after the create (ENOSPC
   mid-write) left the temp behind, three times per call, each holding the first
   bytes of the NEW secret at 0600, and then the fallback succeeded so the caller saw
   a clean write. The module's header said litter needed a process death; it did not.
   The stub lands four real bytes on the temp's fd and then throws, which is what a
   full disk does. */
test('#1787: a temp whose write fails part way is removed, not left holding the new secret', () => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'partial-temp-'));
  const f = path.join(dir, 'secret');
  fs.writeFileSync(f, 'PREVIOUS');
  fs.chmodSync(f, 0o600);

  const realOpen = fs.openSync;
  const realWriteSync = fs.writeSync;
  const realClose = fs.closeSync;
  /* Descriptor NUMBERS are reused: all three temps and then the fallback's own open
     landed on the same fd, so a set that never forgets sabotaged the fallback too. The
     fd leaves the set when it is closed. */
  const tempFds = new Set();
  let creates = 0;
  fs.openSync = function (target, flags, ...rest) {
    const fd = realOpen.call(fs, target, flags, ...rest);
    if (typeof target === 'string' && target.includes('.kosmos-') && flags === 'wx') { tempFds.add(fd); creates += 1; }
    return fd;
  };
  fs.closeSync = function (fd, ...rest) { tempFds.delete(fd); return realClose.call(fs, fd, ...rest); };
  fs.writeSync = function (fd, buf, ...rest) {
    if (tempFds.has(fd)) {
      realWriteSync.call(fs, fd, Buffer.from('NEW-'));
      const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e;
    }
    return realWriteSync.call(fs, fd, buf, ...rest);
  };
  let outcome = 'returned';
  try { securewrite.writeSecret(f, 'NEW-SECRET', 0o600); } catch (e) { outcome = 'threw ' + e.code; } finally {
    fs.openSync = realOpen;
    fs.writeSync = realWriteSync;
    fs.closeSync = realClose;
  }

  assert.equal(creates, 3, `the atomic path made ${creates} temp(s), not three: the stub missed the create and this arm measured nothing`);
  const left = fs.readdirSync(dir).filter((n) => n.includes('.kosmos-'));
  assert.deepEqual(left, [],
    `${left.length} temp(s) left behind after a write that failed part way (outcome: ${outcome}): each holds the `
    + 'first bytes of the NEW secret, and nothing will ever remove them');
});

/* Iteration 12: the temp's fchmod was guarded only through sendertoken's umask arm,
   which is the consumer-attached coverage this file's header exists to remove. Under a
   restrictive umask the wx create lands at mode 0 (measured: umask 0600 -> 0), and the
   fchmod on the fd is what makes the secret readable by its owner at all. Red by name
   with that fchmod deleted. */
test('#1787: under a restrictive umask the temp is tightened to the requested mode before the rename, in this file', { skip: NO_POSIX_MODES }, () => {
  const f = fresh('umask');
  const prev = process.umask(0o600);
  try {
    securewrite.writeSecret(f, 'SECRET', 0o600);
  } finally { process.umask(prev); }
  assert.equal(modeOf(f), 0o600,
    `the secret landed at 0${modeOf(f).toString(8)} under umask 0600: the fchmod on the temp's fd is what restores the owner bits the umask cleared, and nothing else does`);
  assert.equal(fs.readFileSync(f, 'utf8'), 'SECRET', 'the write did not complete');
});

/* Iteration 12: the write loop refuses a zero-byte write and nothing pinned it. The
   harm of a silent `break` is not the missing bytes, it is that the EMPTY temp is then
   renamed over the previous secret. With the throw, the attempt fails, the temp is
   unlinked, and the fallback writes the whole secret. Red by name with throw -> break. */
test('#1787: a write that lands nothing is not renamed over the secret', () => {
  const f = fresh('zero-write');
  fs.writeFileSync(f, 'PREVIOUS');
  fs.chmodSync(f, 0o600);
  const realOpen = fs.openSync;
  const realWriteSync = fs.writeSync;
  const realClose = fs.closeSync;
  const tempFds = new Set();
  fs.openSync = function (target, flags, ...rest) {
    const fd = realOpen.call(fs, target, flags, ...rest);
    if (typeof target === 'string' && target.includes('.kosmos-') && flags === 'wx') tempFds.add(fd);
    return fd;
  };
  fs.closeSync = function (fd, ...rest) { tempFds.delete(fd); return realClose.call(fs, fd, ...rest); };
  fs.writeSync = function (fd, ...rest) { return tempFds.has(fd) ? 0 : realWriteSync.call(fs, fd, ...rest); };
  let outcome = 'returned';
  try { securewrite.writeSecret(f, 'NEW-SECRET', 0o600); } catch (e) { outcome = 'threw ' + e.code; } finally {
    fs.openSync = realOpen;
    fs.writeSync = realWriteSync;
    fs.closeSync = realClose;
  }
  const after = fs.readFileSync(f, 'utf8');
  assert.notEqual(after, '', `an EMPTY temp was renamed over the secret (outcome: ${outcome}): a zero-byte write was treated as done`);
  assert.ok(after === 'NEW-SECRET' || after === 'PREVIOUS', 'the target holds neither the new secret nor the previous one: ' + JSON.stringify(after));
});

/* ── #1793: the orphan-temp reaper ──────────────────────────────────────────
   A death between the `wx` create and the rename leaves `<file>.kosmos-<pid>-
   <started>-<seq>.tmp` holding the secret, which `forget()` never removes. The
   reaper runs from `writeSecret`, once per target directory per process, and
   deletes only a temp it can PROVE is dead. Each arm below uses its OWN fresh
   directory, because the reaper is once-per-dir-per-process and a shared dir
   would let the first arm's sweep suppress the rest. */
const childProcess = require('node:child_process');
const reapDir = () => fs.mkdtempSync(path.join(SANDBOX, 'reap-'));
const plantTemp = (dir, base, pid, started, seq) => {
  const p = path.join(dir, `${base}.kosmos-${pid}-${started}-${seq}.tmp`);
  fs.writeFileSync(p, 'STALE-SECRET', { mode: 0o600 });
  return p;
};

test('#1793: a temp from OUR pid but a PRIOR run (different started) is reaped', () => {
  /* Deterministic: our own pid with a `started` of 1 cannot be this run, whose
     STARTED is Date.now(). We are the only "us", so it is certainly stale.
     Revert the `reapOrphanTemps(...)` call in writeSecret and this goes red. */
  const dir = reapDir();
  const orphan = plantTemp(dir, 'sender-token', process.pid, 1, 7);
  assert.ok(fs.existsSync(orphan), 'the plant did not take, so this arm proves nothing');
  securewrite.writeSecret(path.join(dir, 'sender-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(orphan), false,
    'a temp left by a PRIOR run of this process outlived a later write, so a revoked secret can persist');
});

test('#1793: a temp from a DEAD foreign pid is reaped', () => {
  /* A short-lived child, awaited to completion, gives a pid that is now gone.
     `process.kill(pid,0)` throws ESRCH for it, so the reaper takes its orphan. */
  const dead = childProcess.spawnSync(process.execPath, ['-e', '0']).pid;
  let isDead = false;
  try { process.kill(dead, 0); } catch (e) { isDead = e.code === 'ESRCH'; }
  assert.ok(isDead, `pid ${dead} was reused before the assertion, environment too busy; re-run`);
  const dir = reapDir();
  const orphan = plantTemp(dir, 'cf-token', dead, Date.now() - 5000, 1);
  assert.ok(fs.existsSync(orphan), 'the plant did not take');
  securewrite.writeSecret(path.join(dir, 'cf-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(orphan), false, 'a dead process\'s orphan temp was not reaped');
});

test('#1793 SAFETY: a temp from a LIVE foreign pid is LEFT, never taken', (t) => {
  /* 🛑 THE RACE THE GLOB WOULD HAVE CREATED. pid 1 (launchd) is always alive and
     foreign; `process.kill(1,0)` throws EPERM (alive, not ours), which is NOT
     ESRCH, so the reaper must leave it. If it took this it could take a
     concurrent writer's in-flight temp between that writer's create and rename.
     This arm stays green when the fix is reverted (nothing is reaped either way);
     it reddens if the predicate is ever widened to delete a live pid's temp. */
  /* kosmos#8378: Windows has no pid 1, so there `process.kill(1,0)` throws ESRCH and the
     plant is a dead pid's temp, which is rightly reaped. There the live foreign pid is a
     child of ours that stays running (kill(pid,0) succeeds: alive), the other arm of
     the same predicate. */
  let livePid = 1;
  if (process.platform === 'win32') {
    const child = childProcess.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    t.after(() => child.kill());
    assert.ok(Number.isInteger(child.pid), 'the live-writer child did not start');
    livePid = child.pid;
  }
  const dir = reapDir();
  const live = plantTemp(dir, 'gh-token', livePid, Date.now() - 5000, 1);
  assert.ok(fs.existsSync(live), 'the plant did not take');
  securewrite.writeSecret(path.join(dir, 'gh-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(live), true,
    'a LIVE foreign process\'s in-flight temp was deleted: the reaper can take a concurrent writer\'s temp');
});

test('#1793 SAFETY: a real credential file is NEVER touched, and the ANCHOR is what protects it', () => {
  /* 🛑 The regex is anchored to `.kosmos-<pid>-t<threadId>-<started>-<seq>.tmp`. A
     credential file lacks that anchor. To pin the ANCHOR specifically rather than
     the numeric-parse backstop, the sibling here is a plausible credential whose
     name ENDS IN DIGITS that WOULD parse to a real DEAD pid if the anchor were
     dropped, so loosening the regex reaps it and this reddens. An earlier version
     used a no-digit name (`other-provider-token`), which a widened regex leaves
     alone via `pid = Number(undefined) = NaN`, so it could not bite - found by a
     blind pass. Mutation that must redden this: drop the `.kosmos`/`.tmp` anchors
     from TEMP_RE (e.g. `/-(\d+)-(?:t(\d+)-)?(\d+)-\d+$/`). */
  const dead = childProcess.spawnSync(process.execPath, ['-e', '0']).pid;
  let isDead = false;
  try { process.kill(dead, 0); } catch (e) { isDead = e.code === 'ESRCH'; }
  assert.ok(isDead, `pid ${dead} was reused; re-run`);
  const dir = reapDir();
  /* Digits that parse to a DEAD pid, but no `.kosmos-` prefix and no `.tmp` suffix. */
  const sibling = path.join(dir, `provider-token-${dead}-1-1`);
  fs.writeFileSync(sibling, 'A-REAL-SECRET', { mode: 0o600 });
  const orphan = plantTemp(dir, 'gh-token', dead, Date.now() - 5000, 1);
  securewrite.writeSecret(path.join(dir, 'gh-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(orphan), false, 'the dead orphan was not reaped');
  assert.equal(fs.existsSync(sibling), true, 'a credential lacking the .kosmos/.tmp anchor was deleted: the anchor is not what protects it');
  assert.equal(fs.readFileSync(sibling, 'utf8'), 'A-REAL-SECRET', 'the sibling credential was altered');
});

test('#1793: the reaper does not break the write it runs before', () => {
  /* It runs at the top of writeSecret, before this call\'s own temp exists, and
     the write must still land its secret whether or not anything was reaped. */
  const dir = reapDir();
  plantTemp(dir, 'sender-token', process.pid, 1, 3);
  const target = path.join(dir, 'sender-token');
  securewrite.writeSecret(target, 'THE-NEW-SECRET', 0o600);
  assert.equal(fs.readFileSync(target, 'utf8'), 'THE-NEW-SECRET', 'the write did not land after the reap');
  // kosmos#8378: Windows keeps no POSIX modes (a file reads 0666 there), so only the write is checked there.
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'the written secret is not private');
});

test('#1793 SAFETY: a same-pid temp from a DIFFERENT thread is LEFT (worker_threads)', () => {
  /* 🛑 process.pid is SHARED across worker_threads. A live sibling worker mid-write
     has OUR pid but its own threadId and STARTED. Without threadId in the identity,
     the main thread reads it as "a prior run of us" and deletes a LIVE writer's temp
     - the concurrent-writer race this reaper exists to avoid. The `t1` marks a thread
     that is not this one (the suite runs on the main thread, threadId 0), so it must
     be LEFT. Revert the identity to `started !== STARTED` (dropping the threadId
     check) and this reddens. */
  const dir = reapDir();
  const sibling = path.join(dir, `sender-token.kosmos-${process.pid}-t1-${Date.now() - 1000}-1.tmp`);
  fs.writeFileSync(sibling, 'A-LIVE-SIBLING-WORKERS-IN-FLIGHT-SECRET', { mode: 0o600 });
  securewrite.writeSecret(path.join(dir, 'sender-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(sibling), true,
    'a same-pid temp from a DIFFERENT thread was deleted: a live worker\'s in-flight temp can be taken');
});

test('#1793: an OLD-format temp (no thread segment) from a prior run is still reaped', () => {
  /* Back-compat: a temp a prior release wrote as `<file>.kosmos-<pid>-<started>-<seq>
     .tmp` (no `t` segment) is read as thread 0. On the main thread that is us, so a
     prior run's old-format temp is still reclaimed rather than leaking forever. */
  const dir = reapDir();
  const old = path.join(dir, `cf-token.kosmos-${process.pid}-1-9.tmp`);
  fs.writeFileSync(old, 'OLD-FORMAT-STALE', { mode: 0o600 });
  securewrite.writeSecret(path.join(dir, 'cf-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(old), false, 'an old-format prior-run temp was not reaped, so it would leak forever');
});

/* #5434 slice 2: reapDeadTempsOf(file) removes ONE file's temps by the reaper's proof of death, on
   every call. Direct arms, so its coverage does not hang on the account stores calling it. */
test('#5434: reapDeadTempsOf takes a dead writer\'s and a prior run\'s temp of that file, and nothing else', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-reapof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const DEAD = 2147483646;
  assert.throws(() => process.kill(DEAD, 0), (e) => e.code === 'ESRCH');
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => child.kill());
  assert.ok(Number.isInteger(child.pid), 'the live-writer child did not start');
  const file = path.join(dir, 'token');
  const names = {
    deadForeign: `token.kosmos-${DEAD}-t0-1-1.tmp`,
    priorRunOfUs: `token.kosmos-${process.pid}-t0-1-1.tmp`,          // our pid, main thread, another STARTED
    oldFormatDead: `token.kosmos-${DEAD}-1-1.tmp`,                    // a prior release's name (no t segment)
    liveForeign: `token.kosmos-${child.pid}-t0-1-1.tmp`,
    otherThreadOfUs: `token.kosmos-${process.pid}-t7-1-1.tmp`,        // may be a live sibling thread
    otherFileDead: `other.kosmos-${DEAD}-t0-1-1.tmp`,                 // a different file's temp
    notATemp: 'token.tmp',
    siblingNamedLikeATemp: `token.kosmos-x.kosmos-${DEAD}-t0-1-1.tmp`,   // a temp of the file "token.kosmos-x"
  };
  for (const n of Object.values(names)) fs.writeFileSync(path.join(dir, n), 'x');
  fs.writeFileSync(file, 'secret');
  securewrite.reapDeadTempsOf(file);
  const left = new Set(fs.readdirSync(dir));
  for (const k of ['deadForeign', 'priorRunOfUs', 'oldFormatDead']) assert.equal(left.has(names[k]), false, k + ' was left');
  for (const k of ['liveForeign', 'otherThreadOfUs', 'otherFileDead', 'notATemp', 'siblingNamedLikeATemp']) assert.equal(left.has(names[k]), true, k + ' was taken');
  assert.equal(fs.readFileSync(file, 'utf8'), 'secret', 'the file itself was touched');
  // Every call, not once per folder: a second dead temp after the first reap is still taken.
  fs.writeFileSync(path.join(dir, names.deadForeign), 'x');
  securewrite.reapDeadTempsOf(file);
  assert.equal(fs.existsSync(path.join(dir, names.deadForeign)), false, 'the second call did nothing');
});

test('#5434: reapDeadTempsOf never throws, even for a folder that does not exist', () => {
  assert.doesNotThrow(() => securewrite.reapDeadTempsOf(path.join(os.tmpdir(), 'no-such-folder-5434-' + process.pid, 'f')));
});

/* kosmos#9268: on Windows the create-exclusive open of the temp FOLLOWS a dangling link planted at its name (Node maps
   'wx' to CREATE_NEW, which follows a reparse point), so the open creates the link's target. A Mac refuses a link
   there, so this stands in for the Windows open: it plants the link, then opens the target exclusively, as
   CreateFile does. What must hold: nothing written through the link, the link left, and the save made at a fresh
   name. The same arm runs unstubbed on Windows as engine/trust.test.js's planted-link arm. */
test('#9268: an open that FOLLOWS a link planted at the temp name writes nothing through it, and saves at a fresh name', (t) => {
  const file = fresh('followed');
  const elsewhere = fresh('attacker');
  const realOpen = fs.openSync;
  let planted = null;
  let opens = 0;
  fs.openSync = function (p, flags, ...rest) {
    if (flags === 'wx' && String(p).includes('.kosmos-')) {
      opens += 1;
      if (planted === null) {
        planted = String(p);
        fs.symlinkSync(elsewhere, planted);
        return realOpen.call(fs, elsewhere, 'wx', ...rest);   // what CreateFile(CREATE_NEW) does on Windows
      }
    }
    return realOpen.call(fs, p, flags, ...rest);
  };
  t.after(() => { fs.openSync = realOpen; try { fs.rmSync(planted, { force: true }); fs.rmSync(elsewhere, { force: true }); } catch { /* fine */ } });
  securewrite.writeSecret(file, 'secret-9268', 0o600);
  fs.openSync = realOpen;
  assert.ok(planted, 'the plant never happened, so this tests nothing');
  assert.equal(fs.existsSync(elsewhere), false, 'the secret, or an empty file, was left where the planted link points');
  assert.equal(fs.lstatSync(planted).isSymbolicLink(), true, 'the planted link was removed, which is not ours to do');
  assert.equal(fs.readFileSync(file, 'utf8'), 'secret-9268', 'the save did not land');
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false, 'the saved file is a link');
  assert.equal(opens, 2, 'the save did not move to a fresh temp name after refusing the followed one');
});

/* kosmos#9268 review 1: the name swapped AFTER the open (the link replaced by an ordinary file). "Is the name a
   link now" would say no and write the secret through the fd to the link's target, then rename the planted file over
   the config. The check is "is the name the file this open made", so a swap between the open and the check is
   refused too (one after the check is the rename's own window; see refuseFollowedLink). */
test('#9268: a temp name swapped for another file after the open is refused, and neither the target nor the config gets the planted bytes', (t) => {
  const file = fresh('swapped');
  const elsewhere = fresh('attacker2');
  const realOpen = fs.openSync;
  let planted = null;
  fs.openSync = function (p, flags, ...rest) {
    if (planted === null && flags === 'wx' && String(p).includes('.kosmos-')) {
      planted = String(p);
      fs.symlinkSync(elsewhere, planted);
      const fd = realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link
      fs.unlinkSync(planted);
      fs.writeFileSync(planted, 'ATTACKER');                    // and the name is swapped before the check
      return fd;
    }
    return realOpen.call(fs, p, flags, ...rest);
  };
  t.after(() => { fs.openSync = realOpen; try { fs.rmSync(planted, { force: true }); fs.rmSync(elsewhere, { force: true }); } catch { /* fine */ } });
  securewrite.writeSecret(file, 'secret-9268b', 0o600);
  fs.openSync = realOpen;
  assert.ok(planted, 'the plant never happened, so this tests nothing');
  /* After a swap the file the open made has no name the writer can find, so it stays, empty (refuseFollowedLink's doc). */
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), '', 'the secret went through the fd to where the link pointed');
  assert.equal(fs.readFileSync(planted, 'utf8'), 'ATTACKER', 'the swapped-in file was moved or changed, which is not ours to do');
  assert.equal(fs.readFileSync(file, 'utf8'), 'secret-9268b', 'the planted file became the config, or the save did not land');
});

/* kosmos#9268 CONTROL: an ordinary save is NOT refused. The same-file check reads the open fd and the temp name;
   if they disagreed on an ordinary file (the Windows file index, say), every save would be refused and quietly take
   the in-place fallback. atomicOnly turns that into a throw, so this arm fails where the check is too strict. */
test('#9268 CONTROL: an ordinary save takes the atomic path (atomicOnly does not throw), with one open', () => {
  const file = fresh('ordinary');
  const realOpen = fs.openSync;
  let opens = 0;
  fs.openSync = function (p, flags, ...rest) {
    if (flags === 'wx' && String(p).includes('.kosmos-')) opens += 1;
    return realOpen.call(fs, p, flags, ...rest);
  };
  try { securewrite.writeSecret(file, 'plain-9268', 0o600, { atomicOnly: true }); }
  finally { fs.openSync = realOpen; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'plain-9268');
  assert.equal(opens, 1, 'an ordinary save was refused and retried at a fresh name');
});

/* kosmos#9268 review 2: the name swapped for a HARD link to the file the open made. Device and inode then match, so
   only the link count shows it: a second name for the config would keep the secret readable there. */
test('#9268: a temp name that is a second hard link to the opened file is refused, so the config gets no second name', (t) => {
  const file = fresh('hardlinked');
  const elsewhere = fresh('attacker3');
  const realOpen = fs.openSync;
  let planted = null;
  fs.openSync = function (p, flags, ...rest) {
    if (planted === null && flags === 'wx' && String(p).includes('.kosmos-')) {
      planted = String(p);
      fs.symlinkSync(elsewhere, planted);
      const fd = realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link
      fs.unlinkSync(planted);
      fs.linkSync(elsewhere, planted);                          // and the name becomes a second name for it
      return fd;
    }
    return realOpen.call(fs, p, flags, ...rest);
  };
  t.after(() => { fs.openSync = realOpen; try { fs.rmSync(planted, { force: true }); fs.rmSync(elsewhere, { force: true }); } catch { /* fine */ } });
  securewrite.writeSecret(file, 'secret-9268c', 0o600);
  fs.openSync = realOpen;
  assert.ok(planted, 'the plant never happened, so this tests nothing');
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), '', 'the secret was written into the file the attacker holds a name for');
  assert.equal(fs.readFileSync(file, 'utf8'), 'secret-9268c', 'the save did not land');
  assert.notEqual(fs.statSync(file).ino, fs.statSync(elsewhere).ino, 'the config is a second name of the attacker\'s file');
  assert.equal(fs.statSync(planted).ino, fs.statSync(elsewhere).ino, 'the planted second name was removed or replaced, which is not ours to do (kosmos#9285)');
});

/* kosmos#9268 review 3: the planted link is RE-POINTED after the open, at somebody's existing file. The cleanup must
   remove only the file the open made (same device and inode, still empty), so the other file keeps its bytes. */
test('#9268: a link re-pointed after the open at another file never gets that file removed', (t) => {
  const file = fresh('repointed');
  const elsewhere = fresh('attacker4');
  const theirs = fresh('theirs');
  fs.writeFileSync(theirs, 'their bytes');
  const realOpen = fs.openSync;
  let planted = null;
  fs.openSync = function (p, flags, ...rest) {
    if (planted === null && flags === 'wx' && String(p).includes('.kosmos-')) {
      planted = String(p);
      fs.symlinkSync(elsewhere, planted);
      const fd = realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link
      fs.unlinkSync(planted);
      fs.symlinkSync(theirs, planted);                          // and the link now points at somebody's file
      return fd;
    }
    return realOpen.call(fs, p, flags, ...rest);
  };
  t.after(() => { fs.openSync = realOpen; for (const p of [planted, elsewhere, theirs]) { try { fs.rmSync(p, { force: true }); } catch { /* fine */ } } });
  securewrite.writeSecret(file, 'secret-9268d', 0o600);
  fs.openSync = realOpen;
  assert.ok(planted, 'the plant never happened, so this tests nothing');
  assert.equal(fs.readFileSync(theirs, 'utf8'), 'their bytes', 'the cleanup removed or changed a file the open did not make');
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), '', 'the secret went through the fd to the file the open made');
  assert.equal(fs.readFileSync(file, 'utf8'), 'secret-9268d', 'the save did not land');
});

/* kosmos#9268 review 3: the name REMOVED after the open (and, separately, a folder put there). Neither is the file the
   fd holds. The removed arm pins the "gone" rule: without it the secret is written through the fd to where the link
   pointed, the rename then fails, and the loop retries, leaving the secret behind. The folder arm is a control for
   the refusal as a whole: the link-count or identity rule refuses a folder first, so it does not pin "not a regular
   file" (refuseFollowedLink's doc). */
for (const [label, swap] of [['removed', (p) => fs.unlinkSync(p)], ['replaced by a folder', (p) => { fs.unlinkSync(p); fs.mkdirSync(p); }]]) {
  test(`#9268: a temp name ${label} after the open is refused, and the secret never reaches where the link pointed`, (t) => {
    const file = fresh('gone');
    const elsewhere = fresh('attacker5');
    const realOpen = fs.openSync;
    let planted = null;
    fs.openSync = function (p, flags, ...rest) {
      if (planted === null && flags === 'wx' && String(p).includes('.kosmos-')) {
        planted = String(p);
        fs.symlinkSync(elsewhere, planted);
        const fd = realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link
        swap(planted);
        return fd;
      }
      return realOpen.call(fs, p, flags, ...rest);
    };
    t.after(() => { fs.openSync = realOpen; for (const p of [planted, elsewhere]) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* fine */ } } });
    securewrite.writeSecret(file, 'secret-9268e', 0o600);
    fs.openSync = realOpen;
    assert.ok(planted, 'the plant never happened, so this tests nothing');
    assert.equal(fs.readFileSync(elsewhere, 'utf8'), '', 'the secret went through the fd to where the link pointed');
    assert.equal(fs.readFileSync(file, 'utf8'), 'secret-9268e', 'the save did not land');
    // kosmos#9285: a planted folder is left as it was
    if (label === 'replaced by a folder') assert.equal(fs.lstatSync(planted).isDirectory(), true, 'the planted folder was removed or replaced');
  });
}

/* kosmos#9268 review 5: every attempt meets a followed link, and the caller asked for no in-place rewrite. It must get
   ERR_KOSMOS_TEMP_SWAPPED (not ERR_KOSMOS_SYMLINK, which callers read as "the config is a link"), its config must be
   left as it was, each refused open's fd closed exactly once, and the loop must have tried three fresh names. */
test('#9268: atomicOnly with a link followed at every attempt throws ERR_KOSMOS_TEMP_SWAPPED, leaves the config, and closes each refused fd once', (t) => {
  const file = fresh('allrefused');
  fs.writeFileSync(file, 'old config');
  const realOpen = fs.openSync;
  const realClose = fs.closeSync;
  const planted = [];
  const opened = [];   // one entry per refused open: { fd, closes } (a closed fd number is reused, so not keyed by it)
  fs.openSync = function (p, flags, ...rest) {
    if (flags === 'wx' && String(p).includes('.kosmos-')) {
      const elsewhere = fresh('attacker6');
      planted.push(String(p), elsewhere);
      fs.symlinkSync(elsewhere, String(p));
      const fd = realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link, every time
      opened.push({ fd, closes: 0 });
      return fd;
    }
    return realOpen.call(fs, p, flags, ...rest);
  };
  fs.closeSync = function (fd) {
    const open = opened.filter((o) => o.fd === fd).pop();   // the newest open of that number
    if (open) open.closes += 1;
    return realClose.call(fs, fd);
  };
  t.after(() => { fs.openSync = realOpen; fs.closeSync = realClose; for (const p of planted) { try { fs.rmSync(p, { force: true }); } catch { /* fine */ } } });
  let err = null;
  try { securewrite.writeSecret(file, 'secret-9268f', 0o600, { atomicOnly: true }); } catch (e) { err = e; }
  fs.openSync = realOpen; fs.closeSync = realClose;
  assert.ok(err, 'a write with every temp name refused did not throw');
  assert.equal(err.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'the refusal carries the wrong code');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old config', 'the config was changed');
  assert.equal(opened.length, 3, 'the loop did not try three fresh names');
  opened.forEach((o, i) => assert.equal(o.closes, 1, `refused open ${i + 1} was closed ${o.closes} times, not once`));
});

/* kosmos#9268 review 7: a different file renamed onto the made file's path after the fd is closed and before the
   cleanup's unlink. The unlink takes a path, so the cleanup checks the file again just before it; somebody's file put
   there must survive. */
test('#9268: a file renamed onto the made file\'s path after the close is never removed by the cleanup', (t) => {
  const file = fresh('renamedonto');
  const elsewhere = fresh('attacker7');
  const theirs = fresh('theirs7');
  const realOpen = fs.openSync;
  const realClose = fs.closeSync;
  let planted = null;
  let followedFd = null;
  fs.openSync = function (p, flags, ...rest) {
    if (planted === null && flags === 'wx' && String(p).includes('.kosmos-')) {
      planted = String(p);
      fs.symlinkSync(elsewhere, planted);
      followedFd = realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link
      return followedFd;
    }
    return realOpen.call(fs, p, flags, ...rest);
  };
  fs.closeSync = function (fd) {
    const r = realClose.call(fs, fd);
    if (fd === followedFd) {
      followedFd = null;
      fs.writeFileSync(theirs, 'their bytes');
      fs.renameSync(theirs, elsewhere);                           // somebody's file now sits at the made file's path
    }
    return r;
  };
  t.after(() => { fs.openSync = realOpen; fs.closeSync = realClose; for (const p of [planted, elsewhere, theirs]) { try { fs.rmSync(p, { force: true }); } catch { /* fine */ } } });
  securewrite.writeSecret(file, 'secret-9268g', 0o600);
  fs.openSync = realOpen; fs.closeSync = realClose;
  assert.ok(planted, 'the plant never happened, so this tests nothing');
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'their bytes', 'the cleanup removed a file the open did not make');
  assert.equal(fs.readFileSync(file, 'utf8'), 'secret-9268g', 'the save did not land');
});

/* kosmos#9285: a caller WITHOUT atomicOnly whose three atomic attempts all meet a followed link gets
   ERR_KOSMOS_TEMP_SWAPPED, and the in-place fallback is NOT taken: three refusals mean somebody is planting links, and
   on Windows the fallback has no O_NOFOLLOW, so it would hand them a race at the config. The config is left as it was,
   and none of the planted links' targets gets the secret. */
test('#9285: three followed links refuse an ordinary save too: no in-place fallback, the config left as it was', (t) => {
  const file = fresh('nofallback');
  fs.writeFileSync(file, 'old config');
  const realOpen = fs.openSync;
  const planted = [];
  const targets = [];
  let inPlace = 0;
  fs.openSync = function (p, flags, ...rest) {
    if (flags === 'wx' && String(p).includes('.kosmos-')) {
      const elsewhere = fresh('attacker8');
      planted.push(String(p)); targets.push(elsewhere);
      fs.symlinkSync(elsewhere, String(p));
      return realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link, every time
    }
    if (String(p) === file) inPlace += 1;                    // the in-place fallback opens the config itself
    return realOpen.call(fs, p, flags, ...rest);
  };
  t.after(() => { fs.openSync = realOpen; for (const p of [...planted, ...targets]) { try { fs.rmSync(p, { force: true }); } catch { /* fine */ } } });
  let err = null;
  try { securewrite.writeSecret(file, 'secret-9285', 0o600); } catch (e) { err = e; }
  fs.openSync = realOpen;
  assert.equal(planted.length, 3, 'the atomic path did not try three fresh names');
  assert.ok(err, 'three planted links did not refuse the save');
  assert.equal(err.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'the refusal carries the wrong code');
  assert.equal(err.cause && err.cause.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'the first swap is not the cause');
  assert.equal(err.lastAttempt && err.lastAttempt.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'the last attempt is not kept');
  assert.equal(err.planted, false, 'links only: the refusal is not marked a plant (kosmos#9307)');
  assert.equal(inPlace, 0, 'the in-place fallback opened the config');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old config', 'the config was changed');
  for (const tgt of targets) assert.equal(fs.existsSync(tgt) ? fs.readFileSync(tgt, 'utf8') : '', '', 'a planted link target got the secret');
});

/* kosmos#9285 review 2: the temp names are guessable, so somebody can plant links at two names and a plain file at the
   third. That third attempt failed with EEXIST, not as a swap (since kosmos#9307 it is a refusal too), and before this
   rule counted only swaps, two of three let the save reach the in-place fallback. Any swap among the failures must
   refuse it. */
test('#9285: links at two temp names and a plain file at the third still refuse the save, with no in-place fallback', (t) => {
  const file = fresh('mixed');
  fs.writeFileSync(file, 'old config');
  const realOpen = fs.openSync;
  const planted = [];
  const targets = [];
  let opens = 0;
  let inPlace = 0;
  fs.openSync = function (p, flags, ...rest) {
    if (flags === 'wx' && String(p).includes('.kosmos-')) {
      opens += 1;
      planted.push(String(p));
      if (opens === 3) { fs.writeFileSync(String(p), 'planted'); return realOpen.call(fs, p, flags, ...rest); }   // EEXIST
      const elsewhere = fresh('attacker9');
      targets.push(elsewhere);
      fs.symlinkSync(elsewhere, String(p));
      return realOpen.call(fs, elsewhere, 'wx', ...rest);   // the Windows open follows the link
    }
    if (String(p) === file) inPlace += 1;
    return realOpen.call(fs, p, flags, ...rest);
  };
  t.after(() => { fs.openSync = realOpen; for (const p of [...planted, ...targets]) { try { fs.rmSync(p, { force: true }); } catch { /* fine */ } } });
  let err = null;
  try { securewrite.writeSecret(file, 'secret-9285b', 0o600); } catch (e) { err = e; }
  fs.openSync = realOpen;
  assert.equal(opens, 3, 'the atomic path did not try three names');
  assert.ok(err, 'a mix of planted links and a planted file did not refuse the save');
  assert.equal(err.code, 'ERR_KOSMOS_TEMP_SWAPPED');
  assert.equal(inPlace, 0, 'the in-place fallback opened the config');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old config', 'the config was changed');
  assert.equal(fs.readFileSync(planted[2], 'utf8'), 'planted', 'the planted file was touched');
});

/* kosmos#9307: a plain file planted at all three guessable temp names made each create fail EEXIST, and three EEXISTs
   reached the in-place fallback (on Windows, a race at the config itself). A file already at a FRESH temp name is a plant,
   so it refuses the save as a swapped name does; one is enough when the other attempts fail for another reason. CONTROL:
   three EPERM failures still take the fallback and write, so the rule is about EEXIST, not about failing. A single plant
   followed by a clean attempt still saves: the #1787 retry test here and the #1761 ones in sendertoken.test.js cover that. */
/* kosmos#9325: on Windows a delete-pending file (held open, marked for deletion the classic way) keeps its name and
   makes the create fail EPERM (measured on Windows build 26100). Simulated on any host: a file at the name and an EPERM
   from the create. An EPERM with the name present refuses as a plant; CONTROL: an EPERM with no name still falls back. */
test('#9325: an EPERM on the temp create with a file at its name refuses the save; an EPERM with no name falls back', (t) => {
  const realOpen = fs.openSync;
  const made = [];
  t.after(() => { fs.openSync = realOpen; for (const p of made) { try { fs.rmSync(p, { force: true }); } catch { /* fine */ } } });
  const run = (name, withName) => {
    const file = fresh(name);
    fs.writeFileSync(file, 'old config');
    let inPlace = 0;
    fs.openSync = function (p, flags, ...rest) {
      if (flags === 'wx' && String(p).includes('.kosmos-')) {
        if (withName) { made.push(String(p)); fs.writeFileSync(String(p), 'pending'); }
        throw Object.assign(new Error('access denied'), { code: 'EPERM' });
      }
      if (String(p) === file) inPlace += 1;
      return realOpen.call(fs, p, flags, ...rest);
    };
    let err = null;
    try { securewrite.writeSecret(file, 'secret-9325', 0o600); } catch (e) { err = e; }
    fs.openSync = realOpen;
    return { err, inPlace, after: fs.readFileSync(file, 'utf8') };
  };
  const pend = run('pend3', true);
  assert.equal(pend.err && pend.err.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'a delete-pending name did not refuse: ' + (pend.err && pend.err.code));
  assert.equal(pend.err.planted, true);
  assert.equal(pend.inPlace, 0, 'the in-place fallback opened the config');
  assert.equal(pend.after, 'old config');
  for (const p of made) assert.equal(fs.readFileSync(p, 'utf8'), 'pending', 'a pending file was removed');
  const ctl = run('eperm3b', false);
  assert.equal(ctl.err, null, 'CONTROL: an EPERM with no name should fall back: ' + (ctl.err && ctl.err.code));
  assert.equal(ctl.after, 'secret-9325', 'CONTROL: the fallback did not write');
});

test('#9307: plain files planted at the temp names refuse the save, with no in-place fallback; EPERM still falls back', (t) => {
  const realOpen = fs.openSync;
  const planted = [];
  const dirs = [];
  t.after(() => { fs.openSync = realOpen; for (const p of [...planted, ...dirs]) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* fine */ } } });
  const run = (name, failFor, opts) => {
    const file = fresh(name);
    fs.writeFileSync(file, 'old config');
    let opens = 0;
    let inPlace = 0;
    fs.openSync = function (p, flags, ...rest) {
      if (flags === 'wx' && String(p).includes('.kosmos-')) {
        opens += 1;
        const how = failFor(opens);
        if (how === 'plant') { planted.push(String(p)); fs.writeFileSync(String(p), 'planted'); }   // the real open then fails EEXIST
        else if (how === 'dir') { dirs.push(String(p)); fs.mkdirSync(String(p)); }   // a directory at the name: EEXIST too
        else if (how === 'dangling') { dirs.push(String(p)); fs.symlinkSync(path.join(path.dirname(String(p)), 'nowhere-9307'), String(p)); }   // POSIX: EEXIST, never followed
        else if (how === 'eperm') throw Object.assign(new Error('refused'), { code: 'EPERM' });
      }
      if (String(p) === file) inPlace += 1;
      return realOpen.call(fs, p, flags, ...rest);
    };
    let err = null;
    try { securewrite.writeSecret(file, 'secret-9307', 0o600, opts); } catch (e) { err = e; }
    fs.openSync = realOpen;
    return { err, opens, inPlace, file, after: fs.readFileSync(file, 'utf8') };
  };
  const all = run('plant3', () => 'plant');
  assert.equal(all.opens, 3, 'the atomic path did not try three names');
  assert.ok(all.err, 'three planted files did not refuse the save');
  assert.equal(all.err.code, 'ERR_KOSMOS_TEMP_SWAPPED');
  assert.equal(all.err.planted, true, 'the refusal does not say a plant caused it');
  assert.equal(all.err.cause && all.err.cause.planted, true, 'the refusal does not say it was a plant');
  assert.equal(all.err.cause.cause && all.err.cause.cause.code, 'EEXIST', 'the EEXIST is not kept');
  assert.equal(all.inPlace, 0, 'the in-place fallback opened the config');
  assert.equal(all.after, 'old config', 'the config was changed');
  const one = run('plant1', (n) => (n === 2 ? 'plant' : 'eperm'));
  assert.ok(one.err && one.err.code === 'ERR_KOSMOS_TEMP_SWAPPED', 'one plant among EPERM failures did not refuse: ' + (one.err && one.err.code));
  assert.equal(one.inPlace, 0, 'one plant: the in-place fallback opened the config');
  assert.equal(one.after, 'old config');
  // atomicOnly with plants as the only failures: the same refusal, never the raw EEXIST.
  const ao = run('plant3ao', () => 'plant', { atomicOnly: true });
  assert.equal(ao.err && ao.err.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'atomicOnly with three plants: ' + (ao.err && ao.err.code));
  assert.equal(ao.err.lastAttempt && ao.err.lastAttempt.planted, true, 'atomicOnly: the last attempt is not marked a plant');
  assert.equal(ao.after, 'old config');
  // A refusal never removes what was planted: the refusal comes before the write could call a temp its own.
  assert.equal(planted.length, 7, 'CONTROL: the plants were made, three, one and three (' + planted.length + ')');
  for (const p of planted) assert.equal(fs.readFileSync(p, 'utf8'), 'planted', 'a planted file was removed or changed: ' + p);
  // Every plant shape that fails the create EEXIST counts, not only a regular file: a directory, and on POSIX a dangling
  // link (an exclusive create never follows one there). On Windows, a 'wx' create over a directory failing EEXIST is
  // reasoned from libuv's O_EXCL mapping, not measured here: if plantdir goes red on Windows, that is the first thing.
  const dir = run('plantdir', () => 'dir');
  assert.equal(dir.err && dir.err.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'directories at the names: ' + (dir.err && dir.err.code));
  assert.equal(dir.after, 'old config');
  if (process.platform !== 'win32') {
    const dl = run('plantdangle', () => 'dangling');
    assert.equal(dl.err && dl.err.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'dangling links at the names: ' + (dl.err && dl.err.code));
    assert.equal(dl.after, 'old config');
  }
  const ctl = run('eperm3', () => 'eperm');
  assert.equal(ctl.err, null, 'CONTROL: three EPERM failures should take the fallback and succeed: ' + (ctl.err && ctl.err.code));
  assert.ok(ctl.inPlace >= 1, 'CONTROL: the fallback did not open the config');
  assert.equal(ctl.after, 'secret-9307', 'CONTROL: the fallback did not write');
});

/* kosmos#9285 review 5: the swap rule runs BEFORE the atomicOnly exit, so an atomicOnly write with a mixed plant (links
   at two names, a plain file at the third) still gets ERR_KOSMOS_TEMP_SWAPPED, with the first swap as its cause and
   the last attempt kept beside it. Since kosmos#9307 that third attempt is itself a refusal (a plant), its EEXIST
   kept as its cause. */
test('#9285: atomicOnly with a mixed plant raises ERR_KOSMOS_TEMP_SWAPPED, the first swap as its cause', (t) => {
  const file = fresh('mixedatomic');
  fs.writeFileSync(file, 'old config');
  const realOpen = fs.openSync;
  const planted = [];
  const targets = [];
  let opens = 0;
  fs.openSync = function (p, flags, ...rest) {
    if (flags === 'wx' && String(p).includes('.kosmos-')) {
      opens += 1;
      planted.push(String(p));
      if (opens === 3) { fs.writeFileSync(String(p), 'planted'); return realOpen.call(fs, p, flags, ...rest); }   // EEXIST
      const elsewhere = fresh('attacker10');
      targets.push(elsewhere);
      fs.symlinkSync(elsewhere, String(p));
      return realOpen.call(fs, elsewhere, 'wx', ...rest);
    }
    return realOpen.call(fs, p, flags, ...rest);
  };
  t.after(() => { fs.openSync = realOpen; for (const p of [...planted, ...targets]) { try { fs.rmSync(p, { force: true }); } catch { /* fine */ } } });
  let err = null;
  try { securewrite.writeSecret(file, 'secret-9285c', 0o600, { atomicOnly: true }); } catch (e) { err = e; }
  fs.openSync = realOpen;
  assert.ok(err, 'the write did not throw');
  assert.equal(err.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'atomicOnly took the last error (EEXIST) instead of the refusal');
  assert.equal(err.cause && err.cause.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'the first swap is not the cause');
  assert.equal(err.lastAttempt && err.lastAttempt.code, 'ERR_KOSMOS_TEMP_SWAPPED', 'the last attempt\'s error was dropped');
  assert.equal(err.lastAttempt.planted, true, 'the plain file at the third name is a plant (kosmos#9307)');
  assert.equal(err.lastAttempt.cause && err.lastAttempt.cause.code, 'EEXIST', 'its EEXIST is kept as its cause');
  assert.equal(fs.readFileSync(file, 'utf8'), 'old config', 'the config was changed');
});
