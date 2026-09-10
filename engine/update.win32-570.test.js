'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * kosmos#570: THE SELF-UPDATER CANNOT RUN ON WINDOWS, AND UNTIL NOW NOTHING SAID SO.
 *
 * `engine/update.js` ends its Install path in
 *
 *     spawn('/bin/sh', ['-c', 'curl -fsSL "$1" | sh; ...'], { detached: true })
 *
 * There is no `/bin/sh` on Windows. The two existing platform gates do not cover
 * this: `isSupported` is TRUE on win32 (the launch substrate landed), and
 * `canDownloadRunner` asks about RUNNER binaries, a different artifact fetched on
 * a different path. So the one route in this product that runs software was
 * gated, on this question, by nothing.
 *
 * 🛑 AND THE FAILURE IS SILENT TWICE OVER TODAY, WHICH IS WHY THE GUARD IS A
 * SENTENCE AND NOT A BOOLEAN. Measured on the shipped Windows bundle: it lays
 * down `runtime/node.exe`, while `installedRoot()` looks for `runtime/bin/node`
 * -- so installedRoot() is null, `/api/status` sends `update: null`, no Install
 * button is ever drawn, and the Settings card answers "Up to date." with a newer
 * release published. Nothing reaches the person at all. The moment somebody
 * teaches installedRoot() the Windows layout -- the first step of any real
 * Windows updater -- the button appears and the spawn ENOENTs. THIS GUARD IS
 * WHAT STANDS THERE WHEN THAT HAPPENS.
 *
 * 🔑 EVERY ARM RUNS FROM EITHER OS. The predicate is pure and takes the platform
 * as a parameter (the seam `store.dataRootFor`, `platform.isSupported` and
 * `connect.download` all use), and the arm that must exercise the REAL
 * `beginInstall` branch on a machine whose `process.platform` cannot be set reads
 * this process and asserts the outcome THAT platform must produce -- so the file
 * is meaningful on the Windows box it was written on AND on the Mac that runs the
 * suite, rather than skipping on one of them.
 *
 *   node --test engine/update.win32-570.test.js
 */

// Sandbox the data root before requiring anything that freezes it.
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-570-upd-'));

const platform = require('./platform');
const liveExec = require('./live-execution');
const update = require('./update');

test('#570 the third question exists and answers honestly for every platform', () => {
  /* One name per question, which is this gate's own stated rule. Reading either
     of the other two here is the bug: `isSupported('win32')` is true, so a
     self-update gated on it would wave Windows straight into `/bin/sh`. */
  assert.equal(platform.canSelfInstall('darwin'), true, 'the Mac runs its own installer');
  assert.equal(platform.canSelfInstall('win32'), false,
    'no /bin/sh, a portable-zip layout, and a running .exe cannot be overwritten in place');
  assert.equal(platform.isSupported('win32'), true,
    'control: win32 RUNS agents -- so isSupported is exactly the name that must NOT gate this');

  // Fail closed, never open, like both siblings.
  for (const p of ['linux', 'aix', 'freebsd', '', null]) {
    assert.equal(platform.canSelfInstall(p), false, String(p) + ' must not self-update');
  }
  assert.equal(platform.canSelfInstall(undefined), platform.SELF_INSTALL.includes(process.platform),
    'explicit undefined means "no argument", so the default fires and reads this process');
  assert.ok(Object.isFrozen(platform.SELF_INSTALL), 'frozen so it cannot be widened at runtime');
  assert.deepEqual(platform.SELF_INSTALL, ['darwin'],
    'a new entry here needs a real updater for that OS, not a list entry');
});

test('#570 the refusal is a sentence naming the next act, not an errno', () => {
  assert.equal(update.selfInstallRefusal('darwin'), null,
    'the control: where self-update works there is no refusal, so the Mac is untouched');

  const win = update.selfInstallRefusal('win32');
  assert.ok(win, 'Windows must be refused');
  assert.match(win, /Windows/, 'it names the platform the person is on');
  assert.match(win, /download the latest build and extract it over your install/,
    'and the ACT: a refusal a person cannot act on is the silence this guard exists to end');
  assert.doesNotMatch(win, /ENOENT|spawn/,
    'the errno is ours, not theirs -- "spawn /bin/sh ENOENT" is not a sentence anyone can act on');

  assert.ok(update.selfInstallRefusal('linux'), 'any platform off the list is refused, not just win32');
});

test('#570 beginInstall refuses BEFORE the spawn, and releases single-flight when it does', () => {
  update.resetCache();
  liveExec.resetForTests();
  assert.equal(update.alreadyInstalling(), false, 'precondition: single-flight is clear');

  const expected = update.selfInstallRefusal();   // reads THIS process, whichever it is
  let err = null;
  try { update.beginInstall({}); } catch (e) { err = e; }

  if (expected) {
    /* On a platform that cannot self-update (this file was written on win32).
       Nothing spawned, and the reason is recorded where the status payload
       already carries it -- `/api/status` sends lastAttempt() as `updateAttempt`. */
    assert.ok(err, 'the refusal must be loud: a silent return is the defect');
    assert.equal(err.message, expected, 'and it is the actionable sentence, unchanged');
    assert.equal(update.lastAttempt().because, expected,
      'recorded on the attempt, so a screen can render it without one being built here');
    assert.equal(update.lastAttempt().code, null, 'no installer ran, so there is no exit code to claim');
    /* 🛑 THE ARM THAT MATTERS MOST. beginInstall sets installStarted TRUE at its
       top; a refusal that left it set would answer every later press "already
       updating" for the life of the board. */
    assert.equal(update.alreadyInstalling(), false, 'single-flight released, so a retry is a real attempt');
  } else {
    /* On darwin the platform gate is transparent, and the NEXT gate is the one
       that catches a test process. Asserting we reached IT is how this arm proves
       the platform guard did not refuse the Mac -- a control that can fail. */
    assert.ok(err, 'in a test process the live-execution gate throws');
    assert.match(String(err.message), /live-execution|allowLiveExecution|no opt-in/i,
      'darwin must reach the live-execution gate, not be stopped by the platform one');
    assert.doesNotMatch(String(err.message), /cannot update itself/,
      'the Mac must never see the platform refusal');
  }
});

const SRC = fs.readFileSync(path.join(__dirname, 'update.js'), 'utf8');

test('#570 the guard is upstream of the spawn in the source, not merely nearby', () => {
  /* A source pin, for the same reason update.test.js pins the spawn shape: the
     only way to observe the detached `curl | sh` directly is to LET IT HAPPEN,
     which is the hazard. Order in the source is the cheap observation. */
  const guard = SRC.indexOf('const refusal = selfInstallRefusal();');
  const needle = 'spawn(\'' + '/bin/sh\'';   // split, for the reason the next arm states
  const spawnAt = SRC.indexOf(needle);
  assert.ok(guard > -1, 'the platform guard is gone from beginInstall');
  assert.ok(spawnAt > -1, 'the installer spawn moved; re-point this guard at it');
  assert.ok(guard < spawnAt, 'the guard must be BEFORE the detached spawn -- after it, nothing can be recalled');

  assert.match(SRC, /platformGate\.canSelfInstall\(/,
    'update.js must ask the platform gate, not keep its own private list');
  assert.doesNotMatch(SRC, /platformGate\.isSupported\(/,
    'gating self-update on isSupported waves win32 (which IS supported) into /bin/sh');
});

test('#570 the installer call appears ONCE in update.js, comments included', () => {
  /* 🛑 A REAL MISTAKE, CAUGHT AND THEN PINNED. The first draft of the guard above
     described what it was guarding by quoting the call verbatim in its docblock.
     update.test.js finds the reviewed command shape by indexing this source for
     that exact character sequence and slicing FORWARD from it -- so the comment
     became the first hit, and the guard that protects the one command in this
     product ending in `| sh` went green while reading a paragraph of prose.
     ⚠️ THE FAILURE MODE IS THE POINT: it does not go red, it goes green on the
     wrong text. Nothing else in the tree would have said so. Both this arm and
     the one above therefore build the needle by concatenation rather than
     writing it out, or they would trip their own rule. */
  const needle = 'spawn(\'' + '/bin/sh\'';
  const hits = SRC.split(needle).length - 1;
  assert.equal(hits, 1,
    'the installer call must appear exactly once; a comment quoting it hijacks update.test.js\'s shape guard');
});

test('#570 the route surfaces the refusal, ahead of the arm that would answer wrongly', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const mine = server.indexOf('updates.selfInstallRefusal()');
  const source = server.indexOf('this Kosmos runs from its source code, so it updates from git');
  assert.ok(mine > -1, 'POST /api/update must ask for the platform refusal');
  assert.ok(source > -1, 'the from-source arm moved; re-point this guard');
  /* ⚠️ ORDER, AND IT IS NOT COSMETIC. The shipped Windows bundle is
     `runtime/node.exe`, so `installedRoot()` (which looks for `runtime/bin/node`)
     reads null there -- and the from-source arm would tell a portable-zip install
     "this Kosmos runs from its source code", which is false and points at git. */
  assert.ok(mine < source, 'the platform refusal must answer before the from-source arm');
});
