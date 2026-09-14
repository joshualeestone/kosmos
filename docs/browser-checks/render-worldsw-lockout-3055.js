// Browser-check-surface: worldsw
'use strict';

/**
 * kosmos#3055: the Kosmos switcher must NOT fail closed.
 *
 * 🛑 THE LOCKOUT. `#worldsw` is `hidden` by default and `worldsFetch` (web/index.html)
 * is the ONLY thing that reveals it, called once on load with no retry. It used to bail
 * on any non-ok `/api/worlds` (a not-signed-in board 500s after a broken switch) and on
 * a fetch throw (board unreachable), leaving the switcher hidden forever with no other
 * code path to show it again -- the user was locked out of their Kosmoses with no way
 * back (Josh, 0.6.63). The fix persists the last-known world list and renders from it on
 * a failed read, so the switcher stays reachable and the user can switch back to a
 * working Kosmos; a live read replaces the stale list and clears the note.
 *
 * ⚠️ WHY A BROWSER. Only a real DOM proves that a failed `/api/worlds` plus a cached list
 * un-hides the switcher and lists the worlds. Hermetic (file://), `/api/worlds` stubbed,
 * localStorage seeded per arm.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-worldsw-lockout-3055.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldsw-lockout-3055: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const WORLDS = { worlds: [{ id: 'default', name: 'Kosmos 1' }, { id: 'w2', name: 'Side Project' }], activeWorldId: 'default', bootedWorldId: 'default' };

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldsw-lockout-3055: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const drive = async (scenario) => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto('file://' + PAGE);
    const out = await page.evaluate(async (s) => {
      try { localStorage.removeItem('kosmos-worlds-last-known'); } catch { /* private window */ }
      if (s.cache) { try { localStorage.setItem('kosmos-worlds-last-known', JSON.stringify(s.cache)); } catch { /* */ } }
      const realFetch = window.fetch;
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/worlds') !== -1) {
          if (s.ok) return Promise.resolve({ ok: true, json: async () => s.live });
          if (s.throwIt) return Promise.reject(new Error('board unreachable'));
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
        }
        return realFetch(u, o);
      };
      if (typeof worldsFetch !== 'function') return { error: 'worldsFetch is not a function' };
      await worldsFetch();
      const sw = document.getElementById('worldsw');
      const banner = document.getElementById('worldsw-restart');
      const bmsg = document.getElementById('worldsw-restart-msg');
      if (!sw) return { error: '#worldsw is not in the page' };
      let cached = null; try { cached = localStorage.getItem('kosmos-worlds-last-known'); } catch { /* */ }
      return {
        hidden: !!sw.hidden,
        rows: Array.from(document.querySelectorAll('#worldsw-list .worldsw-rowname')).map((n) => (n.textContent || '').trim()),
        bannerHidden: !!(banner && banner.hidden),
        bannerText: bmsg ? (bmsg.textContent || '').trim() : '',
        cachedPresent: !!cached,
      };
    }, scenario);
    await page.close();
    return out;
  };

  // A -- THE FIX: /api/worlds 500s, but a cached list exists -> switcher VISIBLE + stale note.
  const failedWithCache = await drive({ cache: WORLDS, ok: false });
  // A' -- the same for an unreachable board (fetch throws), the other lockout trigger.
  const throwWithCache = await drive({ cache: WORLDS, throwIt: true });
  // B -- a live read: switcher visible, NO stale note, and the list is cached for next time.
  const live = await drive({ ok: true, live: WORLDS });
  // C -- CONTROL: failed read with NO cache stays hidden (today's clean single-world degrade).
  //     Without this the fix could just always-show; this is the arm that reds a naive fix.
  const failedNoCache = await drive({ ok: false });

  await browser.close();

  const problems = [];
  const err = failedWithCache.error || throwWithCache.error || live.error || failedNoCache.error;
  if (err) problems.push(err);
  else {
    for (const [label, r] of [['500', failedWithCache], ['unreachable', throwWithCache]]) {
      if (r.hidden) problems.push(`THE LOCKOUT: a ${label} /api/worlds with a cached list left the switcher HIDDEN -- the user is locked out with no way back. got: ` + JSON.stringify(r));
      if (!r.rows.includes('Side Project')) problems.push(`the ${label} fallback did not list the last-known Kosmoses. got rows: ` + JSON.stringify(r.rows));
      if (r.bannerHidden || !/last-known/.test(r.bannerText)) problems.push(`the ${label} fallback did not show the honest last-known note. got: ` + JSON.stringify(r));
    }
    if (live.hidden) problems.push('a LIVE /api/worlds read left the switcher hidden. got: ' + JSON.stringify(live));
    if (!live.bannerHidden) problems.push('a live read still shows the stale note (it must clear). got: ' + JSON.stringify(live));
    if (!live.cachedPresent) problems.push('a live read did not cache the world list for the next failed read. got: ' + JSON.stringify(live));
    // CONTROL: the fix must NOT just always-show; with no cache and a failed read it stays hidden.
    if (!failedNoCache.hidden) problems.push('CONTROL FAILED: a failed read with NO cache un-hid the switcher, so the fix always-shows rather than falling back to a known list. got: ' + JSON.stringify(failedNoCache));
  }

  if (problems.length) {
    console.error('FAIL  render-worldsw-lockout-3055');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('PASS  render-worldsw-lockout-3055: a failed/unreachable /api/worlds falls back to the last-known Kosmoses (switcher stays reachable, honest note); a live read shows live + caches; no cache stays hidden');
})().catch((err) => { console.error('FAIL  render-worldsw-lockout-3055: ' + ((err && err.message) || err)); process.exit(1); });
