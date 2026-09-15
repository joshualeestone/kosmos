'use strict';

/**
 * kosmos#3048 (Josh 6.63): the permanent home "Look for agents already on this
 * computer" trigger and its two on-demand panels (found #2651, scan #1938) were
 * REMOVED from the Agents board. Adding agents still works from the New Agents tab
 * (paste import #1652/#2563); what went is the auto-scan entry Josh did not want
 * living on the home screen forever.
 *
 * 🛑 WHY A BROWSER CHECK. A removal has no positive artifact to test, so it rots
 * silently: a future edit that re-adds the markup, or a stray poll call that paints
 * a panel, would pass every source read. This check pins the ABSENCE against the
 * real page and, critically, against the real poll paint sequence, so the removal
 * cannot regress unseen. It replaces render-found-board.js, render-scan-board.js and
 * render-discovery-gate-2651.js, which tested the feature that no longer exists.
 *
 * 🔑 THE THREE PAINTERS ARE DELIBERATELY KEPT. paintFoundBoard/paintScanBoard/
 * paintDiscoveryTrigger and the foundRowsHtml/adoptRowsHtml/scanRowsHtml builders
 * stay, because firstrun's shared `.fr-adopt*` handlers call the painters
 * (typeof-guarded) to refresh their own S9 rows. With the home markup gone the
 * painters null-guard to a no-op. Arm 3 asserts they still EXIST, so a future
 * "clean up the dead painters" edit that also breaks the firstrun call is caught
 * here rather than silently in onboarding.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 \
 *     node docs/browser-checks/render-home-discovery-removed-3048.js
 *
 * Hermetic (file://), boots no server; the paints' fetches are stubbed in-page.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-home-discovery-removed-3048: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

// The ids that MUST be gone: the trigger button, its two panels, the two list
// containers, and the trigger's press target. If any survives, the removal leaked.
const GONE_IDS = ['found-scan-trigger', 'found-wrap', 'scan-wrap', 'found-list', 'scan-list', 'found-scan-look'];

const results = [];
function check(name, pass, detail) { results.push({ name, pass: Boolean(pass), detail }); }

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-home-discovery-removed-3048: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async ({ goneIds }) => {
    const out = {};

    // Arm 1 - ON LOAD. None of the removed markup exists.
    out.onLoadPresent = goneIds.filter((id) => document.getElementById(id) !== null);

    // Arm 2 - AFTER THE POLL PAINTS. Force the Agents tab (onAgentsTab reads
    // `!boardbar.hidden`) and stub the discovery APIs WITH candidates, so if any
    // painter still rendered a panel it would have data to render. Then run the
    // exact sequence the board poll runs. Nothing must throw and nothing must appear.
    const bb = document.getElementById('boardbar');
    if (!bb) { out.error = 'boardbar is gone; re-anchor onAgentsTab()'; return out; }
    bb.hidden = false;

    window.fetch = (u) => {
      const url = String(u);
      if (url.indexOf('/api/found-agents') !== -1) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, agents: [{ dir: '/tmp/x/alpha', already: false }] }) });
      }
      if (url.indexOf('/api/scan-agents') !== -1) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, candidates: [{ dir: '/tmp/y/gamma' }] }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    };

    out.paintsExist = (typeof paintFoundBoard === 'function')
      && (typeof paintScanBoard === 'function')
      && (typeof paintDiscoveryTrigger === 'function');

    out.threw = false;
    try {
      if (typeof paintFoundBoard === 'function') await paintFoundBoard();
      if (typeof paintScanBoard === 'function') await paintScanBoard();
      if (typeof paintDiscoveryTrigger === 'function') paintDiscoveryTrigger();
    } catch (e) { out.threw = true; out.threwMsg = e && e.message ? e.message : String(e); }

    // Still absent after the paints, and no discovery element materialised by any
    // other name (the panel wrappers carried .found-head; the trigger the linkish label).
    out.afterPaintPresent = goneIds.filter((id) => document.getElementById(id) !== null);
    out.strayHead = document.querySelector('.found-head') !== null;
    out.strayLook = (() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => /look for agents already on this computer/i.test(b.textContent || ''));
    })();

    // Arm 3 - the gating var the kept painters read still exists (a bare reference
    // would ReferenceError if it had been deleted, so probe it inside try).
    out.gateDefined = (() => { try { return typeof DISCOVERY_OPENED !== 'undefined'; } catch { return false; } })();

    return out;
  }, { goneIds: GONE_IDS });

  if (r.error) {
    check(r.error, false, 'harness anchor missing');
  } else {
    check('the removed home discovery ids are absent on load', r.onLoadPresent.length === 0,
      r.onLoadPresent.length ? 'still present: ' + r.onLoadPresent.join(', ') : 'all six gone');
    check('the poll paint sequence does not throw with the markup gone', r.threw === false,
      r.threw ? r.threwMsg : 'no throw');
    check('no discovery panel or trigger appears after the paints', r.afterPaintPresent.length === 0 && !r.strayHead && !r.strayLook,
      `ids=${r.afterPaintPresent.join(',') || 'none'} head=${r.strayHead} lookBtn=${r.strayLook}`);
    check('the kept painters still exist for firstrun (paintFoundBoard/paintScanBoard/paintDiscoveryTrigger)', r.paintsExist === true,
      r.paintsExist ? 'all three defined' : 'a painter is missing - firstrun S9 refresh would break');
    check('DISCOVERY_OPENED still defined (the painters read it)', r.gateDefined === true,
      r.gateDefined ? 'defined' : 'undefined');
  }

  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter((x) => !x.pass);
  for (const x of results) {
    if (x.pass) console.log('ok    ' + x.name + (x.detail ? '  (' + x.detail + ')' : ''));
    // SHAPE 1 concat emit so browser-checks-reason-grep can statically confirm the
    // failure line is quotable by run_one's reason grep (^\s*FAIL).
    else console.log('FAIL  ' + x.name + (x.detail ? '  (' + x.detail + ')' : ''));
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-home-discovery-removed-3048 threw: ' + (e && e.message ? e.message : e)); process.exit(1); });
