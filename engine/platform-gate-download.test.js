'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox the data root so nothing touches a real store when these modules load.
process.env.AGENT_WORKFORCE_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dlgate-')), 'data');

const connect = require('./connect');
const runners = require('./runners');

/* kosmos: the macOS-only gate (Option A), extended to the provider-binary DOWNLOADS
 * at Splinter's ruling 2026-09-01. Both provider binaries are darwin builds -- the
 * Claude Code binary (connect.download, a `darwin-${arch}` fetch) and the Codex
 * runner (runners.install, a codex-...-darwin-arm64 tgz). On any other OS a
 * download would land a Mac binary that cannot run. The gate REFUSES before any
 * bytes move; it fetches no Windows build, so no part of Windows is made to look
 * functional. Each entry takes the platform as a seam (default process.platform)
 * so the refusal is testable on this Mac. */

test('connect.download REFUSES on any non-macOS platform, before any bytes move', async () => {
  // Two different unsupported platforms, each refused with ITS OWN name -> the gate
  // reads the platform parameter and fires for any unsupported OS (not a hardcoded
  // win32), and it throws at the top before any network fetch. The darwin
  // (supported) case is not exercised here on purpose: it would proceed past the
  // gate into a real download service call; isSupported('darwin') === true is
  // pinned in platform.test.js, so on macOS the gate is provably skipped.
  await assert.rejects(
    connect.download(() => {}, undefined, 'win32'),
    (e) => /not supported/.test(e.message) && /win32/.test(e.message),
    'win32 must refuse with a platform-specific message, not fetch a Mac binary');
  await assert.rejects(
    connect.download(() => {}, undefined, 'linux'),
    (e) => /not supported/.test(e.message) && /linux/.test(e.message),
    'linux must refuse too, and name itself -- proving the gate reads the param');
});

test('runners.install REFUSES on a non-macOS platform, in the job shape the screen reads', () => {
  const job = runners.install('claude', { platform: 'win32' });
  assert.equal(job.phase, 'failed', 'an unsupported platform must fail the job, not start a download');
  assert.match(job.because, /not supported/);
  assert.match(job.because, /win32/, 'the refusal names the platform, so it is the gate, not a coincidental failure');
});

test('runners.install CONTROL: the platform gate fires BEFORE other checks, and not on macOS', () => {
  // On win32 the platform refusal wins even for an unknown provider (it is checked
  // first). On darwin the SAME unknown provider gets the unknown-provider refusal
  // instead -- proving the platform gate does not fire on a supported OS, with no
  // download in either arm.
  const win = runners.install('nonesuch', { platform: 'win32' });
  assert.match(win.because, /not supported/, 'win32 hits the platform gate first');

  const mac = runners.install('nonesuch', { platform: 'darwin' });
  assert.equal(mac.phase, 'failed');
  assert.match(mac.because, /do not know how to install/, 'darwin falls through to the unknown-provider refusal');
  assert.doesNotMatch(mac.because, /not supported/, 'the platform gate must NOT fire on macOS');
});
