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

  assert.throws(
    () => securewrite.refuseSymlinkTarget(link, undefined),
    /refusing to write a secret through a symlink/,
    'a planted symlink was not refused',
  );
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL', 'the victim was written through');
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
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = function (target, data, opts) {
    if (typeof target === 'string' && target.endsWith('.tmp') && planted === null) {
      planted = target;
      realWrite.call(fs, target, 'SOMEBODY ELSE FILE');
      const e = new Error('forced'); e.code = 'EEXIST'; throw e;
    }
    return realWrite.call(fs, target, data, opts);
  };
  try { securewrite.writeSecret(f, 'SECRET', 0o600); } finally { fs.writeFileSync = realWrite; }

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
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL', 'the victim was written through');
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
  const realWrite = fs.writeFileSync;
  const realChmod = fs.chmodSync;
  fs.writeFileSync = function (target, ...rest) {
    if (typeof target === 'string' && target.endsWith('.tmp')) temps += 1;
    return realWrite.call(fs, target, ...rest);
  };
  fs.chmodSync = function (target, mode) {
    if (typeof target === 'string' && target.endsWith('.tmp')) {
      const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e;
    }
    return realChmod.call(fs, target, mode);
  };
  try { securewrite.writeSecret(f, 'SECRET', 0o600); } finally {
    fs.writeFileSync = realWrite;
    fs.chmodSync = realChmod;
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
   restore would put back the same bytes that are already there. */
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
