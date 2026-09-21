'use strict';
// Browser-check-surface: upd-line upd-btn upd-download upd-rollback

/**
 * Settings > Updates on a Windows bundle: the in-app [Update] offer once the updater is armed
 * (win32-update-arm, slice S4), the manual download for a bundle the updater refuses up front
 * (win32-update-check, slice S1), and the "Roll back to X" button when a kept previous build is on
 * hand (win32-update-rollback, slice S5, #3017).
 *
 * The false sentence this replaces: a Windows board read the MAC pointer and, having no
 * installedRoot(), sent `update: null`, so the card said "Up to date." with a newer Windows build
 * on the site. Now a normal armed bundle sends `update` ({version}) and the card paints the
 * [Update] offer; a bundle under OneDrive or Program Files sends `updateManual` instead, and the
 * card paints the manual offer. This drives the REAL card on a REAL page and reads what renders, in
 * five states:
 *
 *   armed     prod, a normal armed bundle: the "Version X is ready." offer and an [Update] button,
 *             no Download link, no manual steps -- the in-app path is live
 *   manual    a refused location (OneDrive/Program Files): the manual-offer sentence, a visible
 *             Download link to the exact versioned zip, no check button, no channel tag
 *   staging   the same manual offer on the staging channel: "Staging channel" shows, and the link
 *             is the staged versioned zip
 *   unread    a look that reached the host but could not read it (a bad Windows manifest):
 *             the could-not-read sentence, no link, never "Up to date."; then a press whose
 *             check cannot reach the host: the could-not-reach sentence
 *   current   the CONTROL: nothing newer, the press says "Up to date." and no link shows --
 *             without it the states above could pass on a card that never says it
 *
 * The confirm dialog's body and the update overlay's Windows wording are served only to a win32
 * board, so they cannot render on the macOS CI host; web.update-settle-win32.test.js is their
 * coverage (it drives the lifted page functions with the platform forced).
 *
 * The update ANSWERS are stubbed at the network edge and nowhere else (the same posture as
 * render-updates-stale.js): /api/update/check, and in the poll's /api/status only `update`,
 * `updateLook`, `updateManual`, `updateChannel` and `engine` (the engine-stale notice, pinned
 * off). Everything else is the real server's. `served` comes from the real /api/status, so the
 * stub cannot invent the running version.
 *
 * Screenshots go to the directory you pass (argv[2]).
 *
 *   AGENT_WORKFORCE_DATA=/tmp/uw AGENT_WORKFORCE_RELEASE_BASE=http://127.0.0.1:9/dist \
 *     PORT=17374 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17374 node docs/browser-checks/render-update-win32-manual.js /tmp/uwshots
 *
 * ⚠️ HEADED by default. `HEADED=0` on a machine with no console session.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17374';
const OUT = process.argv[2] || '/tmp/uwshots';
const NEWER = '99.0.0';
const PREV = '0.6.50';   // win32-update-rollback (S5): the kept previous build the Roll back button restores
const PROD_ZIP = 'https://installkosmos.com/dist/kosmos-' + NEWER + '-win-x64.zip';
const STAGED = 'http://127.0.0.1:9/dist/kosmos-' + NEWER + '-win-x64.zip';
/* win32-board-copy (W-25): the offer is a lead sentence plus numbered steps and an "Open my
   Kosmos folder" button, because "unpack it over your Kosmos folder" is not what Extract All does. */
const MANUAL_SENTENCE = 'Version ' + NEWER + ' is ready. To install it, follow these steps.';
const MANUAL_STEP_REPLACE = 'When Windows asks, choose Replace the files in the destination.';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

/** What each state's poll and press answer, around the real served version. Each state declares its
    own `update` (the in-app offer) and `updateManual` (the manual download); the two are mutually
    exclusive, exactly as the engine makes them. */
function stateAnswers(state, served) {
  const readLook = { reached: true, readable: true, looked: true };
  if (state === 'armed') {
    return { status: { update: { version: NEWER }, updateLook: readLook, updateManual: null, updateChannel: 'prod' },
      check: { running: served, latest: NEWER, reached: true, readable: true, offer: { version: NEWER }, manual: null, channel: 'prod' } };
  }
  if (state === 'rollback') {
    /* win32-update-rollback (S5, #3017): a kept previous build is on hand. The card shows the "Roll
       back to X" button alongside whatever the offer arm paints (here up to date). */
    return { status: { update: null, updateLook: readLook, updateManual: null, updateChannel: 'prod', updateRollback: { version: PREV } },
      check: { running: served, latest: served, reached: true, readable: true, offer: null, manual: null, rollback: { version: PREV }, channel: 'prod' } };
  }
  if (state === 'manual') {
    return { status: { update: null, updateLook: readLook, updateManual: { version: NEWER, download: PROD_ZIP }, updateChannel: 'prod' },
      check: { running: served, latest: NEWER, reached: true, readable: true, offer: null, manual: { version: NEWER, download: PROD_ZIP }, channel: 'prod' } };
  }
  if (state === 'staging') {
    return { status: { update: null, updateLook: readLook, updateManual: { version: NEWER, download: STAGED }, updateChannel: 'staging' },
      check: { running: served, latest: NEWER, reached: true, readable: true, offer: null, manual: { version: NEWER, download: STAGED }, channel: 'staging' } };
  }
  if (state === 'unread') {
    return { status: { update: null, updateLook: { reached: true, readable: false, looked: true }, updateManual: null, updateChannel: 'prod' },
      check: { running: served, latest: null, reached: false, readable: false, offer: null, manual: null, channel: 'prod' } };
  }
  return { status: { update: null, updateLook: readLook, updateManual: null, updateChannel: 'prod' },
    check: { running: served, latest: served, reached: true, readable: true, offer: null, manual: null, channel: 'prod' } };
}

async function openUpdatesCard(pg) {
  await pg.goto(URL, { waitUntil: 'load' });
  if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(400); }
  await pg.evaluate(() => showTab('settings'));
  await pg.waitForSelector('#panel-settings:not([hidden])');
  await pg.click('#s-nav button[data-go="updates"]');
  await pg.waitForSelector('#s-sec-updates:not([hidden])');
}

async function readCard(pg) {
  return pg.evaluate(() => {
    const dl = document.getElementById('upd-download');
    const btn = document.getElementById('upd-btn');
    const chan = document.getElementById('upd-channel');
    const shown = (el) => !!el && !el.hidden && el.getBoundingClientRect().width > 0;
    return {
      line: document.getElementById('upd-line').textContent,
      downloadShown: shown(dl),
      downloadText: dl ? dl.textContent.trim() : null,
      href: dl ? dl.getAttribute('href') : null,
      target: dl ? dl.getAttribute('target') : null,
      describedBy: dl ? dl.getAttribute('aria-describedby') : null,
      buttonShown: shown(btn),
      buttonText: btn ? btn.textContent.trim() : null,
      channelShown: shown(chan),
      channelText: chan ? chan.textContent.trim() : null,
      /* win32-board-copy (W-25): the numbered steps and the folder button beside Download. */
      stepsShown: shown(document.getElementById('upd-manual-steps')),
      steps: [...document.querySelectorAll('#upd-manual-steps li')].map((li) => li.textContent.trim()),
      openFolderShown: shown(document.getElementById('upd-open-folder')),
      openFolderText: (document.getElementById('upd-open-folder') || {}).textContent || null,
      /* win32-update-rollback (S5, #3017): the Roll back button and the version it names. */
      rollbackShown: shown(document.getElementById('upd-rollback')),
      rollbackText: (document.getElementById('upd-rollback') || {}).textContent ? document.getElementById('upd-rollback').textContent.trim() : null,
    };
  });
}

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  const probe = await b.newPage();
  const served = (await probe.request.get(URL + '/api/status').then((r) => r.json())).version;
  await probe.close();
  chk(typeof served === 'string' && served.length > 0, 'the board reports a served version', String(served));
  if (typeof served !== 'string' || !served) {
    await b.close();
    console.log('\nFAILED: ' + fail.join(', '));
    process.exit(1);
  }

  for (const state of ['armed', 'manual', 'staging', 'unread', 'current', 'rollback']) {
    const answers = stateAnswers(state, served);
    const pg = await b.newPage({ viewport: { width: 1400, height: 800 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.route('**/api/update/check', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(answers.check),
    }));
    await pg.route('**/api/status', async (route) => {
      /* Guarded for the reason render-updates-stale.js records: a route callback that loses its
         page must not kill node after every assertion printed PASS. */
      let res, data;
      try {
        res = await route.fetch();
        data = await res.json();
      } catch {
        await route.abort().catch(() => {});
        return;
      }
      Object.assign(data, answers.status, { engine: null });
      await route.fulfill({ response: res, body: JSON.stringify(data), headers: { ...res.headers(), 'content-type': 'application/json' } });
    });
    await openUpdatesCard(pg);
    /* The card is painted by the poll; wait for a paint that reflects this state's answer. */
    await pg.waitForFunction(() => !document.getElementById('upd-btn').hidden || !document.getElementById('upd-download').hidden,
      null, { timeout: 12000 }).catch(() => {});

    if (state === 'armed') {
      const card = await readCard(pg);
      chk(card.line === 'Version ' + NEWER + ' is ready.', 'armed: the in-app offer sentence, unasked', JSON.stringify(card.line));
      chk(!/Up to date/.test(card.line), 'armed: never "Up to date."', JSON.stringify(card.line));
      chk(card.buttonShown && card.buttonText === 'Update', 'armed: the [Update] button is shown', JSON.stringify(card));
      chk(!card.downloadShown, 'armed: no manual Download link when the in-app path is live', JSON.stringify(card));
      chk(!card.stepsShown && !card.openFolderShown, 'armed: no manual steps or folder button on a normal bundle', JSON.stringify(card));
      chk(!card.channelShown, 'armed: the channel tag is hidden on prod', JSON.stringify(card));
      const box = await pg.$('#s-sec-updates');
      if (box) await box.screenshot({ path: path.join(OUT, 'update-win32-armed.png') });
    } else if (state === 'manual' || state === 'staging') {
      const card = await readCard(pg);
      chk(card.line === MANUAL_SENTENCE, state + ': the manual-offer sentence, unasked', JSON.stringify(card.line));
      chk(!/Up to date/.test(card.line), state + ': never "Up to date."', JSON.stringify(card.line));
      chk(card.downloadShown && card.downloadText === 'Download', state + ': a visible Download link', JSON.stringify(card));
      chk(card.href === (state === 'manual' ? PROD_ZIP : STAGED), state + ': the link is the exact versioned zip' + (state === 'staging' ? ' on the staged base' : ''), String(card.href));
      chk(card.describedBy === 'upd-line', state + ': the link is described by the sentence, so it is not just "Download"', String(card.describedBy));
      chk(card.target === '_blank', state + ': the link opens its own tab, so the board stays put', String(card.target));
      chk(!card.buttonShown, state + ': the check button stands down beside the link', JSON.stringify(card));
      chk(card.stepsShown && card.steps.length === 5 && card.steps.includes(MANUAL_STEP_REPLACE),
        state + ': the numbered steps show and name Windows\' Replace dialog (W-25)', JSON.stringify(card.steps));
      chk(card.openFolderShown && card.openFolderText === 'Open my Kosmos folder',
        state + ': the "Open my Kosmos folder" button shows beside Download (W-25)', JSON.stringify(card));
      chk(state === 'staging' ? (card.channelShown && card.channelText === 'Staging channel') : !card.channelShown,
        state + ': the channel tag ' + (state === 'staging' ? 'reads "Staging channel"' : 'is hidden on prod'), JSON.stringify(card));
      const box = await pg.$('#s-sec-updates');
      if (box) await box.screenshot({ path: path.join(OUT, 'update-win32-' + state + '.png') });
    } else if (state === 'unread') {
      const card = await readCard(pg);
      chk(card.line === "Could not read the update server's answer.", 'unread: a bad manifest is named as could-not-read', JSON.stringify(card.line));
      chk(!card.downloadShown, 'unread: no Download link', JSON.stringify(card));
      await pg.click('#upd-btn');
      await pg.waitForFunction(() => !/Checking\.$/.test(document.getElementById('upd-line').textContent), null, { timeout: 12000 });
      const after = await readCard(pg);
      chk(after.line === 'Could not reach the update server.', 'unread: a press that cannot reach says so', JSON.stringify(after.line));
      chk(!/Up to date/.test(after.line), 'unread: never "Up to date."', JSON.stringify(after.line));
      const box = await pg.$('#s-sec-updates');
      if (box) await box.screenshot({ path: path.join(OUT, 'update-win32-unread.png') });
    } else if (state === 'rollback') {
      /* win32-update-rollback (S5, #3017): a kept previous build is on hand, so the "Roll back to X"
         button shows -- here beside an up-to-date line, since rollback is orthogonal to the offer. */
      await pg.waitForFunction(() => { const b = document.getElementById('upd-rollback'); return b && !b.hidden; }, null, { timeout: 12000 }).catch(() => {});
      const card = await readCard(pg);
      chk(card.rollbackShown, 'rollback: the Roll back button is shown when a kept build is on hand', JSON.stringify(card));
      chk(card.rollbackText === 'Roll back to ' + PREV, 'rollback: the button names the version it restores', JSON.stringify(card.rollbackText));
      chk(!card.downloadShown, 'rollback: no manual Download link', JSON.stringify(card));
      chk(!/Up to date/.test(card.line) || card.line === 'Up to date.', 'rollback: the offer line is unaffected', JSON.stringify(card.line));
      const box = await pg.$('#s-sec-updates');
      if (box) await box.screenshot({ path: path.join(OUT, 'update-win32-rollback.png') });
    } else {
      await pg.click('#upd-btn');
      await pg.waitForFunction(() => !/Checking\.$/.test(document.getElementById('upd-line').textContent), null, { timeout: 12000 });
      const card = await readCard(pg);
      chk(card.line === 'Up to date.', 'CONTROL current: the press says "Up to date."', JSON.stringify(card.line));
      chk(!card.downloadShown && card.buttonShown, 'CONTROL current: no link, and the check button is there', JSON.stringify(card));
      chk(!card.rollbackShown, 'CONTROL current: no Roll back button with nothing kept to roll back to', JSON.stringify(card));
    }
    chk(errs.length === 0, state + ': no console errors', errs.join(' | '));
    await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
