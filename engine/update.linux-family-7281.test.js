'use strict';
require('../test-support/tmpscope');   // kosmos#4273: every temp folder this file makes is removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * kosmos#7281 slice D: a Linux x86_64 board reads its own release family's pointer (latest-linux.json /
 * latest-linux-staging.json) and its tarball name (kosmos-<v>-linux-x64.tar.gz). TRANSITIONAL, the engine's half of
 * setup.sh slice B: while that pointer gives no readable version, a board that is not already a Linux-family install
 * reads the Mac pair it has always read; a Linux-family install never does (no offer rather than a downgrade).
 * The platform and arch are seams (setPlatform), the network is a stub, so every arm runs from any OS.
 *
 *   node --test engine/update.linux-family-7281.test.js
 */

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-linuxfam-'));

const update = require('./update');

const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'AGENT_WORKFORCE_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'AGENT_WORKFORCE_RELEASE_BASE'];
let savedEnv = {};
const BASE = 'https://example.invalid/dist';
const answer = (body) => ({ ok: true, json: async () => body });
const missing = () => ({ ok: false, status: 404, json: async () => null });

function linuxPointer(version, over) {
  return { version, sha256: 'cd'.repeat(32), versioned: `kosmos-${version}-linux-x64.tar.gz`, ...(over || {}) };
}
/* A stub host: `files` maps a pointer file name to a body (null: 404). Records every file asked for. */
function host(files) {
  const asked = [];
  update.setFetcher(async (url) => {
    const name = url.slice(BASE.length + 1);
    asked.push(name);
    return Object.prototype.hasOwnProperty.call(files, name) && files[name] !== null ? answer(files[name]) : missing();
  });
  return asked;
}
/* An installed root whose runtime/bin/node is its own regular file (linked false) or a link to a system one. */
function rootWithNode(linked) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-linuxfam-root-'));
  fs.mkdirSync(path.join(r, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(r, 'app'), { recursive: true });
  fs.writeFileSync(path.join(r, 'app', 'server.js'), '');
  const own = path.join(r, 'runtime', 'bin', linked ? 'system-node' : 'node');
  fs.writeFileSync(own, '#!/bin/sh\n', { mode: 0o755 });
  if (linked) fs.symlinkSync(own, path.join(r, 'runtime', 'bin', 'node'));
  return r;
}

test.beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.KOSMOS_RELEASE_BASE = BASE;
  update.resetCache();
  update.setFetcher(null);
  update.setPlatform('linux', 'x64');
  update.setInstalledRoot(() => null);
  update.setAutoPref(() => ({ on: false, ok: true }));
  update.setRecordedChannel(() => 'prod');
});
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  update.setPlatform(null);
  update.setFetcher(null);
  update.setInstalledRoot(null);
  update.setAutoPref(null);
  update.setRecordedChannel(null);
  update.resetCache();
});

test('#7281: the pointer per platform, arch and channel (Mac, Windows and ARM Linux unchanged)', () => {
  assert.equal(update.pointerFor('linux', 'prod', 'x64'), 'latest-linux.json');
  assert.equal(update.pointerFor('linux', 'staging', 'x64'), 'latest-linux-staging.json');
  // CONTROLS: what every other platform read before this card.
  assert.equal(update.pointerFor('linux', 'prod', 'arm64'), 'latest.json', 'an ARM Linux board took the x86_64 family');
  assert.equal(update.pointerFor('darwin', 'prod', 'x64'), 'latest.json');
  assert.equal(update.pointerFor('darwin', 'staging', 'arm64'), 'latest-staging.json');
  assert.equal(update.pointerFor('win32', 'prod', 'x64'), 'latest-win.json');
  assert.equal(update.pointerFor('win32', 'staging', 'arm64'), 'latest-win-staging.json');
});

test('#7281: the Linux pointer must name this version\'s linux-x64 tarball and carry a sha256', () => {
  const ok = update.readManifest('linux', linuxPointer('1.2.3'), 'x64');
  assert.deepEqual(ok, { version: '1.2.3', sha256: 'cd'.repeat(32), versioned: 'kosmos-1.2.3-linux-x64.tar.gz' });
  assert.equal(update.readManifest('linux', linuxPointer('1.2.3', { versioned: 'kosmos-1.2.3-arm64.tar.gz' }), 'x64'), null,
    'a pointer naming the Mac tarball was offered to a Linux board');
  assert.equal(update.readManifest('linux', linuxPointer('1.2.3', { versioned: 'kosmos-1.2.4-linux-x64.tar.gz' }), 'x64'), null);
  assert.equal(update.readManifest('linux', linuxPointer('1.2.3', { sha256: 'nope' }), 'x64'), null);
  // CONTROL: the Mac rule reads a Mac-shaped pointer, as on an ARM Linux board or in the fallback.
  assert.deepEqual(update.readManifest('darwin', { version: '1.2.3' }, 'x64'), { version: '1.2.3' });
  assert.deepEqual(update.readManifest('linux', { version: '1.2.3' }, 'arm64'), { version: '1.2.3' });
});

test('#7281: with the Linux pointer published, a Linux x86_64 board offers its version and never reads the Mac one', async () => {
  const asked = host({ 'latest-linux.json': linuxPointer('99.0.0'), 'latest.json': { version: '98.0.0' } });
  await update.checkNow();
  assert.deepEqual(asked, ['latest-linux.json']);
  assert.equal(update.available().version, '99.0.0');
});

test('#7281 TRANSITIONAL: with no Linux pointer, a portable install reads the Mac pair as it always did', async () => {
  let asked = host({ 'latest.json': { version: '99.0.0' } });
  await update.checkNow();
  assert.deepEqual(asked, ['latest-linux.json', 'latest.json']);
  assert.equal(update.available().version, '99.0.0');
  // A linked system node is the portable bundle too.
  update.resetCache();
  update.setInstalledRoot(() => rootWithNode(true));
  asked = host({ 'latest.json': { version: '99.0.0' } });
  await update.checkNow();
  assert.deepEqual(asked, ['latest-linux.json', 'latest.json']);
  // The staging channel falls back to the Mac staging pointer, never to prod's.
  update.resetCache();
  update.setInstalledRoot(() => null);
  process.env.KOSMOS_UPDATE_CHANNEL = 'staging';
  asked = host({ 'latest-staging.json': { version: '99.0.0' } });
  await update.checkNow();
  assert.deepEqual(asked.slice(0, 2), ['latest-linux-staging.json', 'latest-staging.json']);
});

test('#7281 review 1: a Linux pointer that names a version but fails the checks is no offer, never the Mac version', async () => {
  // setup.sh takes the family on any a.b.c version, so the Mac pointer's version would not be what it installs.
  const asked = host({ 'latest-linux.json': linuxPointer('99.0.0', { versioned: 'kosmos-99.0.0-arm64.tar.gz' }), 'latest.json': { version: '98.0.0' } });
  await update.checkNow();
  assert.deepEqual(asked, ['latest-linux.json'], 'a malformed Linux pointer sent the board to the Mac pair');
  assert.equal(update.available(), null);
  assert.equal(update.lastLook().readable, false);
  // CONTROL: one that names no version at all is "not published", and the portable board falls back.
  update.resetCache();
  const asked2 = host({ 'latest-linux.json': { error: 'not here' }, 'latest.json': { version: '98.0.0' } });
  await update.checkNow();
  assert.deepEqual(asked2, ['latest-linux.json', 'latest.json']);
});

test('#7281 TRANSITIONAL: a Linux-family install never falls back to the Mac pointer (no offer, not a downgrade)', async () => {
  update.setInstalledRoot(() => rootWithNode(false));
  const asked = host({ 'latest.json': { version: '99.0.0' } });
  await update.checkNow();
  assert.deepEqual(asked, ['latest-linux.json'], 'a Linux-family board read the Mac pointer');
  assert.equal(update.available(), null);
  assert.equal(update.lastLook().reached, true);
  assert.equal(update.lastLook().readable, false, 'an unreadable Linux pointer read as an answer');
});
