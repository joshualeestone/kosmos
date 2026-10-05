'use strict';

/**
 * kosmos#4976: a REFUSED Restore says why. The engine refuses some restores for a reason a retry cannot clear
 * (another agent now holds the folder, #4896; the account folder is gone, #2615), and the page used to drop that
 * reason and say "Restore failed. Try again." for every one of them.
 *
 * Drives the real `paintRemoved()` and the real Restore click against a stubbed /api/removed and a stubbed
 * /api/agent/<name>/restore (no board), and reads the rendered row and #removed-msg.
 *
 * One press sequence on one page, never clearing #removed-msg between presses (review 1: a check that clears the
 * region itself cannot see a page that leaves a stale sentence up or wipes a true one):
 *   1 refused   : 400 { outcome: 'refused', because } -> the row reads "Not restored", its accessible name says what
 *                 pressing it does, and #removed-msg reads "Not restored: <because>" (the engine's own words).
 *   2 CONTROL   : a failure with NO reason (a 500, no body) -> "Restore failed. Try again." on ITS row, and the
 *                 region still carries row 1's refusal (still true: that row is still not restored).
 *   3 blocked   : pressing an unavailable Restore leads with its explanation and KEEPS row 1's refusal.
 *   4 working   : a Restore that works says "Starting <name> again" and keeps BOTH held sentences (both rows are
 *                 still listed and both are still true). Nothing reappears that was not on screen just before.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-restore-refused-4976.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-restore-refused-4976: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
/* A real engine sentence (engine/remove.js restoreInner, #2609), not invented text (review 1). */
const WHY = 'Carl ran on an account whose folder is gone (/Users/x/.kosmos-accounts/c), so restoring it now would start it pointing at a directory that no longer exists. Add that account back under the same name first, then restore.';
const AGENTS = [
  { name: 'carl9', shownAs: 'Carl', removedAt: '2026-10-01T00:00:00Z', stopped: true, accountFolderGone: false },
  { name: 'mia9', shownAs: 'Mia', removedAt: '2026-10-01T00:00:00Z', stopped: true, accountFolderGone: false },
  { name: 'gone9', shownAs: 'Gone', removedAt: '2026-10-01T00:00:00Z', stopped: true, accountFolderGone: true },
  { name: 'fay9', shownAs: 'Fay', removedAt: '2026-10-01T00:00:00Z', stopped: true, accountFolderGone: false },
  { name: 'ned9', shownAs: 'Ned', removedAt: '2026-10-01T00:00:00Z', stopped: true, accountFolderGone: false },
  { name: 'oz9', shownAs: 'Oz', removedAt: '2026-10-01T00:00:00Z', stopped: true, accountFolderGone: false },
  { name: 'kim9', shownAs: 'Kim', removedAt: '2026-10-01T00:00:00Z', stopped: true, accountFolderGone: false },
];
const WHY3 = 'Oz ran on an account whose folder is gone (/Users/x/.kosmos-accounts/o), so restoring it now would start it pointing at a directory that no longer exists. Add that account back under the same name first, then restore.';
const WHY2 = 'we could not check which agents use Ned\'s folder, so we did not restore it. Try again in a moment.';

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-restore-refused-4976: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async ({ agents, why, why2, why3 }) => {
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const url = String(u);
      if (url.indexOf('/api/removed') !== -1) return Promise.resolve({ ok: true, json: async () => ({ agents }) });
      if (url.indexOf('/api/agent/carl9/restore') !== -1) {
        if (window.__carlNoReason) return Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('no body'); } });
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ outcome: 'refused', because: why }) });
      }
      if (url.indexOf('/api/agent/oz9/restore') !== -1) {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ outcome: 'refused', because: why3 }) });
      }
      if (url.indexOf('/api/agent/ned9/restore') !== -1) {
        return Promise.resolve({ ok: false, status: 400, json: async () => ({ outcome: 'refused', because: why2 }) });
      }
      if (url.indexOf('/api/agent/mia9/restore') !== -1) {
        return Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('no body'); } });
      }
      if (url.indexOf('/api/agent/fay9/restore') !== -1) return Promise.resolve({ ok: true, json: async () => ({ outcome: 'restored' }) });
      if (url.indexOf('/api/agent/kim9/restore') !== -1) return Promise.resolve({ ok: true, json: async () => ({ outcome: 'restored' }) });
      return realFetch(u, opts);
    };
    if (typeof paintRemoved !== 'function') return { error: 'paintRemoved is not a function' };
    await paintRemoved();
    const toggle = document.getElementById('removed-toggle');
    if (toggle) toggle.click();
    await new Promise((res) => setTimeout(res, 30));
    if (document.getElementById('removed-list').hidden) return { error: 'the removed list is still hidden after the toggle' };
    const btnOf = (shown) => [...document.querySelectorAll('#removed-list [data-restore]')]
      .find((x) => (x.dataset.shownAs || '') === shown);
    const msg = document.getElementById('removed-msg');
    if (!msg) return { error: 'there is no #removed-msg' };
    const carl = btnOf('Carl');
    const mia = btnOf('Mia');
    const fay = btnOf('Fay');
    const gone = [...document.querySelectorAll('#removed-list [data-restore-blocked]')].find((x) => (x.dataset.shownAs || '') === 'Gone');
    if (!carl || !mia || !fay || !gone) return { error: 'a Restore control is missing: ' + JSON.stringify({ carl: !!carl, mia: !!mia, fay: !!fay, gone: !!gone }) };
    const now = () => (msg.textContent || '').trim();
    const wait = () => new Promise((res) => setTimeout(res, 120));
    carl.click(); await wait();
    const s1 = { button: (carl.textContent || '').trim(), label: carl.getAttribute('aria-label') || '', title: carl.getAttribute('title') || '', msg: now(), disabled: carl.disabled };
    mia.click(); await wait();
    const s2 = { button: (mia.textContent || '').trim(), msg: now(), carlTitle: carl.getAttribute('title') || '', miaTitle: mia.getAttribute('title') || '', miaLabel: mia.getAttribute('aria-label') || '' };
    gone.click(); await wait();
    const s3 = { msg: now() };
    fay.click(); await wait();
    const s4 = { msg: now() };
    // 5 (review 3: BEFORE any other refusal, so Carl's is the one held): a retry of Carl that fails with NO
    //   reason. Its row now says "Try again" with no refusal name or title, and the region must drop Carl's refusal.
    window.__carlNoReason = true;
    carl.click(); await wait();
    const s5 = { button: (carl.textContent || '').trim(), label: carl.getAttribute('aria-label'), title: carl.getAttribute('title'), msg: now() };
    // 6: a second refusal: it leads the region and its row carries its own reason.
    const ned = btnOf('Ned');
    if (!ned) return { error: 'the Ned row is missing', s1, s2, s3, s4, s5 };
    ned.click(); await wait();
    const s6 = { msg: now(), nedTitle: ned.getAttribute('title') || '' };
    // 7 (review 3): a refusal that lands AFTER the person left the tab, then a Settings round-trip and a working
    //   restore. Nothing held from before the trip, and nothing that landed off-tab, may appear.
    if (typeof showTab !== 'function') return { error: 'showTab is not a function', s1, s2, s3, s4, s5, s6 };
    const oz = btnOf('Oz');
    if (!oz) return { error: 'the Oz row is missing', s1, s2, s3, s4, s5, s6 };
    oz.click();
    showTab('settings');   // synchronously, before the click handler's awaited answer lands
    await wait();
    const leftMsg = now();
    showTab('agents'); await wait();
    /* A FRESH working row (first run, 00:38): Fay restored in arm 4 keeps a disabled "Restoring…" button here,
       because the stubbed list never changes so the row is never repainted away; a click on it does nothing. */
    const fay2 = btnOf('Kim');
    if (fay2) { fay2.click(); await wait(); }
    const wrap = document.getElementById('removed-wrap');
    const s7 = { leftMsg, msg: now(), pressed: !!fay2, ozTitle: oz.getAttribute('title') || '', wrapShown: !!wrap && !wrap.hidden && !document.getElementById('removed-list').hidden };
    return { s1, s2, s3, s4, s5, s6, s7 };
  }, { agents: AGENTS, why: WHY, why2: WHY2, why3: WHY3 });

  await browser.close();
  const problems = [];
  if (r.error) problems.push(r.error);
  else {
    const refusal = 'Not restored: ' + WHY;
    if (r.s1.button !== 'Not restored') problems.push('1: a refused Restore reads ' + JSON.stringify(r.s1.button) + ', not "Not restored"');
    if (!/Restore Carl again/.test(r.s1.label)) problems.push('1: the refused control\'s name does not say what pressing it does: ' + JSON.stringify(r.s1.label));
    if (r.s1.msg !== refusal) problems.push('1: #removed-msg is not the engine\'s reason, prefixed: ' + JSON.stringify(r.s1.msg));
    if (/try again/i.test(r.s1.button)) problems.push('1: a refusal a retry cannot clear still says "Try again" on its row');
    if (r.s1.disabled) problems.push('1: the refused row\'s Restore was left disabled');
    // Review 2: the region holds one refusal, so each refused row carries its own reason too.
    if (r.s1.title !== refusal) problems.push('1: the refused row does not carry its own reason (title): ' + JSON.stringify(r.s1.title));
    if (r.s2.carlTitle !== refusal) problems.push('2: row 1 lost its own reason after another row was pressed: ' + JSON.stringify(r.s2.carlTitle));
    if (r.s2.miaTitle || r.s2.miaLabel) problems.push('2 CONTROL: a reason-less failure gave its row a refusal name or tooltip: ' + JSON.stringify([r.s2.miaLabel, r.s2.miaTitle]));
    if (r.s2.button !== 'Restore failed. Try again.') problems.push('2 CONTROL: a reason-less failure reads ' + JSON.stringify(r.s2.button));
    if (r.s2.msg !== refusal) problems.push('2 CONTROL: a reason-less failure changed the region (it must neither invent a reason nor wipe row 1\'s true one): ' + JSON.stringify(r.s2.msg));
    if (!/^Gone cannot be restored yet/.test(r.s3.msg)) problems.push('3: an unavailable press does not lead with its explanation: ' + JSON.stringify(r.s3.msg));
    if (r.s3.msg.indexOf(refusal) === -1) problems.push('3: an unavailable press wiped row 1\'s refusal, which is still true: ' + JSON.stringify(r.s3.msg));
    if (!/^Starting Fay again/.test(r.s4.msg)) problems.push('4: a working restore does not lead with "Starting Fay again": ' + JSON.stringify(r.s4.msg));
    if (r.s4.msg.indexOf(refusal) === -1) problems.push('4: a working restore wiped row 1\'s refusal, which is still true: ' + JSON.stringify(r.s4.msg));
    if (!/Gone cannot be restored yet/.test(r.s4.msg)) problems.push('4: a working restore dropped the blocked explanation while Gone is still blocked: ' + JSON.stringify(r.s4.msg));
    if (r.s5.button !== 'Restore failed. Try again.') problems.push('5: a reason-less retry reads ' + JSON.stringify(r.s5.button));
    if (r.s5.label !== null || r.s5.title !== null) problems.push('5: the earlier refusal\'s name or tooltip outlived the retry: ' + JSON.stringify([r.s5.label, r.s5.title]));
    if (r.s5.msg.indexOf(refusal) !== -1) problems.push('5: the region still gives Carl\'s old refusal while his row says "Try again": ' + JSON.stringify(r.s5.msg));
    const refusal2 = 'Not restored: ' + WHY2;
    if (!r.s6.msg.startsWith(refusal2)) problems.push('6: a second refusal does not lead the region: ' + JSON.stringify(r.s6.msg));
    if (r.s6.nedTitle !== refusal2) problems.push('6: the second refused row does not carry its own reason: ' + JSON.stringify(r.s6.nedTitle));
    if (r.s7.leftMsg !== '') problems.push('7: the removed-list message stood under Settings: ' + JSON.stringify(r.s7.leftMsg));
    if (!r.s7.pressed) problems.push('7: the Kim row was not found after the tab round-trip');
    // Review 3: click() works on hidden rows, so the arm must prove the list is actually on screen again.
    if (!r.s7.wrapShown) problems.push('7: the removed list is not on screen after the round-trip, so the press measured a hidden page');
    if (!/^Starting Kim again/.test(r.s7.msg)) problems.push('7: the working restore after the round-trip does not lead: ' + JSON.stringify(r.s7.msg));
    if (/Not restored:/.test(r.s7.msg)) problems.push('7: a refusal held from before the trip, or one that landed off-tab, reappeared: ' + JSON.stringify(r.s7.msg));
    if (/cannot be restored yet/.test(r.s7.msg)) problems.push('7: the blocked explanation cleared by the tab leave reappeared: ' + JSON.stringify(r.s7.msg));
    if (r.s7.ozTitle !== 'Not restored: ' + WHY3) problems.push('7: the off-tab refusal is not on its row either: ' + JSON.stringify(r.s7.ozTitle));
  }
  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error(`render-restore-refused-4976: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-restore-refused-4976: a refused Restore says "Not restored" and shows the engine\'s reason, which stays up while true through a reason-less failure, an unavailable press and a working restore.');
})().catch((err) => {
  console.error('FAIL  render-restore-refused-4976: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
