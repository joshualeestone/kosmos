'use strict';

/**
 * kosmos#2651(a): the found/scan DISCOVERY PANELS must not auto-scan-and-show on
 * Agents-page load. Josh read that auto-appearance ("we found agents on your
 * computer", one click from a wall widened by #2414/#2410/#2452/#2243) as Kosmos
 * importing every agent file on the machine without consent. The panels are now
 * gated behind an explicit "Look for agents already on this computer" press
 * (DISCOVERY_OPENED): landing on the page shows only that trigger; pressing it opens
 * both panels on demand; a full reload starts collapsed again.
 *
 * 🛑 WHY A BROWSER CHECK. The whole bug and the whole fix are about WHAT RENDERS on
 * load. No unit test sees that: paintFoundBoard/paintScanBoard fetch and set
 * `hidden`, and the defect was that they set it false (shown) the instant a
 * candidate existed. This drives the real paint functions against stubbed
 * /api/found-agents and /api/scan-agents (no server) and reads the rendered state.
 *
 * ⚠️ BOTH ARMS ARE LOAD-BEARING. An "on load the panels are hidden" arm alone passes
 * on a page that never shows them at all, which would delete the feature rather than
 * gate it. The second arm proves the explicit press still opens them.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-discovery-gate-2651.js
 *
 * ⚠️ HEADED by default, matching the other checks here. HEADED=0 on a machine with no
 * console session; the verdicts are computed DOM (hidden flags), not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-discovery-gate-2651: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

// Two found rows (not already-added) and one scan candidate, so both panels have
// something to show once discovery is opened. If the gate were removed, these would
// render on load.
const FOUND = [{ dir: '/tmp/x/alpha', already: false }, { dir: '/tmp/x/beta', already: false }];
const SCAN = [{ dir: '/tmp/y/gamma' }];

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-discovery-gate-2651: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async ({ found, scan }) => {
    /* onAgentsTab() reads `!boardbar.hidden`; force the Agents tab so the panels are
       in scope (off-tab they hide unconditionally, which would pass this vacuously). */
    const bb = document.getElementById('boardbar');
    if (!bb) return { error: 'boardbar is gone; re-anchor onAgentsTab()' };
    bb.hidden = false;

    window.fetch = (u) => {
      const url = String(u);
      if (url.indexOf('/api/found-agents') !== -1) return Promise.resolve({ ok: true, json: async () => ({ ok: true, agents: found }) });
      if (url.indexOf('/api/scan-agents') !== -1) return Promise.resolve({ ok: true, json: async () => ({ ok: true, candidates: scan }) });
      return Promise.resolve({ ok: false, json: async () => ({}) });
    };

    if (typeof paintFoundBoard !== 'function' || typeof paintScanBoard !== 'function' || typeof paintDiscoveryTrigger !== 'function') {
      return { error: 'a discovery paint function is missing' };
    }
    if (typeof DISCOVERY_OPENED === 'undefined') return { error: 'DISCOVERY_OPENED is not defined' };

    const fw = document.getElementById('found-wrap');
    const sw = document.getElementById('scan-wrap');
    const tr = document.getElementById('found-scan-trigger');
    if (!fw || !sw || !tr) return { error: 'a wrap or the trigger element is missing' };

    /* Arm 1 - ON LOAD. The tab-gated poll paints while DISCOVERY_OPENED is still
       false. The panels must stay HIDDEN and the trigger must SHOW. */
    await paintFoundBoard();
    await paintScanBoard();
    paintDiscoveryTrigger();
    const load = { foundHidden: fw.hidden, scanHidden: sw.hidden, triggerHidden: tr.hidden };

    /* Arm 2 - EXPLICIT PRESS. Pressing the trigger opens discovery: the panels must
       SHOW and the trigger must HIDE. */
    document.getElementById('found-scan-look').click();
    await new Promise((res) => setTimeout(res, 150));
    const afterClick = { foundHidden: fw.hidden, scanHidden: sw.hidden, triggerHidden: tr.hidden, opened: DISCOVERY_OPENED };

    return { load, afterClick };
  }, { found: FOUND, scan: SCAN });

  /* Arm 3 - DISMISSED FOREVER. A person who pressed "Dismiss this forever" asked the whole
     found/scan feature to go away. After that the trigger must NOT re-offer it, and pressing
     it must NOT misreport the dismissal as an empty search ("could not find any"). Fresh page
     so DISCOVERY_OPENED / DISCOVERY_DISMISSED reset. */
  const page2 = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page2.goto('file://' + PAGE);
  const d = await page2.evaluate(async () => {
    const bb = document.getElementById('boardbar');
    if (!bb) return { error: 'boardbar is gone' };
    bb.hidden = false;
    window.fetch = (u) => {
      const url = String(u);
      if (url.indexOf('/api/found-agents') !== -1 || url.indexOf('/api/scan-agents') !== -1) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, agents: [], candidates: [], dismissed: true }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    };
    const tr = document.getElementById('found-scan-trigger');
    const look = document.getElementById('found-scan-look');
    if (!tr || !look) return { error: 'trigger or button missing' };
    paintDiscoveryTrigger();                 // the poll would offer the trigger (not dismissed yet, no panel)
    const shownBefore = !tr.hidden;
    look.click();                            // the person looks; the fetch reveals the dismissal
    await new Promise((res) => setTimeout(res, 150));
    return { shownBefore, triggerHidden: tr.hidden, dismissedFlag: (typeof DISCOVERY_DISMISSED !== 'undefined' && DISCOVERY_DISMISSED), label: look.textContent };
  });

  await browser.close();

  if (r.error) { console.error('FAIL  render-discovery-gate-2651: ' + r.error); process.exit(1); }

  const fail = [];
  if (r.load.foundHidden !== true) fail.push('found panel auto-showed on load (the gate did not hold)');
  if (r.load.scanHidden !== true) fail.push('scan panel auto-showed on load (the gate did not hold)');
  if (r.load.triggerHidden !== false) fail.push('the "Look for agents" trigger was not shown on load');
  if (r.afterClick.opened !== true) fail.push('pressing the trigger did not set DISCOVERY_OPENED');
  if (r.afterClick.foundHidden !== false) fail.push('the found panel did not open after the explicit press');
  if (r.afterClick.triggerHidden !== true) fail.push('the trigger did not hide once the panels opened');
  if (d.error) {
    fail.push('dismissed arm errored: ' + d.error);
  } else {
    if (d.shownBefore !== true) fail.push('dismissed arm: the trigger was not even offered before the press (arm is vacuous)');
    if (d.dismissedFlag !== true) fail.push('dismissed arm: DISCOVERY_DISMISSED was not set from body.dismissed');
    if (d.triggerHidden !== true) fail.push('dismissed arm: the trigger did not hide for a dismissed-forever user');
    if (/could not find/i.test(d.label || '')) fail.push('dismissed arm: the empty-look message misreported a dismissal as a search result');
  }

  if (fail.length) {
    /* One-line reason after the marker so the release runner's reason-grep can quote
       it (a multi-line "FAIL  <name>:\n  - ..." leaves the FAIL line's reason empty). */
    console.error('FAIL  render-discovery-gate-2651: ' + fail.join('; '));
    console.error('  load=' + JSON.stringify(r.load) + '  afterClick=' + JSON.stringify(r.afterClick));
    process.exit(1);
  }
  console.log('render-discovery-gate-2651: on load the found and scan panels stay hidden and only the "Look for agents" trigger shows; pressing it opens the panels and hides the trigger; and for a Dismissed-forever user the trigger is not re-offered and the empty-look message never misreports the dismissal. PASS');
})().catch((e) => { console.error('FAIL  render-discovery-gate-2651', e && e.message); process.exit(1); });
