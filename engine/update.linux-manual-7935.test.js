'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * kosmos#7935: a Linux board cannot replace itself in place (its installer is re-run over the install), so it must
 * never be offered an [Update] button that only leads to a refusal. It is told the command instead, and the refusal
 * gives the same command. Runs from either OS: the platform, the install root and the network are seams.
 *
 *   node --test engine/update.linux-manual-7935.test.js
 */
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-linuxupd-'));
const update = require('./update');

const NEWER = '99.0.0';
const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'AGENT_WORKFORCE_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'AGENT_WORKFORCE_RELEASE_BASE'];
let saved = {};

// An installed root as setup.sh lays it out, with its OWN runtime node (a regular file), so it is a Linux install.
function installedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-linuxroot-'));
  fs.mkdirSync(path.join(root, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'runtime', 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'app', 'server.js'), '');
  return root;
}
const manifest = (platform, arch) => platform === 'linux'
  ? { version: NEWER, sha256: 'ab'.repeat(32), artifact: `kosmos-linux-${arch}.tar.gz`, versioned: `kosmos-${NEWER}-linux-${arch}.tar.gz`, arch }
  : { version: NEWER, sha256: 'ab'.repeat(32), artifact: 'kosmos.tar.gz', versioned: `kosmos-${NEWER}.tar.gz` };

let ROOT = null;
async function look(platform, arch, channel) {
  update.resetCache();
  update.setPlatform(platform, arch);
  const root = installedRoot();
  ROOT = root;
  update.setInstalledRoot(() => root);
  if (channel) process.env.KOSMOS_UPDATE_CHANNEL = channel;
  update.setFetcher(async () => ({ ok: true, json: async () => manifest(platform, arch) }));
  await update.refresh();
}

test.beforeEach(() => { saved = {}; for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  update.setPlatform(null); update.setInstalledRoot(null); update.setFetcher(null); update.resetCache();
});

test('#7935: a Linux board with a newer release gets the installer command, not an [Update] button', async () => {
  await look('linux', 'x64');
  assert.equal(update.installOffer(), null, 'a Linux board was offered an in-app [Update] it cannot take');
  const manual = update.manualOffer();
  assert.ok(manual && manual.version === NEWER, 'CONTROL: the newer release was not seen at all: ' + JSON.stringify(manual));
  // This install's own verified verb, over THIS home (never curl | sh, #6468); kosmos update works out the channel.
  assert.equal(manual.command, "'" + ROOT + "/bin/kosmos' update --if-newer --install");
  assert.equal(manual.download, undefined, 'a Linux offer is a command, not a Windows download');
});

test('#7935: a staging Linux board gets the same verb (kosmos update follows the stamp; cli test pins it)', async () => {
  await look('linux', 'x64', 'staging');
  const manual = update.manualOffer();
  assert.ok(manual, 'CONTROL: no offer on staging');
  assert.equal(manual.command, "'" + ROOT + "/bin/kosmos' update --if-newer --install");
  assert.doesNotMatch(manual.command, /curl|\| sh/, 'the command pipes a download into a shell');
});

test('#7935: a home with a quote in it is still one pasteable word', async () => {
  await look('linux', 'x64');
  update.setInstalledRoot(() => "/tmp/it's here");
  assert.equal(update.manualOffer().command, "'/tmp/it'\\''s here/bin/kosmos' update --if-newer --install");
});

test('#7935: the refusal names the same command, and the Mac is untouched', async () => {
  await look('linux', 'x64');
  const said = update.selfInstallRefusal('linux');
  assert.ok(said.includes(update.manualOffer().command), 'the refusal does not give the command: ' + said);
  assert.doesNotMatch(said, /POSIX shell script/, 'the old, odd reason is back');
  // CONTROL: on the Mac the in-app offer stands and there is no manual offer and no refusal.
  await look('darwin', 'arm64');
  assert.ok(update.installOffer() && update.installOffer().version === NEWER, 'the Mac lost its [Update] offer');
  assert.equal(update.manualOffer(), null, 'the Mac was given a manual offer');
  assert.equal(update.selfInstallRefusal('darwin'), null);
});

test('#7935: a source checkout (no installed root) is offered nothing on Linux, as before', async () => {
  await look('linux', 'x64');
  update.setInstalledRoot(() => null);
  assert.equal(update.manualOffer(), null);
  assert.equal(update.installOffer(), null);
});

test('#7935: a Linux board never starts an automatic install, so no refusal is recorded on every look', async () => {
  update.setAutoPref(() => ({ on: true }));
  try {
    await look('linux', 'x64');   // refresh() ends in maybeAutoInstall()
    assert.ok(update.manualOffer(), 'CONTROL: the look saw the newer release');
    assert.equal(update.lastAttempt(), null, 'a Linux look tried to auto-install and recorded: ' + JSON.stringify(update.lastAttempt()));
  } finally { update.setAutoPref(null); }
});

test('#7935: a platform off SELF_INSTALL that is not Linux gets no command (install/kosmos waives its guards for Linux only)', async () => {
  await look('linux', 'x64');
  assert.ok(update.manualOffer(), 'CONTROL: the newer release is in the cache');
  update.setPlatform('freebsd', 'x64');
  assert.equal(update.manualOffer(), null, 'a command its CLI would refuse was offered on freebsd');
  assert.equal(update.installOffer(), null, 'freebsd cannot self-install either');
});

test('#7935: the refusal names the command on Linux only', async () => {
  await look('linux', 'x64');
  assert.match(update.selfInstallRefusal('linux'), /To update, run this in a terminal: '/, 'CONTROL: Linux gets the command');
  assert.doesNotMatch(update.selfInstallRefusal('freebsd'), /kosmos' update/, 'freebsd was given a command its CLI refuses');
  assert.match(update.selfInstallRefusal('freebsd'), /cannot update itself on this platform \(freebsd\)\.$/);
});
