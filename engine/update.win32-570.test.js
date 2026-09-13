'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * kosmos#570, now ARMED for win32 (updater slice S4).
 *
 * #570 added the third platform gate -- `canSelfInstall` -- because the self-updater ended in
 * `spawn('/bin/sh', ...)`, which cannot run on Windows, and neither `isSupported` (true on win32)
 * nor `canDownloadRunner` covered "can Kosmos replace ITSELF here". For three slices the honest
 * answer on win32 was no, and this file pinned the refusal.
 *
 * 🔑 S4 FLIPS IT. The in-app updater exists now (engine/win32update.js downloads/verifies/stages,
 * engine/win32apply.js swaps in place and rolls back), so win32 CAN replace itself -- through that
 * updater, never through `/bin/sh`. This file now pins the armed truth: canSelfInstall('win32') is
 * true, SELF_INSTALL is ['darwin','win32'] and still frozen, the win32 refusal is gone, and
 * beginInstall routes win32 to win32update.begin() rather than to the Mac spawn.
 *
 * 🛑 THE MAC SPAWN GUARD IS UNTOUCHED. The source pins that keep the `/bin/sh` gate upstream of the
 * spawn, and the installer call appearing exactly once, still hold -- the Mac path is unchanged.
 *
 *   node --test engine/update.win32-570.test.js
 */

// Sandbox the data root before requiring anything that freezes it.
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-570-upd-'));

const platform = require('./platform');
const liveExec = require('./live-execution');
const update = require('./update');

test('#570/S4 the third question answers "yes" for win32 now, and the set stays frozen', () => {
  assert.equal(platform.canSelfInstall('darwin'), true, 'the Mac runs its own installer');
  assert.equal(platform.canSelfInstall('win32'), true,
    'S4: win32 self-installs through the in-app updater (win32update + win32apply), not /bin/sh');
  assert.equal(platform.isSupported('win32'), true, 'control: win32 has run agents since the port landed');

  // Fail closed for every OTHER platform, never open.
  for (const p of ['linux', 'aix', 'freebsd', '', null]) {
    assert.equal(platform.canSelfInstall(p), false, String(p) + ' must not self-update');
  }
  assert.equal(platform.canSelfInstall(undefined), platform.SELF_INSTALL.includes(process.platform),
    'explicit undefined means "no argument", so the default fires and reads this process');
  assert.ok(Object.isFrozen(platform.SELF_INSTALL), 'frozen so it cannot be widened at runtime');
  assert.deepEqual(platform.SELF_INSTALL, ['darwin', 'win32'],
    'a new entry here needs a real updater for that OS, not a list entry -- win32 earned its place with S2-S4');
});

test('#570/S4 win32 is no longer refused; a platform off the list still is, in a sentence', () => {
  assert.equal(update.selfInstallRefusal('darwin'), null, 'the Mac was never refused');
  assert.equal(update.selfInstallRefusal('win32'), null, 'S4: win32 self-installs in-app, so there is no refusal to show');

  const off = update.selfInstallRefusal('linux');
  assert.ok(off, 'a platform with neither the /bin/sh installer nor the in-app updater is refused');
  assert.match(off, /linux/, 'the refusal names the platform the person is on');
  assert.doesNotMatch(off, /ENOENT|spawn/, 'the errno is ours, not theirs');
});

test('#570/S4 beginInstall no longer throws the platform refusal on win32; it routes to win32update.begin', async () => {
  update.resetCache();
  liveExec.resetForTests();
  assert.equal(update.alreadyInstalling(), false, 'precondition: single-flight is clear');

  if (process.platform === 'win32') {
    /* On this Windows box the #570 defect was: teach installedRoot the layout and the Update button
       spawns `/bin/sh` -> ENOENT. S4 makes that impossible -- the win32 branch never spawns a shell.
       A stubbed installer stands in for win32update.begin so nothing real downloads or swaps. */
    let seen = null;
    update.setWindowsInstaller(async (o) => { seen = o; return { ok: false, because: 'stubbed win32 refusal' }; });
    update.setInstalledRoot(() => 'C:/Users/someone/Kosmos');
    try {
      assert.doesNotThrow(() => update.beginInstall({}), 'win32 must not throw the platform refusal any more');
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(seen, 'beginInstall did not reach the win32 in-app updater');
      assert.equal(seen.root, 'C:/Users/someone/Kosmos', 'the running bundle root was not handed to the updater');
      assert.equal(update.alreadyInstalling(), false, 'a refusal released single-flight, so a retry is a real attempt');
      assert.match(update.lastAttempt().because, /stubbed win32 refusal/, 'the refusal was recorded on the attempt');
    } finally {
      update.setWindowsInstaller(null);
      update.setInstalledRoot(null);
    }
  } else {
    /* On darwin the platform gate is transparent, and the NEXT gate (live execution) is the one that
       catches a test process. Reaching IT proves the platform guard did not refuse the Mac. */
    let err = null;
    try { update.beginInstall({}); } catch (e) { err = e; }
    assert.ok(err, 'in a test process the live-execution gate throws');
    assert.match(String(err.message), /live-execution|allowLiveExecution|no opt-in/i,
      'darwin must reach the live-execution gate, not be stopped by the platform one');
    assert.doesNotMatch(String(err.message), /cannot update itself/, 'the Mac must never see the platform refusal');
  }
});

const SRC = fs.readFileSync(path.join(__dirname, 'update.js'), 'utf8');

test('#570 the Mac guard is still upstream of the spawn in the source', () => {
  /* A source pin, for the same reason update.test.js pins the spawn shape: the only way to observe
     the detached `curl | sh` directly is to LET IT HAPPEN, which is the hazard. Order in the source
     is the cheap observation, and the Mac path is unchanged by S4. */
  const guard = SRC.indexOf('const refusal = selfInstallRefusal();');
  const needle = 'spawn(\'' + '/bin/sh\'';   // split, for the reason the next arm states
  const spawnAt = SRC.indexOf(needle);
  assert.ok(guard > -1, 'the platform guard is gone from beginInstall');
  assert.ok(spawnAt > -1, 'the installer spawn moved; re-point this guard at it');
  assert.ok(guard < spawnAt, 'the guard must be BEFORE the detached spawn -- after it, nothing can be recalled');

  assert.match(SRC, /platformGate\.canSelfInstall\(/, 'update.js must ask the platform gate, not keep its own private list');
  assert.doesNotMatch(SRC, /platformGate\.isSupported\(/, 'gating self-update on isSupported waves win32 into /bin/sh');
});

test('#570 the installer call appears ONCE in update.js, comments included', () => {
  /* A real mistake, caught and then pinned: a comment quoting the call verbatim becomes the first hit
     for update.test.js's shape guard, which then reads prose. Both arms build the needle by
     concatenation so they do not trip their own rule. */
  const needle = 'spawn(\'' + '/bin/sh\'';
  const hits = SRC.split(needle).length - 1;
  assert.equal(hits, 1, 'the installer call must appear exactly once; a comment quoting it hijacks the shape guard');
});

test('#570 the route surfaces the platform refusal ahead of the from-source arm', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const mine = server.indexOf('updates.selfInstallRefusal()');
  const source = server.indexOf('this Kosmos runs from its source code, so it updates from git');
  assert.ok(mine > -1, 'POST /api/update must ask for the platform refusal');
  assert.ok(source > -1, 'the from-source arm moved; re-point this guard');
  assert.ok(mine < source, 'the platform refusal must answer before the from-source arm');
});
