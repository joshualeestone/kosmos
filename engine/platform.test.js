'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('./platform');

/* kosmos: the platform gate. engine/platform.js is the single source of truth for
 * what an OS can do here. It is PURE, taking the platform as a parameter (like
 * store.dataRootFor), so every platform is testable from any host without the box.
 *
 * 🔑 #570: THIS FILE USED TO PIN "macOS ONLY", AND IT WAS RIGHT TO. It said
 * "adding one is a real port, not an entry", and that is exactly what held the
 * line until the port existed. win32 is on the list now because
 * engine/win32launch.js is that port -- the launchd-substrate analog, measured on
 * a real Windows box with four concurrent agents live on the board under their
 * recorded names. The rule this file was defending is UNCHANGED and re-asserted
 * below; only the fact it was defending has moved.
 *
 * 🛑 AND THE GATE SPLIT IN TWO, which is the other half of #570. Two callers read
 * `isSupported` to refuse a DOWNLOAD rather than to refuse running an agent:
 * connect.js fetches Claude Code as `darwin-${arch}`, runners.js pins codex to a
 * `-darwin-arm64` tarball. Adding win32 to SUPPORTED without splitting those would
 * have armed Kosmos to download MACOS BINARIES ONTO WINDOWS -- the precise
 * half-succeed the gate was written to prevent, caused by the change meant to make
 * Windows work. One name per question, and both are pinned here. */

test('#570 win32 RUNS agents but CANNOT be sent a runner download', () => {
  /* The two questions, and the whole reason there are two names. Reading the
     wrong one is not a style problem: it downloads a Mac build onto Windows. */
  assert.equal(platform.isSupported('win32'), true, 'the launch substrate landed, so agents run');
  assert.equal(platform.canDownloadRunner('win32'), false,
    'but the published runner artifacts are darwin builds, and no port changes that');

  assert.equal(platform.isSupported('darwin'), true);
  assert.equal(platform.canDownloadRunner('darwin'), true, 'the Mac can still fetch its own');

  assert.equal(platform.isSupported('linux'), false, 'Linux has no substrate');
  assert.equal(platform.canDownloadRunner('linux'), false);
});

test('an unknown/empty/null platform is supported by NEITHER gate (fail closed, never open)', () => {
  for (const p of ['aix', 'sunos', 'freebsd', '', null]) {
    assert.equal(platform.isSupported(p), false, String(p) + ' must not run agents');
    assert.equal(platform.canDownloadRunner(p), false, String(p) + ' must not fetch a runner');
  }
  // Explicit `undefined` == "no argument", so the default parameter fires and it
  // reads THIS process (see platform.js). Every real platform VALUE fails closed;
  // only "call with nothing" reads the process, which is the intended default.
  assert.equal(platform.isSupported(undefined), platform.SUPPORTED.includes(process.platform));
  assert.equal(platform.canDownloadRunner(undefined), platform.RUNNER_DOWNLOADS.includes(process.platform));
});

test('the no-argument form reads this process and agrees with the lists', () => {
  assert.equal(platform.isSupported(), platform.SUPPORTED.includes(process.platform));
  assert.equal(platform.canDownloadRunner(), platform.RUNNER_DOWNLOADS.includes(process.platform));
});

test('describe() returns machine facts only -- no user-facing copy', () => {
  assert.deepEqual(platform.describe('win32'),
    { platform: 'win32', supported: true, runnerDownloads: false });
  assert.deepEqual(platform.describe('darwin'),
    { platform: 'darwin', supported: true, runnerDownloads: true });
  assert.deepEqual(platform.describe('linux'),
    { platform: 'linux', supported: false, runnerDownloads: false });
  const d = platform.describe();
  assert.equal(d.platform, process.platform, 'describe() defaults to this process');
  assert.equal(d.supported, platform.isSupported());
  assert.equal(d.runnerDownloads, platform.canDownloadRunner());
  /* No copy: machine facts only, so a screen cannot render an engineer-authored
     sentence where the operator's copy belongs. `runnerDownloads` is reported
     SEPARATELY because a platform can now run agents while being unable to fetch
     one for itself, and a screen that says only "supported" cannot express that. */
  assert.deepEqual(Object.keys(d).sort(), ['platform', 'runnerDownloads', 'supported']);
});

test('both lists are frozen, and a THIRD platform is still a real port (not an entry)', () => {
  /* ⚠️ THE RULE THIS FILE WAS ALWAYS DEFENDING, restated rather than deleted. The
     old arm read `deepEqual(SUPPORTED, ['darwin'])` and its name said "adding one
     is a real port, not an entry" -- that is what stopped anyone widening the gate
     casually, and it worked: win32 waited for engine/win32launch.js. Pinning the
     exact contents is how that intent is enforced, so it stays pinned, just to the
     new truth. Anyone adding a third entry has to come here and justify it. */
  assert.deepEqual(platform.SUPPORTED, ['darwin', 'win32'],
    'a new platform needs a substrate that runs agents there, not a list entry');
  assert.deepEqual(platform.RUNNER_DOWNLOADS, ['darwin'],
    'a new platform needs PUBLISHED runner builds, which is somebody real work');
  assert.ok(Object.isFrozen(platform.SUPPORTED), 'frozen so it cannot be widened at runtime');
  assert.ok(Object.isFrozen(platform.RUNNER_DOWNLOADS), 'same');
});

test('the gate the server uses: it arms live execution iff the substrate runs there', () => {
  // The real-start block in server.js (inside `if (require.main === module)`) is
  // not unit-testable by design -- requiring the module must not arm live
  // execution. This pins the DECISION that block makes: arm iff isSupported.
  const armDecision = (plat) => platform.isSupported(plat); // what server.js branches on
  assert.equal(armDecision('darwin'), true, 'macOS arms live execution');
  assert.equal(armDecision('win32'), true, 'and Windows does now, because agents run there');
  assert.equal(armDecision('linux'), false, 'Linux leaves it unarmed -> substrate fails closed');
});

test('#570 the DOWNLOAD gates read the download predicate, not the substrate one', () => {
  /* A source pin, because this is the mistake that would silently re-appear: the
     two call sites are `if (!platformGate.canDownloadRunner(...))`, and swapping
     either back to `isSupported` compiles, passes every behavioural arm on a Mac
     (where both answers are identical), and starts fetching darwin binaries for
     Windows users. Only reading the source can catch that from here. */
  const fs = require('node:fs');
  const path = require('node:path');
  for (const rel of ['connect.js', 'runners.js']) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.match(src, /platformGate\.canDownloadRunner\(/,
      rel + ' must gate its runner download on canDownloadRunner');
    assert.doesNotMatch(src, /platformGate\.isSupported\(/,
      rel + ' must NOT gate a download on isSupported -- win32 is supported and still has no build');
  }
});
