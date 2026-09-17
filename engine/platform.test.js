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

test('#3159 win32 CAN be sent a Claude Code download (its own list), while codex stays darwin-only', () => {
  /* The finer split #3159 forced. Claude Code now publishes win32-x64/win32-arm64
     builds with manifest checksums (verified against a real binary), so its OWN gate
     includes win32 -- a checksum-verified fetch of the platform's own build, not a Mac
     binary onto Windows. The coarse `canDownloadRunner` stays codex-only (darwin), the
     one vendored tarball. Conflating them would fetch a Mac codex tarball onto Windows. */
  assert.equal(platform.canDownloadClaude('win32'), true, 'Claude publishes a win32 build');
  assert.equal(platform.canDownloadRunner('win32'), false, 'codex does not -- still darwin-only');
  assert.equal(platform.canDownloadClaude('darwin'), true, 'and the Mac keeps its own');
  assert.equal(platform.canDownloadClaude('linux'), false, 'no linux Claude build is published');
  for (const p of ['aix', 'sunos', '', null]) {
    assert.equal(platform.canDownloadClaude(p), false, String(p) + ' fails closed, never open');
  }
  assert.equal(platform.canDownloadClaude(undefined), platform.CLAUDE_DOWNLOADS.includes(process.platform),
    'no-argument form reads this process');
  assert.deepEqual(platform.CLAUDE_DOWNLOADS, ['darwin', 'win32'],
    'win32 is here because a checksum-verifiable Windows Claude build is published');
  assert.ok(Object.isFrozen(platform.CLAUDE_DOWNLOADS), 'frozen so it cannot be widened at runtime');
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
  // win32 is the case that proves the two download facts DIVERGE: it cannot fetch the
  // codex runner (runnerDownloads:false) but CAN fetch Claude Code (claudeDownloads:true).
  assert.deepEqual(platform.describe('win32'),
    { platform: 'win32', supported: true, runnerDownloads: false, claudeDownloads: true });
  assert.deepEqual(platform.describe('darwin'),
    { platform: 'darwin', supported: true, runnerDownloads: true, claudeDownloads: true });
  assert.deepEqual(platform.describe('linux'),
    { platform: 'linux', supported: false, runnerDownloads: false, claudeDownloads: false });
  const d = platform.describe();
  assert.equal(d.platform, process.platform, 'describe() defaults to this process');
  assert.equal(d.supported, platform.isSupported());
  assert.equal(d.runnerDownloads, platform.canDownloadRunner());
  assert.equal(d.claudeDownloads, platform.canDownloadClaude());
  /* No copy: machine facts only. Each capability is reported SEPARATELY because they
     diverge -- a platform can run agents, be unable to fetch the codex runner, yet still
     fetch Claude Code (win32). A consumer must read claudeDownloads, not runnerDownloads,
     to decide whether Claude can be installed. */
  assert.deepEqual(Object.keys(d).sort(), ['claudeDownloads', 'platform', 'runnerDownloads', 'supported']);
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

test('#570/#3159 the DOWNLOAD gates read a download predicate, not the substrate one -- and the RIGHT per-runner one', () => {
  /* A source pin, because this is the mistake that would silently re-appear: swapping
     a download gate back to `isSupported` compiles, passes every behavioural arm on a
     Mac (where the answers are identical), and starts fetching darwin binaries for
     Windows users. #3159 adds a SECOND trap: the two downloads no longer share one
     predicate. connect.js fetches CLAUDE (which publishes a win32 build) and must read
     `canDownloadClaude`; runners.js fetches CODEX (darwin-only tarball) and must keep
     `canDownloadRunner`. Swapping connect.js back to canDownloadRunner would re-refuse
     Claude on Windows (the investor dead-end); swapping runners.js to canDownloadClaude
     would fetch a Mac codex tarball onto Windows. Only reading the source catches either. */
  const fs = require('node:fs');
  const path = require('node:path');
  const connectSrc = fs.readFileSync(path.join(__dirname, 'connect.js'), 'utf8');
  assert.match(connectSrc, /platformGate\.canDownloadClaude\(/,
    'connect.js must gate the Claude download on canDownloadClaude (win32 has a published build)');
  assert.doesNotMatch(connectSrc, /platformGate\.isSupported\(/,
    'connect.js must NOT gate a download on isSupported');
  const runnersSrc = fs.readFileSync(path.join(__dirname, 'runners.js'), 'utf8');
  assert.match(runnersSrc, /platformGate\.canDownloadRunner\(/,
    'runners.js must gate the codex download on canDownloadRunner (codex is darwin-only)');
  assert.doesNotMatch(runnersSrc, /platformGate\.isSupported\(/,
    'runners.js must NOT gate a download on isSupported');
});
