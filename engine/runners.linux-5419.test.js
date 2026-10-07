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
  assert.equal(x64.version, runners.manifestFor('openai', 'darwin', 'arm64').version, 'the same pinned release as the Mac');
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
