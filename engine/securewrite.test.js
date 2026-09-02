'use strict';

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

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-securewrite-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const fresh = (name) => path.join(SANDBOX, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const modeOf = (p) => fs.statSync(p).mode & 0o777;

/* 🛑 THE DEFECT THIS WRITER EXISTS FOR, ASSERTED ON THE INODE RATHER THAN THE MODE.
   Both the old shape (write in place, then chmod) and this one END at 0600, so a
   mode assertion passes either way and cannot be the guard. `rename` REPLACES the
   inode; a write in place REUSES it. That is the only observable that differs. */
test('#1787: writeSecret REPLACES a pre-existing loose file rather than rewriting it', () => {
  const f = fresh('replace');
  fs.writeFileSync(f, 'OLD');
  fs.chmodSync(f, 0o644);
  assert.equal(modeOf(f), 0o644, 'the loose plant did not take, so this arm would pass without the fix');
  const inodeBefore = fs.statSync(f).ino;

  securewrite.writeSecret(f, 'NEW-SECRET', 0o600);

  assert.notEqual(fs.statSync(f).ino, inodeBefore,
    'the secret was written IN PLACE: same inode means no rename, so the bytes were '
    + 'on disk at 0644 before any chmod');
  assert.equal(modeOf(f), 0o600, 'the file was left loose');
  assert.equal(fs.readFileSync(f, 'utf8'), 'NEW-SECRET');
});

/* The create-time mode is a real mechanism and it is NOT what this module is for:
   this arm is the CONTROL that the fresh-create case was never broken, so a reader
   can see which case the inode arm above is actually about. */
test('#1787: CONTROL, a fresh path was never the broken case', () => {
  const f = fresh('fresh');
  securewrite.writeSecret(f, 'SECRET', 0o600);
  assert.equal(modeOf(f), 0o600);
  assert.equal(fs.readFileSync(f, 'utf8'), 'SECRET');
});

/* #1763: mkdirSync's mode is create-only too, so a directory that already exists at
   0755 stays there. A loose directory discloses the FILENAMES even when every file
   inside is 0600. */
test('#1787: secureDir tightens a pre-existing loose directory, not just a fresh one', () => {
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
test('#1787: a chmod failure on the temp costs ZERO retries, because it is not fatal', () => {
  const f = fresh('chmod-eperm');
  fs.writeFileSync(f, 'OLD');
  fs.chmodSync(f, 0o644);

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
  assert.equal(modeOf(f), 0o600, 'the pre-existing loose file was left loose');
});

/* 🛑 THE FALLBACK MUST TIGHTEN BEFORE THE BYTES LAND, and no end-state assertion can
   see it: the file is 0600 either way. Catching it needs observation from INSIDE the
   write, and the fd is the first argument to `fs.writeFileSync`, so a stub can read
   `fs.fstatSync(fd).mode` at the instant the bytes land.
   ⚠️ A two-line swap renders as a ONE-LINE git diff and reads like a comment change,
   so confirm the region rather than trusting the diff shape. */
test('#1787: the fallback tightens BEFORE the bytes land, observed from inside the write', () => {
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
test('#1787: secureDir creates the directory AT the mode, not loose and then tightened', () => {
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
test('#1787: under a restrictive umask the temp is tightened to the requested mode before the rename, in this file', () => {
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

test('#1793 SAFETY: a temp from a LIVE foreign pid is LEFT, never taken', () => {
  /* 🛑 THE RACE THE GLOB WOULD HAVE CREATED. pid 1 (launchd) is always alive and
     foreign; `process.kill(1,0)` throws EPERM (alive, not ours), which is NOT
     ESRCH, so the reaper must leave it. If it took this it could take a
     concurrent writer's in-flight temp between that writer's create and rename.
     This arm stays green when the fix is reverted (nothing is reaped either way);
     it reddens if the predicate is ever widened to delete a live pid's temp. */
  const dir = reapDir();
  const live = plantTemp(dir, 'gh-token', 1, Date.now() - 5000, 1);
  assert.ok(fs.existsSync(live), 'the plant did not take');
  securewrite.writeSecret(path.join(dir, 'gh-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(live), true,
    'a LIVE foreign process\'s in-flight temp was deleted: the reaper can take a concurrent writer\'s temp');
});

test('#1793 SAFETY: a real credential file (no temp suffix) is NEVER touched', () => {
  /* The regex is anchored to the `.kosmos-<pid>-<started>-<seq>.tmp` suffix,
     which a credential file cannot carry. A dead-pid orphan beside a sibling
     credential must take the orphan and leave the credential. Widen the regex to
     match a bare name and this reddens. */
  const dead = childProcess.spawnSync(process.execPath, ['-e', '0']).pid;
  let isDead = false;
  try { process.kill(dead, 0); } catch (e) { isDead = e.code === 'ESRCH'; }
  assert.ok(isDead, `pid ${dead} was reused; re-run`);
  const dir = reapDir();
  const sibling = path.join(dir, 'other-provider-token');
  fs.writeFileSync(sibling, 'A-REAL-SECRET', { mode: 0o600 });
  const orphan = plantTemp(dir, 'gh-token', dead, Date.now() - 5000, 1);
  securewrite.writeSecret(path.join(dir, 'gh-token'), 'NEW', 0o600);
  assert.equal(fs.existsSync(orphan), false, 'the dead orphan was not reaped');
  assert.equal(fs.existsSync(sibling), true, 'a real credential file with no temp suffix was deleted by the reaper');
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
  assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'the written secret is not private');
});
