'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * win32-update-check (updater slice S1): an honest update check on Windows, with no install.
 *
 * 🛑 THE BUG. A Windows board fetched the MAC pointer (`latest.json`) because the pointer was
 * chosen by channel alone. The Mac pointer names a Mac build and a Mac version (0.6.59 while
 * Windows was on 0.6.55), and the only thing hiding that was `installedRoot()` reading null on
 * the Windows layout -- which in turn left the Settings card saying "Up to date." with a newer
 * Windows build on the site.
 *
 * Every arm below runs from either OS: the platform is a seam (`setPlatform`), the Windows bundle
 * is a seam (`setWindowsBundleRoot`), and the network is a stub. Nothing here fetches the site.
 *
 *   node --test engine/update.win32-check.test.js
 */

// Sandbox the data root before requiring anything that freezes it.
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-updcheck-'));

const update = require('./update');
const { version: RUNNING } = require('../package.json');

const ARCH = process.arch;
const NEWER = '99.0.0';
const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'AGENT_WORKFORCE_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'AGENT_WORKFORCE_RELEASE_BASE'];
let savedEnv = {};

/** A Windows pointer body in the exact shape publish-kosmos-windows.sh writes. */
function winManifest(version, over) {
  return {
    version,
    sha256: 'ab'.repeat(32),
    artifact: `kosmos-win-${ARCH}.zip`,
    versioned: `kosmos-${version}-win-${ARCH}.zip`,
    arch: ARCH,
    ...(over || {}),
  };
}
const answer = (body) => ({ ok: true, json: async () => body });

test.beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  update.resetCache();
  update.setFetcher(null);
  update.setBase(null);
  update.setPlatform(null);
  update.setWindowsBundleRoot(null);
  update.setInstalledRoot(() => null);   // no install path is ever in play here
  update.setAutoPref(() => ({ on: false, ok: true }));
});
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  update.resetCache();
  update.setFetcher(null);
  update.setBase(null);
  update.setPlatform(null);
  update.setWindowsBundleRoot(null);
  update.setInstalledRoot(null);
  update.setAutoPref(null);
});

/** Stub the network, recording every URL a look asks for. */
function recordFetches(answerFor) {
  const urls = [];
  update.setFetcher(async (u) => { urls.push(u); return answerFor(u); });
  return urls;
}
function asWindowsBundle() {
  update.setPlatform('win32');
  update.setWindowsBundleRoot(() => 'C:\\Users\\someone\\Kosmos');
}

test('pointerFor: the one rule, by platform and channel', () => {
  assert.equal(update.pointerFor('win32', 'prod'), 'latest-win.json');
  assert.equal(update.pointerFor('win32', 'staging'), 'latest-win-staging.json');
  assert.equal(update.pointerFor('darwin', 'prod'), 'latest.json');
  assert.equal(update.pointerFor('darwin', 'staging'), 'latest-staging.json');
  /* Everything that is not win32 reads the Mac pair, which is what every platform read before. */
  assert.equal(update.pointerFor('linux', 'prod'), 'latest.json');
  assert.equal(update.pointerFor('darwin', 'anything-else'), 'latest.json', 'a channel that is not staging is prod');
});

test('a look fetches the pointer pointerFor names, on each platform and channel', async () => {
  const urls = recordFetches(() => answer({ version: RUNNING }));
  for (const [platform, channel, file] of [
    ['win32', null, 'latest-win.json'],
    ['win32', 'staging', 'latest-win-staging.json'],
    ['darwin', null, 'latest.json'],
    ['darwin', 'staging', 'latest-staging.json'],
  ]) {
    update.resetCache();
    update.setPlatform(platform);
    if (channel) process.env.KOSMOS_UPDATE_CHANNEL = channel; else delete process.env.KOSMOS_UPDATE_CHANNEL;
    await update.refresh();
    assert.equal(urls[urls.length - 1], 'https://installkosmos.com/dist/' + file, `${platform}/${channel || 'prod'} fetched the wrong pointer`);
  }
});

test('THE BUG: a Windows board never reads the Mac pointer\'s newer version', async () => {
  /* The shape measured on the site: the Mac pointer names a newer version than the Windows one. */
  const byUrl = (u) => answer(/\/latest\.json$/.test(u) ? { version: NEWER } : winManifest(RUNNING));
  recordFetches(byUrl);
  asWindowsBundle();
  await update.refresh();
  assert.equal(update.available(), null, 'the Windows board offered the MAC build\'s version');
  assert.equal(update.manualOffer(), null, 'and made a manual offer out of it');
  assert.equal(update.lastLook().readable, true, 'the Windows pointer was read, and it says current');

  /* CONTROL: the same stubbed site, read as a Mac, does offer -- so the arm above is about the
     pointer choice, not a fixture that never offers. */
  update.resetCache();
  update.setPlatform('darwin');
  await update.refresh();
  assert.deepEqual(update.available(), { version: NEWER });
});

test('a valid Windows manifest is cached as {version, sha256, versioned}, never the alias', async () => {
  recordFetches(() => answer(winManifest(NEWER)));
  asWindowsBundle();
  await update.refresh();
  const out = await update.checkNow();
  assert.equal(out.latest, NEWER, 'the check route\'s `latest` stays a version string');
  assert.deepEqual(update.readManifest('win32', winManifest(NEWER)),
    { version: NEWER, sha256: 'ab'.repeat(32), versioned: `kosmos-${NEWER}-win-${ARCH}.zip` });
});

test('a bad Windows manifest is no offer and never "Up to date" material (readable false)', async () => {
  const bad = [
    ['a malformed version', winManifest('0.6', { versioned: `kosmos-0.6-win-${ARCH}.zip` })],
    ['a non-string version', { ...winManifest(NEWER), version: 99 }],
    ['a short sha256', winManifest(NEWER, { sha256: 'ab'.repeat(31) })],
    ['a non-hex sha256', winManifest(NEWER, { sha256: 'zz'.repeat(32) })],
    ['no sha256', winManifest(NEWER, { sha256: undefined })],
    ['a versioned name for another version', winManifest(NEWER, { versioned: `kosmos-0.0.1-win-${ARCH}.zip` })],
    ['a versioned name for another arch', winManifest(NEWER, { versioned: `kosmos-${NEWER}-win-not-${ARCH}.zip` })],
    ['only the moving alias (no versioned)', winManifest(NEWER, { versioned: undefined })],
    ['the Mac pointer\'s shape', { version: NEWER }],
  ];
  asWindowsBundle();
  for (const [label, body] of bad) {
    update.resetCache();
    recordFetches(() => answer(body));
    await update.refresh();
    assert.equal(update.readManifest('win32', body), null, `${label} was trusted`);
    assert.equal(update.available(), null, `${label} produced an offer`);
    assert.equal(update.manualOffer(), null, `${label} produced a manual offer`);
    const look = update.lastLook();
    assert.equal(look.reached, true, `${label}: the host answered`);
    assert.equal(look.readable, false, `${label} read as a usable answer (the card would say "Up to date.")`);
  }
  /* CONTROL: the untouched fixture IS trusted and offered, so each arm above fails on its defect. */
  update.resetCache();
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.deepEqual(update.available(), { version: NEWER });
  assert.equal(update.lastLook().readable, true);
});

test('the Mac manifest rule is unchanged: a string x.y.z version, nothing else required', () => {
  assert.deepEqual(update.readManifest('darwin', { version: '0.6.59' }), { version: '0.6.59' });
  assert.deepEqual(update.readManifest('darwin', { version: '0.6.59', sha256: 'x', artifact: 'y' }), { version: '0.6.59' },
    'the Mac arm grew a field it never had');
  for (const body of [null, 'x', { version: 42 }, { version: 'latest' }, { version: '0.1.1-rc1' }]) {
    assert.equal(update.readManifest('darwin', body), null, JSON.stringify(body) + ' was trusted on the Mac');
  }
});

test('the channel: Windows reads only KOSMOS_UPDATE_CHANNEL; the Mac keeps both names', () => {
  assert.equal(update.updateChannel('win32', {}), 'prod', 'prod is the default');
  assert.equal(update.updateChannel('win32', { KOSMOS_UPDATE_CHANNEL: 'staging' }), 'staging');
  /* 🛑 On Windows every AGENT_WORKFORCE_* variable is a launch override, so it must not be the
     updater's opt-in. */
  assert.equal(update.updateChannel('win32', { AGENT_WORKFORCE_UPDATE_CHANNEL: 'staging' }), 'prod',
    'an AGENT_WORKFORCE_* variable opted a Windows board into staging');
  assert.equal(update.updateChannel('win32', { KOSMOS_UPDATE_CHANNEL: 'beta' }), 'prod', 'anything but staging is prod');

  assert.equal(update.updateChannel('darwin', {}), 'prod');
  assert.equal(update.updateChannel('darwin', { AGENT_WORKFORCE_UPDATE_CHANNEL: 'staging' }), 'staging');
  assert.equal(update.updateChannel('darwin', { KOSMOS_UPDATE_CHANNEL: 'staging' }), 'staging');
  assert.equal(update.updateChannel('darwin', { AGENT_WORKFORCE_UPDATE_CHANNEL: 'prod', KOSMOS_UPDATE_CHANNEL: 'staging' }), 'prod',
    'the Mac\'s AGENT_WORKFORCE_ name no longer wins');
});

test('the base: KOSMOS_RELEASE_BASE is honoured, and the old name still works and wins', async () => {
  const urls = recordFetches(() => answer({ version: RUNNING }));
  update.setPlatform('darwin');
  process.env.KOSMOS_RELEASE_BASE = 'http://127.0.0.1:9/kdist';
  await update.refresh();
  assert.equal(urls.pop(), 'http://127.0.0.1:9/kdist/latest.json', 'KOSMOS_RELEASE_BASE was ignored');
  assert.equal(update.pointerUrl(), 'http://127.0.0.1:9/kdist/latest.json', 'the boot log would name a different URL');

  process.env.AGENT_WORKFORCE_RELEASE_BASE = 'http://127.0.0.1:9/adist';
  update.resetCache();
  await update.refresh();
  assert.equal(urls.pop(), 'http://127.0.0.1:9/adist/latest.json',
    'the old name stopped working (test sandboxes and browser checks aim a board at a dead host through it)');

  delete process.env.AGENT_WORKFORCE_RELEASE_BASE; delete process.env.KOSMOS_RELEASE_BASE;
  update.resetCache();
  await update.refresh();
  assert.equal(urls.pop(), 'https://installkosmos.com/dist/latest.json', 'CONTROL: unset is the real host');
});

test('staging that cannot be reached is no offer, and is never retried against prod', async () => {
  asWindowsBundle();
  process.env.KOSMOS_UPDATE_CHANNEL = 'staging';
  for (const [label, staging] of [
    ['a thrown fetch', () => { throw new Error('offline'); }],
    ['a 404 (latest-win-staging.json does not exist yet)', () => ({ ok: false, json: async () => ({}) })],
  ]) {
    update.resetCache();
    const urls = recordFetches((u) => (/staging/.test(u) ? staging() : answer(winManifest(NEWER))));
    await update.refresh().catch(() => {});
    await update.checkNow();
    assert.ok(urls.length > 0, 'the premise: a look was made');
    assert.ok(urls.every((u) => /\/latest-win-staging\.json$/.test(u)),
      `${label}: a staging look fell back to another pointer: ${urls.join(', ')}`);
    assert.equal(update.available(), null, `${label} produced an offer`);
    assert.equal(update.manualOffer(), null, `${label} produced a manual offer`);
    assert.equal(update.lastLook().readable, false, `${label} read as a usable answer`);
  }
  /* CONTROL: a reachable staging pointer with a newer build does offer, from staging. */
  update.resetCache();
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.deepEqual(update.available(), { version: NEWER });
});

test('the manual offer: prod points at the site\'s alias, staging at the staged versioned zip', async () => {
  asWindowsBundle();
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.deepEqual(update.manualOffer(), { version: NEWER, download: `https://installkosmos.com/dist/kosmos-win-${ARCH}.zip` });
  if (ARCH === 'x64') {
    assert.equal(update.manualOffer().download, 'https://installkosmos.com/dist/kosmos-win-x64.zip');
  }

  process.env.KOSMOS_UPDATE_CHANNEL = 'staging';
  process.env.KOSMOS_RELEASE_BASE = 'http://127.0.0.1:9/dist';
  update.resetCache();
  const urls = recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.equal(urls[0], 'http://127.0.0.1:9/dist/latest-win-staging.json');
  assert.deepEqual(update.manualOffer(), { version: NEWER, download: `http://127.0.0.1:9/dist/kosmos-${NEWER}-win-${ARCH}.zip` },
    'the staged build\'s link does not come from the base and pointer the look used');
});

test('no manual offer when current, off a Windows bundle, or on the Mac', async () => {
  asWindowsBundle();
  recordFetches(() => answer(winManifest(RUNNING)));
  await update.refresh();
  assert.equal(update.manualOffer(), null, 'the running version was offered');

  update.resetCache();
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.ok(update.manualOffer(), 'CONTROL: newer on a Windows bundle is offered');
  update.setWindowsBundleRoot(() => null);
  assert.equal(update.manualOffer(), null, 'a Windows source checkout was told to unpack a zip over itself');

  update.resetCache();
  update.setPlatform('darwin');
  update.setWindowsBundleRoot(() => 'C:\\Users\\someone\\Kosmos');
  recordFetches(() => answer({ version: NEWER }));
  await update.refresh();
  assert.deepEqual(update.available(), { version: NEWER });
  assert.equal(update.manualOffer(), null, 'the Mac, which installs in-app, got the manual offer');
});

test('design finding 8: setupUrl carries the ?v= cache-buster for the version the update is for', async () => {
  update.setPlatform('darwin');
  assert.equal(update.setupUrl(), 'https://installkosmos.com/setup', 'CONTROL: before any look there is no version to carry');
  recordFetches(() => answer({ version: NEWER }));
  await update.refresh();
  assert.equal(update.setupUrl(), 'https://installkosmos.com/setup?v=' + NEWER,
    'the cache-buster never applies (it read .version off a bare string)');
});

test('the install still refuses on Windows, whatever the check found', async () => {
  asWindowsBundle();
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.ok(update.manualOffer(), 'the premise: a newer Windows build is on offer');
  assert.ok(update.selfInstallRefusal('win32'), 'Windows became able to self-install in a no-install slice');
  assert.equal(update.installedRoot(), null, 'the install offer (`update` on the status payload) stays null here');
  assert.deepEqual(require('./platform').SELF_INSTALL, ['darwin']);
});
