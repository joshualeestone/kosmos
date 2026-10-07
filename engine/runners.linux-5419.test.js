'use strict';
/*
 * #5419 slice 2: the provider runners on Linux. Codex and Grok take their own Linux builds (each the npm registry's
 * own tarball, pinned with its registry sha512); Gemini's bundle is one tarball for every platform. Literal expected
 * values, so a selector that hands Linux the Mac or Windows build fails here.
 *
 *   node --test engine/runners.linux-5419.test.js
 */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Sandboxed before runners loads, so presence is this file's, never the Mac's own installed runners.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runners-linux-'));
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
for (const k of ['AGENT_WORKFORCE_CODEX_BIN', 'AGENT_WORKFORCE_GROK_BIN', 'AGENT_WORKFORCE_GEMINI_BIN']) delete process.env[k];
const runners = require('./runners');
const platformGate = require('./platform');

test('#5419: Linux Codex is the linux build for the CPU, pinned to the registry sha512, with its musl binary', () => {
  const x64 = runners.manifestFor('openai', 'linux', 'x64');
  assert.equal(x64.url, 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-linux-x64.tgz');
  assert.equal(x64.integrity, 'sha512-Of5fGYgr7tAMsyj6vhXb4/RM/UoA3Zq8BLegUBDC09UNy1XTLGYP/2XD+UX8z3qh0NDwxYdCjFIWdDNijKZggQ==');
  assert.equal(x64.binInPackage, 'vendor/x86_64-unknown-linux-musl/bin/codex');
  assert.equal(x64.binName, 'codex', 'the stable name is the Mac one, not codex.exe');
  assert.equal(x64.arch, 'x64');
  const arm = runners.manifestFor('openai', 'linux', 'arm64');
  assert.equal(arm.url, 'https://registry.npmjs.org/@openai/codex/-/codex-0.149.1-linux-arm64.tgz');
  assert.equal(arm.binInPackage, 'vendor/aarch64-unknown-linux-musl/bin/codex');
  assert.equal(arm.arch, 'arm64');
  // Every pin as a literal, so a typo in any of them fails here, not as a checksum refusal on a real box.
  assert.equal(arm.integrity, 'sha512-OqxUfZ1TVvHd18zHPKK/8ZRlpk8Vy11mg5CMHaLxNWldTbwVImDKtSLWT+m8m4NM5Sz4PbjtZMrVT/RfpBW/mQ==');
  assert.equal(x64.downloadBytes, 125550959);
  assert.equal(arm.downloadBytes, 118078094);
  assert.equal(x64.version, '0.149.1', 'the pinned release (literal, not read off the Mac entry)');
});

test('#5419: Linux Grok is the linux build for the CPU, laid out as the Mac one (bin/grok.br to bin/grok-native)', () => {
  const x64 = runners.manifestFor('grok', 'linux', 'x64');
  assert.equal(x64.url, 'https://registry.npmjs.org/@xai-official/grok-linux-x64/-/grok-linux-x64-1.0.41.tgz');
  assert.equal(x64.integrity, 'sha512-5KS0AMeGYQh3++0EEZPKVjAcalFQma8K5SKMhBu1k1OVNpA/lO+fRgecS1/kOsLaGaPDPfQm611Z+a5J9dLfAg==');
  assert.equal(x64.brotliFrom, 'bin/grok.br');
  assert.equal(x64.binInPackage, 'bin/grok-native');
  assert.equal(x64.binName, 'grok');
  const arm = runners.manifestFor('grok', 'linux', 'arm64');
  assert.equal(arm.url, 'https://registry.npmjs.org/@xai-official/grok-linux-arm64/-/grok-linux-arm64-1.0.41.tgz');
  assert.equal(arm.arch, 'arm64');
  assert.equal(arm.integrity, 'sha512-6g8fHFwKb/jdo3XTGXMiA5FrzzUi6q5nKtT3+eXNbNKGtMOmN4t7NNh+IK3S6FlWcG+slL1Po2YDaNgMZ6swqg==');
  assert.equal(x64.downloadBytes, 49179836);
  assert.equal(arm.downloadBytes, 44233139);
});

test('#5419: Linux Gemini is the one bundle every platform gets, reached by the POSIX launcher', () => {
  const linux = runners.manifestFor('gemini', 'linux', 'x64');
  const mac = runners.manifestFor('gemini', 'darwin', 'arm64');
  assert.equal(linux.url, mac.url);
  assert.equal(linux.integrity, mac.integrity);
  assert.equal(linux.binName, mac.binName, 'not the Windows .cmd launcher');
});

test('#5419: a Linux CPU with no published build is refused by name before a byte moves', () => {
  for (const p of ['openai', 'grok']) {
    let fetched = false;
    const job = runners.install(p, { platform: 'linux', arch: 'ia32', legacyBin: path.join(SANDBOX, 'no-legacy'), download: () => { fetched = true; return Promise.resolve(); } });
    assert.equal(job.phase, 'failed', p + ': an ia32 Linux box was not refused');
    assert.match(job.because, /is x64 and this computer is ia32/);
    assert.equal(fetched, false, p + ': something was downloaded for a CPU with no build');
  }
});

test('#5419: the gates let Linux through for Codex, Gemini and Grok; Claude\'s link path stays darwin-only', () => {
  assert.equal(platformGate.canDownloadCodex('linux'), true);
  assert.equal(platformGate.canDownloadKeyedRunner('linux'), true);
  assert.equal(platformGate.canDownloadRunner('linux'), false, 'CONTROL: the claude arm of runners.install is unchanged');
});

test('#5419: tar on Linux is /usr/bin/tar where /usr is merged and /bin/tar where it is not; the Mac is unchanged', () => {
  assert.equal(runners.tarBin('linux', {}, () => true), '/usr/bin/tar', 'both present (a merged /usr): /usr/bin/tar first');
  assert.equal(runners.tarBin('linux', {}, (p) => p === '/usr/bin/tar'), '/usr/bin/tar');
  assert.equal(runners.tarBin('linux', {}, (p) => p === '/bin/tar'), '/bin/tar', 'an unmerged /usr (or busybox) has tar only in /bin');
  assert.equal(runners.tarBin('linux', {}, () => false), 'tar', 'neither (Nix, a minimal container): tar from PATH');
  assert.equal(runners.tarBin('darwin', {}, () => false), '/usr/bin/tar', 'CONTROL: the Mac path is the same as before');
});

test('#5419: install() does not consult the musl detector for Grok on Linux (its builds were measured static)', async (t) => {
  // Measured 2026-10-06: the x64 binary is static-pie and the arm64 one static (neither names a program loader).
  // Limit: this catches a refusal that reads connect's musl detector; a refusal on some other signal would need its own
  // test. Grep says install() has no musl branch at all today.
  const connect = require('./connect');
  connect.setMuslDetectForTests(() => true);
  t.after(() => connect.setMuslDetectForTests(null));
  let asked = false;
  const job = runners.install('grok', { platform: 'linux', arch: 'x64', legacyBin: path.join(SANDBOX, 'no-legacy'), download: () => { asked = true; return Promise.reject(new Error('stop: a test download')); } });
  await job.settled;
  assert.equal(asked, true, 'a musl host was refused a build that is statically linked');
  assert.doesNotMatch(String(job.because || ''), /musl/);
  runners.resetForTests();   // no failed grok job left for a test added after this one
});
