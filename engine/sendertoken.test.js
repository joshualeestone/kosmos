'use strict';

// ⚠️ SANDBOX FIRST, BEFORE ANY REQUIRE, and all four roots. store.js resolves
// its root at module load, and `test-support/fleet` pulls in engine/status,
// which resolves the workers root once at require time too. Same rule and same
// reason as fixture-discipline.test.js states at its own top.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sendertoken-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const sendertoken = require('./sendertoken');

test.after(() => {
  fleet.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/**
 * ⚠️ THE ROWS COME FROM `test-support/fleet`, NEVER FROM A LITERAL. A
 * hand-written roster row can carry fields `paneRoster()` never emits, which is
 * how a display name and a needs-you count once shipped dead. The first version
 * of this file hand-built its rows and turned main red on the
 * fixture-discipline gate (#570); this is that corrected.
 *
 * ⚠️ AND AN HONEST NOTE ABOUT WHAT THAT COSTS HERE. These tests are about an
 * agent with NO pane, but `fleet` arranges agents AS PANES, because that is
 * what the board can currently contain. So the pane-less half these tests
 * really pin is that **no `from_pane` is passed and none is consulted**: the
 * sender is resolved from the token alone. The row still originates from a pane
 * fixture, because the fixture cannot express an agent without one.
 *
 * ⭐ That limitation is not a gap in the harness, it is #570's membership half
 * showing up in the test suite: `status.snapshot` builds the fleet by mapping
 * over `tmux list-panes`, so nothing in this repo can yet arrange an agent that
 * has no pane. When that lands, these rows should come from it.
 */

test('an agent resolves by the token it was handed at launch, with no pane id anywhere', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('renet-windows');
    assert.equal(minted.ok, true);
    const who = sendertoken.resolve(minted.token, board.roster);
    assert.equal(who.ok, true);
    assert.equal(who.card.sessionName, 'renet-windows');
  } finally { board.restore(); }
});

test('the body still cannot name the sender: an unissued token is refused, not believed', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const who = sendertoken.resolve('a'.repeat(64), board.roster);
    assert.equal(who.ok, false);
    assert.match(who.because, /could not match that to one of your agents/);
  } finally { board.restore(); }
});

test('presenting nothing fails with its own sentence, so a caller can tell it forgot the token', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const who = sendertoken.resolve('', board.roster);
    assert.equal(who.ok, false);
    assert.match(who.because, /no sender token was presented/);
  } finally { board.restore(); }
});

test('the roster tie decides, not the token: an untied row cannot speak even holding a real token', () => {
  /* `fleet.stranger` is a pane whose session name is not ours -- somebody
     else's claim on the name -- which is exactly what `isNamedOurs` refuses.
     The real thing, rather than a literal asserting what I believe it looks
     like. */
  const board = fleet.install([fleet.stranger('borrowed-name')]);
  try {
    const minted = sendertoken.mint('borrowed-name');
    assert.equal(minted.ok, true);
    const who = sendertoken.resolve(minted.token, board.roster);
    assert.equal(who.ok, false);
    assert.match(who.because, /could not match that to one of your agents/);
  } finally { board.restore(); }
});

test('a revoked token stops resolving, which is how a deleted agent stops being able to speak', () => {
  const board = fleet.install([fleet.agent('going-away', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('going-away');
    assert.equal(sendertoken.resolve(minted.token, board.roster).ok, true);
    sendertoken.revoke('going-away');
    assert.equal(sendertoken.resolve(minted.token, board.roster).ok, false);
  } finally { board.restore(); }
});

test('#570: two launches of one agent BOTH resolve, and are told apart by instance', () => {
  /* The point of the change. Under #1000 the second mint invalidated the
     first, so two live runs were indistinguishable AND one of them silently
     stopped being able to speak. Both are wrong: two runs is a real situation
     and the record has to be able to show it. */
  const board = fleet.install([fleet.agent('twice', { state: 'idle' })]);
  try {
    const one = sendertoken.mint('twice');
    const two = sendertoken.mint('twice');
    assert.notEqual(one.token, two.token);
    assert.notEqual(one.instance, two.instance, 'two launches share an instance id');

    const a = sendertoken.resolve(one.token, board.roster);
    const b = sendertoken.resolve(two.token, board.roster);
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.equal(a.card.sessionName, b.card.sessionName, 'they are the same agent');
    assert.equal(a.instance, one.instance);
    assert.equal(b.instance, two.instance);
  } finally { board.restore(); }
});

test('#570: live() is the detection -- a second run of one agent is VISIBLE, not silent', () => {
  const board = fleet.install([fleet.agent('doubled', { state: 'idle' })]);
  try {
    assert.deepEqual(sendertoken.live('doubled'), [], 'an agent that never launched has no live run');
    const one = sendertoken.mint('doubled');
    assert.equal(sendertoken.live('doubled').length, 1);
    const two = sendertoken.mint('doubled');
    /* THIS is the line that answers the question four external checks could not
       on 2026-08-26: is more than one of this agent running right now. */
    assert.equal(sendertoken.live('doubled').length, 2, 'a second live run did not show');

    sendertoken.retire('doubled', one.instance);
    assert.deepEqual(sendertoken.live('doubled'), [two.instance], 'retiring one run took the other with it');
    assert.equal(sendertoken.resolve(one.token, board.roster).ok, false, 'a retired run can still speak');
    assert.equal(sendertoken.resolve(two.token, board.roster).ok, true, 'the surviving run was silenced');
  } finally { board.restore(); }
});

test('#570: revoke carries the guarantee mint used to -- a recreated agent inherits nothing', () => {
  /* 🛑 THE SEMANTIC THAT MOVED. #1000 relied on mint rotating. Minting now
     appends, so the creation path MUST revoke. This test is the contract. */
  const board = fleet.install([fleet.agent('recreated', { state: 'idle' })]);
  try {
    const first = sendertoken.mint('recreated');
    assert.equal(sendertoken.resolve(first.token, board.roster).ok, true);
    sendertoken.revoke('recreated');
    const second = sendertoken.mint('recreated');
    assert.equal(sendertoken.resolve(first.token, board.roster).ok, false, 'the old run kept its voice through a recreate');
    assert.equal(sendertoken.resolve(second.token, board.roster).ok, true);
  } finally { board.restore(); }
});

test('#570: a #1000 single-token file still resolves, read as the `legacy` instance', () => {
  /* Migration is silent and one-way, so an agent holding a token minted before
     this change does not go mute. `legacy` rather than null, so a reader can
     see WHAT it is instead of guessing. */
  const board = fleet.install([fleet.agent('oldshape', { state: 'idle' })]);
  try {
    fs.mkdirSync(sendertoken.DIR, { recursive: true });
    const old = 'e'.repeat(64);
    fs.writeFileSync(path.join(sendertoken.DIR, 'oldshape.json'),
      JSON.stringify({ token: old, mintedAt: '2026-08-26T20:00:00.000Z' }), { mode: 0o600 });
    const who = sendertoken.resolve(old, board.roster);
    assert.equal(who.ok, true);
    assert.equal(who.instance, 'legacy');
    assert.deepEqual(sendertoken.live('oldshape'), ['legacy']);
  } finally { board.restore(); }
});

test('#570: the live list is capped, and it is the OLDEST run that is dropped', () => {
  /* A backstop against an agent restarted in a loop, not a policy. The newest
     run is the one still speaking, so age is the right thing to drop on. */
  const board = fleet.install([fleet.agent('loopy', { state: 'idle' })]);
  try {
    const first = sendertoken.mint('loopy');
    for (let i = 0; i < sendertoken.MAX_LIVE; i++) sendertoken.mint('loopy');
    assert.equal(sendertoken.live('loopy').length, sendertoken.MAX_LIVE);
    assert.equal(sendertoken.resolve(first.token, board.roster).ok, false, 'the oldest run survived the cap');
  } finally { board.restore(); }
});

test('one agent\'s token never resolves to another, which is the impersonation a pane id allows', () => {
  const board = fleet.install([
    fleet.agent('agent-one', { state: 'idle' }),
    fleet.agent('agent-two', { state: 'idle' }),
  ]);
  try {
    const mine = sendertoken.mint('agent-one');
    const who = sendertoken.resolve(mine.token, board.roster);
    assert.equal(who.ok, true);
    assert.equal(who.card.sessionName, 'agent-one');
  } finally { board.restore(); }
});

test('a stale token whose agent is not on the roster reads exactly like one we never issued', () => {
  const board = fleet.install([fleet.agent('someone-else', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('vanished');
    const who = sendertoken.resolve(minted.token, board.roster);
    assert.equal(who.ok, false);
    /* Not "that agent is gone": that sentence would confirm the token was once
       real, which is a yes/no oracle for anything guessing. */
    assert.match(who.because, /could not match that to one of your agents/);
  } finally { board.restore(); }
});

test('the token is kept owner-only, because it is the agent\'s ability to speak as itself', () => {
  sendertoken.mint('perms-check');
  const file = path.join(sendertoken.DIR, 'perms-check.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

/* 🛑 #1761. THE ARM ABOVE PASSES WITHOUT THE FIX, AND THAT IS THE WHOLE POINT.
   `writeFileSync(..., { mode })` and `mkdirSync(..., { mode })` apply the mode ON
   CREATE ONLY. On a path that already exists they are SILENTLY IGNORED, so a fresh
   mint lands at 0600 whether or not anything chmods, and an assertion built on one
   cannot fail for the bug it appears to guard.

   ⇒ The arms below PLANT A LOOSE MODE FIRST. Every line of the fix is perturbed
   individually and the full matrix lives in the branch plan.
   ⚠️ An earlier version of this comment described "removing the file chmod" and said
   the dir chmod reddens one arm. THERE IS NO CHMOD ON THE TARGET any more, and the
   dir chmod reddens TWO. Restate from the matrix, not from memory. */

test('#1761: a token file that is ALREADY loose is tightened on the next mint', () => {
  sendertoken.mint('loose-file');
  const file = path.join(sendertoken.DIR, 'loose-file.json');
  fs.chmodSync(file, 0o644);
  // PRECONDITION: if the plant did not take, the assertion below proves nothing.
  assert.equal(fs.statSync(file).mode & 0o777, 0o644,
    'the loose mode was not planted, so this arm cannot fail for the right reason');
  sendertoken.mint('loose-file');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600,
    'a pre-existing world-readable token file survived a mint: anyone on the box can read this agent\'s ability to speak as itself');
});

test('#1761: the secret never occupies the loose file, because the write is temp-then-rename', () => {
  sendertoken.mint('no-window');
  const file = path.join(sendertoken.DIR, 'no-window.json');
  fs.chmodSync(file, 0o644);
  const before = fs.statSync(file).ino;
  assert.equal(fs.statSync(file).mode & 0o777, 0o644,
    'the loose mode was not planted, so this arm cannot fail for the right reason');

  sendertoken.mint('no-window');

  /* 🛑 THE INODE IS THE OBSERVABLE FOR "NO WINDOW". A write-then-chmod REUSES the
     inode, so the freshly minted secret sits in the old, loose file until the chmod
     lands. Measured on that shape: 644 immediately after the write, secret readable.
     A temp-then-rename REPLACES the inode, so the target is never briefly loose and
     never partially written. Asserting the mode alone cannot tell those apart: both
     end at 0600. */
  assert.notEqual(fs.statSync(file).ino, before,
    'the token was written in place, so the secret sat in the pre-existing loose file until the chmod');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  /* 🛑 `endsWith('.tmp')`, NOT `includes('.tmp-')`. The old temp name was
     `<file>.tmp-<pid>`; the current one is `<file>.kosmos-<pid>-<start>-<seq>.tmp`,
     which contains `.tmp` and NEVER `.tmp-`. The old filter matched nothing, so this
     assertion had two identical outcomes: a reviewer added a deliberate leak after
     the rename and the suite stayed fully green. I broke this guard myself by
     renaming the temp, which is the "controls keyed on the old wording are now
     vacuous" failure in one file. */
  assert.deepEqual(fs.readdirSync(sendertoken.DIR).filter((f) => f.endsWith('.tmp')), [],
    'a temp file was left behind');
});

/* 🛑 THE PROPERTY, NOT THE PATH. The fallback is now nearly unreachable by design:
   the temp name carries pid + start time + counter, so `wx` fails only for a planted
   file at an unpredictable path. Contriving reachability would test the contrivance.
   ⇒ This arm asserts what BOTH paths must guarantee instead: a symlink at the token
   path never causes a write through it. `renameSync` replaces the link on the main
   path; `O_NOFOLLOW` makes the fallback throw rather than follow. */
test('#1761: a symlink planted at the token path is never written through', () => {
  const victim = path.join(SANDBOX, 'victim.txt');
  fs.writeFileSync(victim, 'ORIGINAL');
  const linked = path.join(sendertoken.DIR, 'linked.json');
  fs.mkdirSync(sendertoken.DIR, { recursive: true, mode: 0o700 });
  fs.symlinkSync(victim, linked);
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true,
    'the symlink was not planted, so this arm cannot fail for the right reason');

  sendertoken.mint('linked');

  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL',
    'the token was written THROUGH the symlink into another file');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), false,
    'the token path is still a symlink, so a later write would follow it');
});

/* 🛑 THIS ARM EXISTS BECAUSE "TEST THE PROPERTY, NOT THE PATH" GAVE ZERO COVERAGE ON
   THE FALLBACK. A reviewer measured it: deleting `O_NOFOLLOW` left the suite fully
   green, because the symlink arm above only ever drives the rename path. The fix was
   real and unguarded, which is a fix one edit away from being silently removed.
   ⇒ Forcing the fallback needs a seam, so `renameSync` is stubbed to throw. That is a
   contrivance, and it is the right one: it drives REAL production code down a path
   that a crash or a planted temp reaches for real. */
test('#1761: the FALLBACK path also refuses a symlink, not just the rename path', () => {
  const victim = path.join(SANDBOX, 'fallback-victim.txt');
  fs.writeFileSync(victim, 'ORIGINAL');
  const linked = path.join(sendertoken.DIR, 'fb-linked.json');
  fs.mkdirSync(sendertoken.DIR, { recursive: true, mode: 0o700 });
  fs.symlinkSync(victim, linked);

  const realRename = fs.renameSync;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  let res;
  try {
    res = sendertoken.mint('fb-linked');
  } finally {
    fs.renameSync = realRename;
  }

  assert.equal(res.ok, false,
    'the fallback wrote a token through a symlink instead of refusing');
  /* 🛑 WHICH REFUSAL. `ok:false` alone passes when the KERNEL refuses via O_NOFOLLOW, which
     is what happens on macOS and is why deleting the production call to
     `refuseSymlinkTarget` left this arm GREEN. On win32 there is no kernel refusal. Pinning
     the SENTENCE is what makes this arm speak about the platform we ship to and cannot run
     here: our own refusal says so in words, the kernel's says ELOOP. */
  assert.match(res.because, /refusing to write a token through a symlink/,
    'the refusal came from the kernel, not from refuseSymlinkTarget: on win32 there is no '
    + 'kernel to refuse, so this path would follow the symlink');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL',
    'the fallback followed the symlink and overwrote another file');
  assert.deepEqual(fs.readdirSync(sendertoken.DIR).filter((f) => f.endsWith('.tmp')), [],
    'the forced-failure path left a temp behind');
});

/* 🛑 THE FALLBACK'S OWN TIGHTENING STEP. Deleting `fchmodSync` there left the suite
   fully green: measured, the fallback produced mode 644, THE EXACT BUG THIS CARD
   EXISTS TO FIX, on a path nothing watched. */
test('#1761: the FALLBACK tightens a pre-existing loose file, not just the rename path', () => {
  sendertoken.mint('fb-loose');
  const file = path.join(sendertoken.DIR, 'fb-loose.json');
  fs.chmodSync(file, 0o644);
  assert.equal(fs.statSync(file).mode & 0o777, 0o644,
    'the loose mode was not planted, so this arm cannot fail for the right reason');

  const realRename = fs.renameSync;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  let res;
  try { res = sendertoken.mint('fb-loose'); } finally { fs.renameSync = realRename; }

  assert.equal(res.ok, true, 'the forced fallback failed to mint at all');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600,
    'the FALLBACK left a pre-existing token world-readable');
  assert.deepEqual(fs.readdirSync(sendertoken.DIR).filter((f) => f.endsWith('.tmp')), [],
    'the fallback left a temp behind');
});

/* 🛑 TWO STATED PROPERTIES THAT NOTHING WATCHED, both of them prior passes' findings.
   The DIRECTORY must be tightened BEFORE anything is written (pass 1's hoist), and the
   temp name must be UNIQUE PER RUN so a crash cannot wedge it (pass 3's finding).
   Both were reported GREEN under mutation, so this arm observes them from inside the
   write itself rather than from the end state, which cannot distinguish them. */
test('#1761: the directory is already tight WHEN the token is written, and the temp name is unique', () => {
  sendertoken.mint('observe');
  fs.chmodSync(sendertoken.DIR, 0o755);

  const realWrite = fs.writeFileSync;
  const seen = { dirMode: null, names: [], flags: [] };
  fs.writeFileSync = function (target, data, opts) {
    if (typeof target === 'string' && target.startsWith(sendertoken.DIR)) {
      if (seen.dirMode === null) seen.dirMode = fs.statSync(sendertoken.DIR).mode & 0o777;
      seen.names.push(path.basename(target));
      seen.flags.push(opts && opts.flag);
    }
    return realWrite.call(fs, target, data, opts);
  };
  try {
    sendertoken.mint('observe');
    sendertoken.mint('observe');
  } finally { fs.writeFileSync = realWrite; }

  assert.equal(seen.dirMode, 0o700,
    'the token was written while the directory was still world-readable: the hoist is undone');
  const temps = seen.names.filter((n) => n.endsWith('.tmp'));
  assert.equal(temps.length, 2, 'expected one temp per mint');
  assert.notEqual(temps[0], temps[1],
    'two mints reused the same temp name, so one stale file from a crash wedges every later mint');

  /* 🛑 `wx` IS OBSERVED AS A CALL FLAG, not grepped from source. It is the only thing
     that refuses a file already sitting at the temp path, and a planted file there is
     one we must NOT overwrite. Dropping it left every other arm green, because a
     unique name makes a collision essentially unreachable in a test: the flag's whole
     value is for the case a test cannot easily construct. */
  assert.deepEqual(seen.flags, ['wx', 'wx'],
    'the temp was written without the wx flag, so a planted file at that path would be overwritten');
});

/* 🛑 THE EEXIST GUARD IS LOAD-BEARING, NOT DECORATIVE. `wx` means a file already at
   the temp path makes the write throw, and unlinking THEN would delete somebody else's
   file. Replacing the guard with `if (true)` left the suite fully green, so this arm
   plants a file at the exact temp path and asserts it survives. */
test('#1761: a planted file at the temp path is never deleted by the cleanup', () => {
  sendertoken.mint('eexist');
  const realWrite = fs.writeFileSync;
  let planted = null;
  fs.writeFileSync = function (target, data, opts) {
    if (typeof target === 'string' && target.endsWith('.tmp') && planted === null) {
      planted = target;
      realWrite.call(fs, target, 'SOMEBODY ELSE FILE');
      const e = new Error('forced'); e.code = 'EEXIST'; throw e;
    }
    return realWrite.call(fs, target, data, opts);
  };
  try { sendertoken.mint('eexist'); } finally { fs.writeFileSync = realWrite; }

  assert.notEqual(planted, null, 'the temp write was never attempted, so this arm proves nothing');
  assert.equal(fs.existsSync(planted), true,
    'the cleanup deleted a file it did not create');
  assert.equal(fs.readFileSync(planted, 'utf8'), 'SOMEBODY ELSE FILE',
    'the cleanup overwrote a file it did not create');
  fs.unlinkSync(planted);
});

/* 🛑 A RESTRICTIVE UMASK CLEARS THE OWNER BITS TOO. Measured: `flag:'wx', mode:0600`
   under umask 0600 creates the file at mode 0, which the agent cannot read back. The
   chmod on the temp is what restores it, and removing that chmod left the suite green.
   ⚠️ NOT the reason first written here: umask only CLEARS, so it can never widen a
   create-time mode. */
test('#1761: a restrictive umask cannot leave the token unreadable by its owner', () => {
  const old = process.umask(0o600);
  try {
    sendertoken.mint('umask-check');
    const file = path.join(sendertoken.DIR, 'umask-check.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600,
      'a restrictive umask left the token at a mode the agent cannot read');
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).tokens.length >= 1,
      'the token could not be read back');
  } finally { process.umask(old); }
});

/* 🛑 O_TRUNC AND THE CREATE MODE ON THE FALLBACK, both previously unwatched.
   Dropping O_TRUNC leaves trailing bytes when the token list SHRINKS, corrupting the
   JSON and losing EVERY token, not just the removed one. Dropping the mode argument
   creates at 0666 minus umask. */
test('#1761: the FALLBACK truncates and creates tight, so a shrinking list cannot corrupt it', () => {
  sendertoken.mint('trunc');
  sendertoken.mint('trunc');
  sendertoken.mint('trunc');
  const file = path.join(sendertoken.DIR, 'trunc.json');
  const big = fs.statSync(file).size;
  /* 🛑 DO NOT UNLINK. An earlier version of this arm removed the file first, which made
     the fallback a FRESH create where O_TRUNC is irrelevant: the arm was VACUOUS for the
     line it was written to guard. The file must EXIST and be LARGER for truncation to
     mean anything, so the token list is shrunk in place instead. */
  fs.writeFileSync(file, JSON.stringify({ tokens: [] }) + 'X'.repeat(big + 2000));
  const padded = fs.statSync(file).size;
  assert.ok(padded > big, 'the file was not padded, so a truncation failure would be invisible');

  const realRename = fs.renameSync;
  fs.renameSync = () => { const e = new Error('forced'); e.code = 'EXDEV'; throw e; };
  let res;
  try { res = sendertoken.mint('trunc'); } finally { fs.renameSync = realRename; }

  assert.equal(res.ok, true, 'the forced fallback failed to mint');
  assert.ok(fs.statSync(file).size < padded,
    'the fallback did not truncate: trailing bytes from the larger previous content survived');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')),
    'the fallback left unparseable JSON, which loses EVERY token, not just the removed one');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600,
    'the fallback created the token at a loose mode');
});

/* 🛑 THE WINDOWS SYMLINK REFUSAL, WHICH HAD ZERO COVERAGE UNTIL IT WAS A SEAM.
   `fs.constants.O_NOFOLLOW` is undefined on win32 and NON-CONFIGURABLE here, so no test
   can delete it from the environment: the suite stayed fully green with the entire
   branch removed. Calling the extracted function directly is the only way to drive the
   win32 path from a macOS runner, and it is the platform this module exists for. */
test('#1761: with O_NOFOLLOW absent, a symlink target is REFUSED by hand', () => {
  const victim = path.join(SANDBOX, 'seam-victim.txt');
  fs.writeFileSync(victim, 'ORIGINAL');
  const linked = path.join(SANDBOX, 'seam-link.json');
  fs.symlinkSync(victim, linked);

  // The win32 shape: the constant does not exist, so the check must be done by hand.
  assert.throws(() => sendertoken.refuseSymlinkTarget(linked, undefined),
    (e) => e.code === 'ELOOP',
    'a symlink target was accepted on the platform with no O_NOFOLLOW');

  // CONTROLS, or the throw above proves only that it throws at everything.
  const plain = path.join(SANDBOX, 'seam-plain.json');
  fs.writeFileSync(plain, '{}');
  assert.doesNotThrow(() => sendertoken.refuseSymlinkTarget(plain, undefined),
    'a plain file was refused, so the check is not discriminating');
  assert.doesNotThrow(() => sendertoken.refuseSymlinkTarget(path.join(SANDBOX, 'seam-absent.json'), undefined),
    'an absent path was refused: there is nothing there to follow');
  assert.doesNotThrow(() => sendertoken.refuseSymlinkTarget(linked, 256),
    'the check ran even though the kernel would enforce O_NOFOLLOW, which is redundant work');
});

test('#1761: a token DIRECTORY that is already loose is tightened too', () => {
  sendertoken.mint('loose-dir');
  fs.chmodSync(sendertoken.DIR, 0o755);
  assert.equal(fs.statSync(sendertoken.DIR).mode & 0o777, 0o755,
    'the loose dir mode was not planted, so this arm cannot fail for the right reason');
  sendertoken.mint('loose-dir');
  assert.equal(fs.statSync(sendertoken.DIR).mode & 0o777, 0o700,
    'a world-readable token DIRECTORY survived a mint: 0600 on each file still lets anyone list whose tokens exist');
});

/* --------------------------------------------------------------------------
   resolveName: the roster-free reading, for the caller trying to establish
   that a paneless agent exists at all (#1112 phase 1).
   -------------------------------------------------------------------------- */

test('resolveName finds the agent WITHOUT a roster -- the whole point', () => {
  const tok = sendertoken.mint('paneless-one').token;
  const got = sendertoken.resolveName(tok);
  assert.equal(got.ok, true, 'a freshly minted token did not resolve by name: ' + got.because);
  assert.equal(got.key, 'paneless-one', 'resolved to the wrong agent: ' + got.key);
});

/* 🛑 THE ARM THAT MAKES IT WORTH HAVING. `resolve` refuses this exact case,
   because the roster has no card for an agent with no pane. If both refuse,
   the heartbeat can never say "I am here" from a machine without tmux. */
test('resolve REFUSES what resolveName accepts, when there is no pane', () => {
  const tok = sendertoken.mint('paneless-two').token;
  const withRoster = sendertoken.resolve(tok, []);
  assert.equal(withRoster.ok, false, 'resolve accepted an agent that is in no roster');
  assert.equal(sendertoken.resolveName(tok).ok, true,
    'resolveName also refused; a valid token from a tmux-less machine would be unable to identify itself at all');
});

/* ⚠️ THE DISCLOSURE PROPERTY resolve() DOCUMENTS MUST SURVIVE. A distinct
   message for "issued but gone" would confirm the token was once real. */
test('every refusal reads the same, so a probe cannot confirm a token was real', () => {
  const retired = sendertoken.mint('paneless-three').token;
  sendertoken.revoke('paneless-three');
  const gone = sendertoken.resolveName(retired);
  const neverIssued = sendertoken.resolveName('0'.repeat(64));
  assert.equal(gone.ok, false);
  assert.equal(neverIssued.ok, false);
  assert.equal(gone.because, neverIssued.because,
    'a revoked token gives a different message from an unissued one, which confirms it was once real');
});

test('a revoked token cannot heartbeat: revoke still cuts an agent off on this path', () => {
  const tok = sendertoken.mint('paneless-four').token;
  assert.equal(sendertoken.resolveName(tok).ok, true, 'precondition: it resolves before revoke');
  sendertoken.revoke('paneless-four');
  assert.equal(sendertoken.resolveName(tok).ok, false,
    'a revoked token still resolves by name; revoke would no longer cut an agent off');
});

test('an empty token is refused with its own reason, not the generic one', () => {
  const r = sendertoken.resolveName('');
  assert.equal(r.ok, false);
  assert.match(r.because, /no sender token was presented/);
});

/**
 * 🛑 THE REFUSALS MUST BE INDISTINGUISHABLE, AND THAT IS A SECURITY PROPERTY.
 *
 * A caller must not be able to tell whether a token was ever real. "Never issued",
 * "issued then revoked", "issued but the roster row is gone" and "no such token here"
 * are four different internal states and one external answer.
 *
 * ⚠️ WHY THIS TEST EXISTS RATHER THAN A COMMENT. Until 2026-08-27 the property was held
 * by FOUR separate string literals that happened to match. Nothing kept them in sync,
 * and the suite would have stayed green while somebody made one of them more helpful.
 * Recorded on #1112 as resting on "a returned string I control", singular. It was four.
 * They are one constant now, and this is what keeps them one.
 */
test('every refusal that must hide whether a token was real says the SAME sentence', () => {
  const board = fleet.install([fleet.agent('renet-windows', { state: 'idle' })]);
  try {
    const minted = sendertoken.mint('renet-windows');
    assert.equal(minted.ok, true);

    // a token that was never issued: matches no file
    const never = sendertoken.resolve('b'.repeat(64), board.roster);
    // a real token whose roster row is gone: issued, then the agent left the board
    const orphaned = sendertoken.resolve(minted.token, []);

    assert.equal(never.ok, false);
    assert.equal(orphaned.ok, false);
    assert.equal(
      never.because, orphaned.because,
      'a never-issued token and a revoked one gave different answers, which discloses that the second was once real',
    );

    // the name-only path owes the same answer
    const byName = sendertoken.resolveName('c'.repeat(64));
    assert.equal(byName.ok, false);
    assert.equal(byName.because, never.because, 'resolveName drifted from resolve');
  } finally {
    fleet.restore();
  }
});

test('CONTROL: the sentence is one constant, not four literals that happen to agree', () => {
  /* Without this, the test above passes on a file with four copies, which is exactly
     the state that produced the finding. It asserts the STRUCTURE, not the behaviour:
     behaviour agreeing today is what made the fragility invisible. */
  const src = fs.readFileSync(path.join(__dirname, 'sendertoken.js'), 'utf8');
  const literal = "'we could not match that to one of your agents'";
  const copies = src.split(literal).length - 1;
  assert.equal(copies, 1, `the refusal sentence is written out ${copies} times; it must exist once, as NO_MATCH`);
  assert.ok(src.includes('const NO_MATCH ='), 'NO_MATCH is gone; the refusals are loose again');
});

// ⚠️ THE FOURTH REFUSAL SITE, WHICH THE OTHER THREE TESTS DO NOT REACH.
// Measured 2026-08-27 before landing this branch: perturbing the refusal at
// sendertoken.js:206, :209 and :242 each turned this suite red, and perturbing
// the ENOENT branch at :191 did NOT. Three of four covered reads as covered.
//
// 🛑 AND THE FIRST VERSION OF THIS TEST WAS DECORATIVE. It used
// assert.match(because, /could not match.../), which is a SUBSTRING match, so
// appending " (diverged)" to that one site still passed. The tests that catch
// divergence compare two paths to EACH OTHER. A regex proves the sentence is
// present; only equality proves it is the SAME sentence, which is the whole
// point of hoisting it to a constant.
test('the refusal when no token directory exists is the SAME string as the other paths', () => {
  const reference = sendertoken.resolve('', []).ok === false
    ? sendertoken.resolve('a'.repeat(64), []).because
    : null;
  const dir = sendertoken.DIR;
  const moved = dir + '.moved-for-this-test';
  const existed = fs.existsSync(dir);
  if (existed) fs.renameSync(dir, moved);
  try {
    assert.equal(fs.existsSync(dir), false, 'the directory survived, so this test proves nothing');
    const enoent = sendertoken.resolve('a'.repeat(64), []);
    assert.equal(enoent.ok, false);
    if (existed) fs.renameSync(moved, dir);
    const withDir = sendertoken.resolve('a'.repeat(64), []);
    assert.equal(enoent.because, withDir.because,
      'the no-directory refusal drifted from the no-match refusal');
  } finally {
    if (fs.existsSync(moved)) { fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(moved, dir); }
  }
});

/**
 * 🛑 BOTH RESOLVE PATHS MUST REFUSE AN EMPTY TOKEN THE SAME WAY.
 *
 * `resolve` and `resolveName` are two entry points to one question. The comment above
 * `resolveName` promises callers "work on this path exactly as they do on `resolve`",
 * and until 2026-08-27 that promise was kept by TWO string literals that happened to
 * match, with nothing enforcing it and a green suite either way.
 *
 * ⚠️ This is the SECOND half of #1170, missed by its own author one line from the fix.
 * Lower stakes than NO_MATCH, because a caller who sent nothing already knows they sent
 * nothing. It is drift between two paths that matters here, not disclosure.
 */
test('both resolve paths refuse an empty token with the SAME sentence', () => {
  const board = fleet.install([fleet.agent('pete-empty', { state: 'idle' })]);
  try {
    for (const empty of ['', '   ', null, undefined]) {
      const viaResolve = sendertoken.resolve(empty, board.roster);
      const viaName = sendertoken.resolveName(empty);
      assert.equal(viaResolve.ok, false);
      assert.equal(viaName.ok, false);
      assert.equal(
        viaResolve.because,
        viaName.because,
        `the two paths disagree for ${JSON.stringify(empty)}: `
          + `${viaResolve.because} vs ${viaName.because}`,
      );
    }
  } finally { board.restore(); }
});
