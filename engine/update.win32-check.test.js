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
const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'AGENT_WORKFORCE_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'AGENT_WORKFORCE_RELEASE_BASE',
  /* S4: the manual offer now fires only where the in-app updater refuses the location, so the tests
     that exercise it set OneDrive; cleared here so the real box's own variable never steers it. */
  'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'];
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
/* S4: a win32 bundle the in-app updater refuses up front (OneDrive), which is where the MANUAL offer
   now lives; a normal bundle shows the in-app [Update] offer instead. */
function asOneDriveBundle() {
  update.setPlatform('win32');
  update.setWindowsBundleRoot(() => 'C:\\Users\\someone\\OneDrive\\Kosmos');
  process.env.OneDrive = 'C:\\Users\\someone\\OneDrive';
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
    const from = urls.length;
    await update.refresh();
    // The look's OWN pointer is the first read. #2969: a readable Mac staging look then also reads
    // prod, to offer a prod-only hotfix; no other combination reads a second pointer.
    const seen = urls.slice(from);
    assert.equal(seen[0], 'https://installkosmos.com/dist/' + file, `${platform}/${channel || 'prod'} fetched the wrong pointer`);
    const expected = platform === 'darwin' && channel === 'staging' ? ['https://installkosmos.com/dist/latest.json'] : [];
    assert.deepEqual(seen.slice(1), expected, `${platform}/${channel || 'prod'} read an unexpected second pointer`);
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
    /* parts() trims, so these pass the bare version rule; the versioned name is built from the
       same padded string so only the trimmed-self rule refuses them. */
    ['a leading-space version', winManifest(' ' + NEWER, { versioned: `kosmos- ${NEWER}-win-${ARCH}.zip` })],
    ['a trailing-space version', winManifest(NEWER + ' ', { versioned: `kosmos-${NEWER} -win-${ARCH}.zip` })],
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

/* #2969: the Mac falls back to the install stamp when no channel variable is set. Read through the
   REAL path (store.ROOT under this file's sandboxed AGENT_WORKFORCE_DATA), the same file setup.sh
   writes, so the wiring is tested and not just a seam. Josh's laptop, 2026-09-28: installed from
   staging, polled prod, and said "Up to date." on 0.7.03 with 0.7.05 on staging. */
test('#2969: with no channel variable the Mac follows its install stamp; an explicit variable still wins; Windows is unchanged', () => {
  const store = require('./store');
  const stamp = path.join(store.ROOT, 'source-channel');
  fs.mkdirSync(store.ROOT, { recursive: true });
  const withStamp = (content, fn) => {
    if (content === null) fs.rmSync(stamp, { force: true }); else fs.writeFileSync(stamp, content);
    try { fn(); } finally { fs.rmSync(stamp, { force: true }); }
  };
  withStamp('staging\n', () => {
    assert.equal(update.updateChannel('darwin', {}), 'staging', 'a staging install with no variable polled prod (the #2969 bug)');
    assert.equal(update.updateChannel('darwin', { AGENT_WORKFORCE_UPDATE_CHANNEL: '' }), 'staging', 'an empty variable is unset, not a choice');
    assert.equal(update.updateChannel('darwin', { KOSMOS_UPDATE_CHANNEL: 'prod' }), 'prod', 'an explicit variable wins over the stamp');
    assert.equal(update.updateChannel('darwin', { AGENT_WORKFORCE_UPDATE_CHANNEL: 'beta' }), 'prod', 'an explicit non-staging value is prod, as before');
    assert.equal(update.updateChannel('win32', {}), 'prod', 'Windows has no stamp and reads only its variable');
  });
  withStamp('  STAGING  ', () => assert.equal(update.updateChannel('darwin', {}), 'staging', 'trimmed and lowercased, as the badge reads it'));
  for (const content of [null, 'prod\n', 'stagingx', '', 'beta']) {
    withStamp(content, () => assert.equal(update.updateChannel('darwin', {}), 'prod', JSON.stringify(content) + ' moved a box onto staging'));
  }
  /* The seam, and that null restores the real read. */
  update.setRecordedChannel(() => 'staging');
  try { assert.equal(update.updateChannel('darwin', {}), 'staging'); } finally { update.setRecordedChannel(null); }
  assert.equal(update.updateChannel('darwin', {}), 'prod', 'the seam leaked past its reset');
});

test('#2969: a staging-stamped Mac with no variable FETCHES the staging pointer', async () => {
  const store = require('./store');
  const stamp = path.join(store.ROOT, 'source-channel');
  fs.mkdirSync(store.ROOT, { recursive: true });
  const saved = { a: process.env.AGENT_WORKFORCE_UPDATE_CHANNEL, k: process.env.KOSMOS_UPDATE_CHANNEL };
  delete process.env.AGENT_WORKFORCE_UPDATE_CHANNEL; delete process.env.KOSMOS_UPDATE_CHANNEL;
  update.setPlatform('darwin');
  let url = '';
  try {
    fs.writeFileSync(stamp, 'staging\n');
    update.resetCache();
    update.setFetcher(async (u) => { if (!url) url = u; return { ok: true, json: async () => ({ version: RUNNING }) }; });
    await update.refresh();
    assert.match(url, /\/latest-staging\.json$/, 'the look went to ' + url);
    url = '';
    fs.rmSync(stamp, { force: true });
    update.resetCache();
    await update.refresh();
    assert.match(url, /\/latest\.json$/, 'CONTROL: with no stamp the look is prod');
  } finally {
    fs.rmSync(stamp, { force: true });
    update.setPlatform(null); update.setFetcher(null); update.resetCache();
    if (saved.a !== undefined) process.env.AGENT_WORKFORCE_UPDATE_CHANNEL = saved.a;
    if (saved.k !== undefined) process.env.KOSMOS_UPDATE_CHANNEL = saved.k;
  }
});

/* #2969 review 1: staging is NOT always at or ahead of prod. tools/release.sh cuts straight to prod
   by default and never touches latest-staging.json, so a staging subscriber that read only its own
   pointer would sit on "Up to date" past a prod hotfix. A readable staging look is compared with
   prod; the newer one is the offer, the installer reads THAT pointer, and the stamp stays staging. */
test('#2969: a staging subscriber is offered a NEWER prod build, installs it from the prod pointer, and stays subscribed to staging', async () => {
  const bump = (v, d) => { const p = String(v).split('.').map(Number); p[2] += d; return p.join('.'); };
  const STAGING_V = bump(RUNNING, 1), PROD_V = bump(RUNNING, 2);
  const saved = { a: process.env.AGENT_WORKFORCE_UPDATE_CHANNEL, k: process.env.KOSMOS_UPDATE_CHANNEL };
  delete process.env.AGENT_WORKFORCE_UPDATE_CHANNEL; delete process.env.KOSMOS_UPDATE_CHANNEL;
  update.setPlatform('darwin');
  update.setRecordedChannel(() => 'staging');
  const urls = [];
  const serve = (staging, prod) => async (u) => {
    urls.push(u);
    if (/latest-staging\.json$/.test(u)) return staging === null ? { ok: false, json: async () => null } : { ok: true, json: async () => ({ version: staging }) };
    if (/latest\.json$/.test(u)) { if (prod === 'throw') throw new Error('offline'); return { ok: true, json: async () => ({ version: prod }) }; }
    throw new Error('unexpected ' + u);
  };
  try {
    // prod newer than staging: prod is the offer, the installer reads prod, the stamp stays staging.
    update.resetCache(); update.setFetcher(serve(STAGING_V, PROD_V)); await update.refresh();
    assert.deepEqual(update.available(), { version: PROD_V }, 'a prod hotfix newer than staging was not offered to a staging subscriber');
    assert.equal(update.installPointer(), 'prod', 'the installer would read the staging pointer and install a different version than the card offered');
    assert.equal(update.updateChannel(), 'staging', 'the subscription must stay staging');
    // staging newer (the usual case): staging is the offer and the pointer.
    update.resetCache(); update.setFetcher(serve(PROD_V, STAGING_V)); await update.refresh();
    assert.deepEqual(update.available(), { version: PROD_V });
    assert.equal(update.installPointer(), 'staging');
    // equal: staging wins (only strictly newer moves the pointer).
    update.resetCache(); update.setFetcher(serve(STAGING_V, STAGING_V)); await update.refresh();
    assert.equal(update.installPointer(), 'staging');
    // prod unreachable: the staging answer stands.
    update.resetCache(); update.setFetcher(serve(STAGING_V, 'throw')); await update.refresh();
    assert.deepEqual(update.available(), { version: STAGING_V });
    assert.equal(update.installPointer(), 'staging');
    // staging UNREADABLE: never retried against prod (unchanged rule): no offer, no prod fetch.
    urls.length = 0;
    update.resetCache(); update.setFetcher(serve(null, PROD_V)); await update.refresh();
    assert.equal(update.available(), null, 'an unreadable staging pointer fell back to prod');
    assert.deepEqual(urls.filter((u) => /latest\.json$/.test(u)), [], 'prod was fetched after an unreadable staging answer');
    // a PROD subscriber still reads exactly one URL.
    update.setRecordedChannel(() => 'prod');
    urls.length = 0;
    update.resetCache(); update.setFetcher(serve(STAGING_V, RUNNING)); await update.refresh();
    assert.equal(urls.length, 1, 'a prod subscriber fetched more than its own pointer: ' + urls.join(' '));
    assert.equal(update.installPointer(), 'prod');
  } finally {
    update.setRecordedChannel(null); update.setPlatform(null); update.setFetcher(null); update.resetCache();
    if (saved.a !== undefined) process.env.AGENT_WORKFORCE_UPDATE_CHANNEL = saved.a;
    if (saved.k !== undefined) process.env.KOSMOS_UPDATE_CHANNEL = saved.k;
  }
});

test('#2969: the spawned installer reads the offer\'s pointer and is told the subscription to stamp', () => {
  const src = fs.readFileSync(path.join(__dirname, 'update.js'), 'utf8');
  assert.ok(src.includes("KOSMOS_UPDATE_CHANNEL: installPointer(), KOSMOS_SOURCE_CHANNEL: updateChannel()"),
    'the installer env must carry the offer\'s pointer AND the subscription (setup.sh stamps KOSMOS_SOURCE_CHANNEL)');
  const setup = fs.readFileSync(path.join(__dirname, '..', 'install', 'setup.sh'), 'utf8');
  assert.ok(setup.includes('case "${KOSMOS_SOURCE_CHANNEL:-}" in staging|prod) _source_channel="$KOSMOS_SOURCE_CHANNEL" ;; esac'),
    'setup.sh must stamp the subscription it is told, or a staging box taking a prod hotfix becomes a prod box');
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

test('one derivation: selfcheck reads the same release base as the update check, at use time', async () => {
  /* selfcheck.js used to keep its own base, frozen at require and reading only the old name, so
     with KOSMOS_RELEASE_BASE set it checked a different host from the update check. */
  const selfcheck = require('./selfcheck');
  let url = null;
  const doFetch = async (u) => { url = u; return { ok: true, json: async () => ({ manifest: 'm.json', version: RUNNING }) }; };

  process.env.KOSMOS_RELEASE_BASE = 'http://127.0.0.1:9/kdist';
  assert.equal(update.releaseBase(), 'http://127.0.0.1:9/kdist');
  assert.equal(selfcheck.DEFAULT_BASE, update.releaseBase(), 'selfcheck\'s exported base disagrees with the update check');
  await selfcheck.fetchLatestJson({ doFetch });
  assert.equal(url, 'http://127.0.0.1:9/kdist/latest.json', 'selfcheck\'s default fetched a different host from the update check');

  process.env.AGENT_WORKFORCE_RELEASE_BASE = 'http://127.0.0.1:9/adist';
  await selfcheck.fetchLatestJson({ doFetch });
  assert.equal(url, 'http://127.0.0.1:9/adist/latest.json', 'the old name no longer wins in selfcheck');
  assert.equal(selfcheck.DEFAULT_BASE, update.releaseBase());
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

test('the manual offer links the exact versioned zip on both channels, under the base the look used', async () => {
  asOneDriveBundle();   // S4: the manual offer is the OneDrive/Program Files case now
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  /* Never the moving alias: the link must download exactly the build the sentence names. */
  assert.deepEqual(update.manualOffer(), { version: NEWER, download: `https://installkosmos.com/dist/kosmos-${NEWER}-win-${ARCH}.zip` });
  if (ARCH === 'x64') {
    assert.equal(update.manualOffer().download, 'https://installkosmos.com/dist/kosmos-99.0.0-win-x64.zip');
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

test('no manual offer when current, on a normal armed bundle, off a Windows bundle, or on the Mac', async () => {
  asOneDriveBundle();
  recordFetches(() => answer(winManifest(RUNNING)));
  await update.refresh();
  assert.equal(update.manualOffer(), null, 'the running version was offered');

  update.resetCache();
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.ok(update.manualOffer(), 'CONTROL: newer under OneDrive (a refused location) is a manual offer');

  /* S4: a normal armed bundle shows the in-app [Update] offer, not the manual download. */
  update.resetCache();
  delete process.env.OneDrive;
  update.setWindowsBundleRoot(() => 'C:\\Users\\someone\\Kosmos');
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.equal(update.manualOffer(), null, 'a normal armed bundle was sent to the manual download instead of [Update]');

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

test('#5032: a box installing from the staging pointer runs /setup-staging; a prod box runs /setup', async () => {
  update.setPlatform('darwin');
  process.env.AGENT_WORKFORCE_UPDATE_CHANNEL = 'staging';
  recordFetches(() => answer({ version: NEWER }));
  await update.refresh();
  assert.equal(update.setupUrl(), 'https://installkosmos.com/setup-staging?v=' + NEWER,
    'a staging box ran prod\'s installer (/setup moves only at a promote)');
  // CONTROL: the same look on the prod channel keeps /setup.
  update.resetCache();
  process.env.AGENT_WORKFORCE_UPDATE_CHANNEL = 'prod';
  recordFetches(() => answer({ version: NEWER }));
  await update.refresh();
  assert.equal(update.setupUrl(), 'https://installkosmos.com/setup?v=' + NEWER);
});

test('S4: the install is ARMED on Windows -- self-install is allowed and a normal bundle offers it in-app', async () => {
  update.setPlatform('win32');
  update.setWindowsBundleRoot(() => 'C:\\Users\\someone\\Kosmos');
  update.setInstalledRoot(() => 'C:\\Users\\someone\\Kosmos');
  recordFetches(() => answer(winManifest(NEWER)));
  await update.refresh();
  assert.equal(update.selfInstallRefusal('win32'), null, 'Windows is still refused self-install in an armed slice');
  assert.deepEqual(update.installOffer(), { version: NEWER }, 'a normal armed win32 bundle does not offer the in-app update');
  assert.equal(update.manualOffer(), null, 'a normal armed bundle offered the manual download instead of [Update]');
  assert.deepEqual(require('./platform').SELF_INSTALL, ['darwin', 'win32']);
  update.setInstalledRoot(null);
});
