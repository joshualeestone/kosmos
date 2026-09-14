'use strict';

/**
 * win32-update-arm (updater slice S4): the Settings update card once the Windows in-app updater is
 * armed. A newer Windows build now paints the [Update] offer on a normal bundle, and the manual
 * download ONLY where the in-app path refuses up front -- a bundle under OneDrive or Program Files
 * (decision 5, the one named location rule). Never "Up to date." with something newer on the site.
 *
 * 🔑 THE CHAIN, NOT A HAND-BUILT PAYLOAD. Each case runs the REAL engine look (network stubbed,
 * platform and bundle seamed, the location rule exercised for real through win32update), builds the
 * status fields with the same expressions server.js uses (pinned against server.js's source below,
 * so the two cannot drift), and paints them through the REAL paintUpdateCard lifted from index.html.
 *
 * The offer arm and the manual arm are MUTUALLY EXCLUSIVE by construction (installOffer is null
 * exactly where manualOffer is set), so the card shows one thing: [Update] for a normal armed
 * bundle, the numbered manual steps for a refused location.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// Sandbox the data root before requiring anything that freezes it.
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-updoffer-'));

const update = require('./engine/update');
const page = require('./test-support/page');
const { version: RUNNING } = require('./package.json');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');

const ARCH = process.arch;
const NEWER = '99.0.0';
const BUNDLE = 'C:\\Users\\someone\\Kosmos';                     // a normal install: in-app update works
const ONEDRIVE = 'C:\\Users\\someone\\OneDrive';
const ONEDRIVE_BUNDLE = ONEDRIVE + '\\Kosmos';                   // decision 5: refuse + manual
const PROGFILES = 'C:\\Program Files';
const PROGFILES_BUNDLE = PROGFILES + '\\Kosmos';                 // decision 5: refuse + manual
const MANUAL_SENTENCE = 'Version ' + NEWER + ' is ready. To install it, follow these steps.';
/* Cleared each test so the real box's own OneDrive/Program Files variables never steer the rule. */
const ENV_KEYS = ['KOSMOS_UPDATE_CHANNEL', 'KOSMOS_RELEASE_BASE', 'AGENT_WORKFORCE_RELEASE_BASE',
  'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432'];
let savedEnv = {};

function winManifest(version, over) {
  return { version, sha256: 'cd'.repeat(32), artifact: `kosmos-win-${ARCH}.zip`, versioned: `kosmos-${version}-win-${ARCH}.zip`, arch: ARCH, ...(over || {}) };
}
const winFetch = (version) => (async () => ({ ok: true, json: async () => winManifest(version) }));

test.beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  update.resetCache();
  update.setBase(null);
  update.setPlatform('win32');
  /* S4: the shipped win32 bundle self-installs, so installedRoot IS the bundle root (not null as it
     was before the arm). A normal location, so the in-app path is not refused. */
  update.setWindowsBundleRoot(() => BUNDLE);
  update.setInstalledRoot(() => BUNDLE);
  update.setAutoPref(() => ({ on: false, ok: true }));
});
test.afterEach(() => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  update.resetCache();
  update.setFetcher(null);
  update.setPlatform(null);
  update.setWindowsBundleRoot(null);
  update.setInstalledRoot(null);
  update.setAutoPref(null);
});

/** Point the seams at a bundle in a refused location and set the matching Windows variable. */
function atLocation(bundle, envKey, envDir) {
  update.setWindowsBundleRoot(() => bundle);
  update.setInstalledRoot(() => bundle);
  process.env[envKey] = envDir;
}

/** One look against a stubbed site, then the status fields exactly as server.js builds them. */
async function statusAfterLook(fetcher) {
  update.setFetcher(fetcher);
  await update.refresh().catch(() => {});
  return {
    version: RUNNING,
    update: update.installOffer(),
    updateLook: update.lastLook(),
    updateManual: update.manualOffer(),
    updateChannel: update.updateChannel(),
    updatePhase: update.updatePhase(),
  };
}

/** The REAL paintUpdateCard against a stub document, fed a status payload. */
function paintStatus(st, asked, focusedId) {
  const dl = {
    hidden: true, attrs: { href: '#' }, focused: false,
    getAttribute(n) { return this.attrs[n]; },
    setAttribute(n, v) { this.attrs[n] = v; },
    focus() { this.focused = true; },
  };
  const els = {
    'upd-line': { textContent: '' },
    'upd-btn': { textContent: '', dataset: {}, hidden: true, disabled: true },
    'upd-channel': { hidden: true },
    'upd-download': dl,
    'upd-manual-steps': { hidden: true, innerHTML: '' },
    'upd-open-folder': { hidden: true },
  };
  const doc = {
    activeElement: focusedId ? els[focusedId] : null,
    getElementById: (id) => els[id] || null,
    // The page's baked version equals the served one: a page that is not stale.
    querySelector: () => ({ getAttribute: () => st.version }),
  };
  // eslint-disable-next-line no-new-func
  new Function('document', 'UPD_ASKED', 'UPD_CHECKING', 'ENGINE_STALE', 'ST',
    page.liftAll(SCRIPT, [...page.PLATFORM_COPY_FNS, 'bakedVersion', 'pageIsStale', 'paintUpdateCard'])
    + '\npaintUpdateCard(ST.version, ST.update, ST.updateLook, ST.updateManual, ST.updateChannel);')(doc, asked, false, null, st);
  return {
    line: els['upd-line'].textContent,
    btnHidden: els['upd-btn'].hidden,
    btnLabel: els['upd-btn'].textContent,
    btnAct: els['upd-btn'].dataset.act,
    downloadHidden: dl.hidden,
    href: dl.attrs.href,
    channelShown: els['upd-channel'].hidden === false,
    downloadFocused: dl.focused,
    stepsShown: els['upd-manual-steps'].hidden === false,
    steps: els['upd-manual-steps'].innerHTML,
    openFolderShown: els['upd-open-folder'].hidden === false,
  };
}

test('⭐ a normal Windows bundle with a newer build: the [Update] offer, never "Up to date." or a manual link', async () => {
  const st = await statusAfterLook(winFetch(NEWER));
  assert.deepEqual(st.update, { version: NEWER }, 'the armed win32 bundle offers the in-app update');
  assert.equal(st.updateManual, null, 'a normal bundle shows [Update], not the manual download');
  for (const asked of [false, true]) {
    const card = paintStatus(st, asked);
    assert.equal(card.line, 'Version ' + NEWER + ' is ready.', `asked=${asked}: the offer sentence`);
    assert.doesNotMatch(card.line, /Up to date/, `asked=${asked}: the false sentence`);
    assert.equal(card.btnHidden, false, 'the [Update] button is shown');
    assert.equal(card.btnLabel, 'Update');
    assert.equal(card.btnAct, 'update');
    assert.equal(card.downloadHidden, true, 'a manual download link on a normal armed bundle');
    assert.equal(card.stepsShown, false, 'the manual steps on a normal armed bundle');
    assert.equal(card.openFolderShown, false, 'the manual folder button on a normal armed bundle');
  }
});

test('decision 5: a bundle under OneDrive or Program Files gets the manual download, not [Update]', async () => {
  for (const [label, bundle, key, dir] of [
    ['OneDrive', ONEDRIVE_BUNDLE, 'OneDrive', ONEDRIVE],
    ['Program Files', PROGFILES_BUNDLE, 'ProgramFiles', PROGFILES],
  ]) {
    update.resetCache();
    atLocation(bundle, key, dir);
    const refusal = update.windowsLocationRefusal();
    assert.ok(refusal, `${label}: the one named location rule did not refuse`);
    assert.match(refusal, new RegExp(label), `${label}: the refusal does not name the location`);
    const st = await statusAfterLook(winFetch(NEWER));
    assert.equal(st.update, null, `${label}: an [Update] button that would only refuse`);
    assert.deepEqual(st.updateManual, { version: NEWER, download: `https://installkosmos.com/dist/kosmos-${NEWER}-win-${ARCH}.zip` },
      `${label}: no manual download offered`);
    const card = paintStatus(st, true);
    assert.equal(card.line, MANUAL_SENTENCE, `${label}: the card did not give the manual offer`);
    assert.doesNotMatch(card.line, /Up to date/, `${label}: the false sentence`);
    assert.equal(card.downloadHidden, false, `${label}: the Download link is not shown`);
    assert.equal(card.stepsShown, true, `${label}: the numbered steps are not shown`);
    assert.equal(card.openFolderShown, true, `${label}: the folder button is not shown`);
    assert.equal(card.btnHidden, true, `${label}: the check button stands down beside the download`);
  }
});

test('a background look that lands the manual offer while Check has focus hands focus to Download', async () => {
  atLocation(ONEDRIVE_BUNDLE, 'OneDrive', ONEDRIVE);   // the manual arm only fires for a refused location now
  const st = await statusAfterLook(winFetch(NEWER));
  const focusedOnCheck = paintStatus(st, false, 'upd-btn');
  assert.equal(focusedOnCheck.btnHidden, true, 'the premise: the manual arm hides the focused button');
  assert.equal(focusedOnCheck.downloadFocused, true, 'focus fell to <body> when the focused Check button was hidden');
  /* CONTROL: with the keyboard elsewhere, a poll paint does not steal focus. */
  const focusedElsewhere = paintStatus(st, false, 'upd-line');
  assert.equal(focusedElsewhere.downloadFocused, false, 'a background paint stole focus onto Download');
  /* And the press path: its refocus prefers the shown Download link over the hidden button. */
  const handler = page.liftAll(SCRIPT, ['updCheckNowClick']);
  assert.match(handler, /if \(shownDownload && !shownDownload\.hidden\) shownDownload\.focus\(\);/,
    'a press that lands the manual offer leaves focus nowhere');
});

test('win32-board-copy (W-25): the manual offer is numbered steps that name Windows\' own dialog, with a folder button', async () => {
  atLocation(ONEDRIVE_BUNDLE, 'OneDrive', ONEDRIVE);
  const st = await statusAfterLook(winFetch(NEWER));
  const card = paintStatus(st, false);
  const steps = [...card.steps.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(steps, [
    'Click Download.',
    'Click Open my Kosmos folder.',
    'Open the downloaded zip, select everything inside it (Ctrl+A), and drag it into your Kosmos folder.',
    'When Windows asks, choose Replace the files in the destination.',
    'Double-click Kosmos.exe. Your agents keep running.',
  ]);
  assert.doesNotMatch(card.line + card.steps, /unpack/i, 'Mac vocabulary is back in the Windows offer');
  /* The button is the same engine reveal as Settings' "Open the Kosmos folder". */
  assert.match(PAGE, /<button class="btn-quiet" type="button" id="upd-open-folder" hidden data-win-copy="updateOpenFolder">Open my Kosmos folder<\/button>/);
  const handlerAt = SCRIPT.indexOf("getElementById('upd-open-folder').addEventListener('click'");
  assert.ok(handlerAt > -1, 'the folder button has no handler');
  assert.match(SCRIPT.slice(handlerAt, handlerAt + 400), /fetch\('\/api\/reveal-app', \{ method: 'POST' \}\)/,
    'the folder button does not use the one Kosmos-folder reveal');
});

test('THE OLD BUG\'S SHAPE: a newer MAC build with the Windows build current is "Up to date." on Windows', async () => {
  /* The site as measured: latest.json newer, latest-win.json current. The Windows board must read
     its own pointer and say current -- no [Update], no Download link. */
  const st = await statusAfterLook(async (u) => ({
    ok: true, json: async () => (/\/latest\.json$/.test(u) ? { version: NEWER } : winManifest(RUNNING)),
  }));
  assert.equal(st.update, null, 'nothing newer for this platform');
  assert.equal(st.updateManual, null);
  const card = paintStatus(st, true);
  assert.equal(card.line, 'Up to date.');
  assert.equal(card.downloadHidden, true, 'a Download link with nothing newer to download');
  assert.equal(card.btnHidden, false, 'CONTROL: the check button is back when there is no offer');
});

test('a check that could not be read or could not reach says so, never "Up to date."', async () => {
  const unreadable = await statusAfterLook(async () => ({ ok: true, json: async () => winManifest(NEWER, { sha256: 'nope' }) }));
  const a = paintStatus(unreadable, true);
  assert.equal(a.line, "Could not read the update server's answer.", 'a bad Windows manifest was not named as unreadable');
  assert.equal(a.downloadHidden, true);

  const down = await statusAfterLook(async () => { throw new Error('offline'); });
  const b = paintStatus(down, true);
  assert.equal(b.line, 'Could not reach the update server.');
  assert.equal(b.downloadHidden, true);
});

test('staging: the card says "Staging channel" beside the [Update] offer on a normal bundle', async () => {
  process.env.KOSMOS_UPDATE_CHANNEL = 'staging';
  process.env.KOSMOS_RELEASE_BASE = 'http://127.0.0.1:9/dist';
  const st = await statusAfterLook(winFetch(NEWER));
  assert.equal(st.updateChannel, 'staging');
  assert.deepEqual(st.update, { version: NEWER }, 'a staging board on a normal bundle still offers the in-app update');
  const card = paintStatus(st, false);
  assert.equal(card.channelShown, true, 'a staging board was silent about its channel');
  assert.equal(card.line, 'Version ' + NEWER + ' is ready.');
  assert.match(PAGE, /<small id="upd-channel"[^>]*hidden>Staging channel<\/small>/, 'the tag\'s words moved');

  /* Staging unreachable: no offer, the channel still shown, and the failure named. */
  const down = await statusAfterLook(async () => { throw new Error('offline'); });
  const d = paintStatus(down, true);
  assert.equal(d.channelShown, true);
  assert.equal(d.line, 'Could not reach the update server.');
  assert.equal(d.downloadHidden, true, 'an unreachable staging pointer produced a (prod) download');
});

test('staging under OneDrive: the staged versioned zip is the manual link, and the channel is shown', async () => {
  process.env.KOSMOS_UPDATE_CHANNEL = 'staging';
  process.env.KOSMOS_RELEASE_BASE = 'http://127.0.0.1:9/dist';
  atLocation(ONEDRIVE_BUNDLE, 'OneDrive', ONEDRIVE);
  const st = await statusAfterLook(winFetch(NEWER));
  const card = paintStatus(st, false);
  assert.equal(card.channelShown, true);
  assert.equal(card.line, MANUAL_SENTENCE);
  assert.equal(card.href, `http://127.0.0.1:9/dist/kosmos-${NEWER}-win-${ARCH}.zip`, 'the link is not the staged versioned zip under the look\'s base');
});

test('source checkout on Windows: no in-app offer and no manual offer (this box must never self-install)', async () => {
  update.setWindowsBundleRoot(() => null);
  update.setInstalledRoot(() => null);
  const st = await statusAfterLook(winFetch(NEWER));
  assert.equal(st.update, null, 'a from-source Windows board offered an in-app update');
  assert.equal(st.updateManual, null, 'a from-source Windows board was told to unpack a zip over itself');
  const card = paintStatus(st, true);
  assert.equal(card.line, 'Up to date.', 'a dev checkout is not nagged with an update it cannot take');
  assert.equal(card.downloadHidden, true);
});

test('CONTROL: the Mac\'s install offer still wins the card, and the manual arm never shows there', async () => {
  update.setPlatform('darwin');
  update.setWindowsBundleRoot(() => null);
  update.setInstalledRoot(() => '/tmp/fake-kosmos-home');
  const st = await statusAfterLook(async () => ({ ok: true, json: async () => ({ version: NEWER }) }));
  assert.deepEqual(st.update, { version: NEWER });
  assert.equal(st.updateManual, null);
  assert.equal(st.updatePhase, null, 'the Mac has no win32 update journal phase');
  const card = paintStatus(st, true);
  assert.equal(card.line, 'Version ' + NEWER + ' is ready.');
  assert.equal(card.downloadHidden, true);
  assert.equal(card.btnHidden, false);
  assert.equal(card.stepsShown, false, 'the Windows steps showed on the Mac offer');
  assert.equal(card.openFolderShown, false, 'the Windows folder button showed on the Mac offer');
});

test('one derivation: the status route, the check route and every card caller carry the same fields', () => {
  /* The harness above rebuilds the status fields; these pins keep it the route's expressions. */
  assert.ok(SERVER.includes('update: updates.installOffer(), updateLook: updates.lastLook(),'),
    'the status route\'s install offer changed; re-point statusAfterLook');
  assert.ok(SERVER.includes('updateManual: updates.manualOffer(), updateChannel: updates.updateChannel(), updatePhase: updates.updatePhase(),'),
    '/api/status no longer carries the manual offer, the channel and the phase');
  assert.ok(SERVER.includes('offer: updates.installOffer(), source: !updates.installedRoot(), manual: updates.manualOffer(), channel: updates.updateChannel() }'),
    'the check route no longer carries them, so a press would paint "Up to date." over the poll\'s offer');
  assert.ok(/process\.stdout\.write\(`Kosmos update check: channel=\$\{updates\.updateChannel\(\)\} pointer=\$\{updates\.pointerUrl\(\)\}/.test(SERVER),
    'the boot log no longer names the channel');

  const calls = SCRIPT.match(/paintUpdateCard\([^)]*\)/g) || [];
  const callers = calls.filter((c) => !/^paintUpdateCard\(running,/.test(c));
  assert.equal(callers.length, 3, 'a caller was added or lost: ' + callers.join(' | '));
  for (const c of callers) {
    assert.ok(/, (data|st)\.updateManual, (data|st)\.updateChannel\)$|, out\.manual, out\.channel\)$/.test(c),
      'a caller does not pass the manual offer and the channel: ' + c);
  }
  assert.ok(/<a class="btn-quiet" id="upd-download" href="#" target="_blank" rel="noopener" aria-describedby="upd-line" hidden>Download<\/a>/.test(PAGE),
    'the Download link\'s markup moved, or lost the description that says WHAT it downloads');
});
