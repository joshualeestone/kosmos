// Browser-check-surface: worldsw
'use strict';

/**
 * kosmos#3055: the Kosmos switcher must NOT fail closed.
 *
 * 🛑 THE LOCKOUT. `#worldsw` is `hidden` by default and `worldsFetch` (web/index.html)
 * is the ONLY thing that reveals it, called once on load with no retry. It used to bail
 * on any non-ok `/api/worlds` (a not-signed-in board 500s/403s after a broken switch) and
 * on a fetch throw (board unreachable), leaving the switcher hidden forever with no other
 * code path to show it again -- the user was locked out of their Kosmoses with no way
 * back (Josh, 0.6.63). The fix persists the last-known world list and renders from it on
 * a failed read, so the switcher stays reachable and the user can switch back to a
 * working Kosmos; a live read replaces the stale list and clears the note.
 *
 * #3055 FAST-FOLLOW: the PRIMARY list read is now the UNGATED GET /api/worlds/names, which
 * answers 200 even on the unsigned post-switch board where the token-gated /api/worlds
 * 403s -- so the switcher renders LIVE there (no stale note), the cleanest cure for the
 * lockout. The localStorage net stays for the deeper failure (board unreachable). Arm E
 * below is the control that proves the swap: an unsigned board with NO cache renders live
 * from the names route, where the OLD code (reading /api/worlds -> 403, no cache) went hidden.
 *
 * ⚠️ WHY A BROWSER. Only a real DOM proves that the names route un-hides the switcher live,
 * and that a failed read plus a cached list falls back honestly. Hermetic (file://), the two
 * world routes stubbed SEPARATELY (/api/worlds/names is the primary; /api/worlds is the old
 * token-gated route the fast-follow no longer reads), localStorage seeded per arm.
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
        const url = String(u);
        // #3055 FAST-FOLLOW: the switcher's PRIMARY read. The legacy arms drive it via
        // s.ok/s.throwIt (it is the only list read); s.namesLive + s.richStatus model the
        // unsigned board where this route is live but the token-gated /api/worlds 403s.
        if (url.indexOf('/api/worlds/names') !== -1) {
          if (s.throwIt) return Promise.reject(new Error('board unreachable'));
          if (s.namesLive) return Promise.resolve({ ok: true, json: async () => s.namesLive });
          if (s.ok) return Promise.resolve({ ok: true, json: async () => s.live });
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
        }
        // The token-gated rich route. worldsFetch NO LONGER reads it after the fast-follow;
        // it is stubbed so the unsigned-board arm can model it 403ing (which is exactly what
        // reds the OLD code that read it) and so any stray read stays honest.
        if (url.indexOf('/api/worlds') !== -1) {
          return Promise.resolve({ ok: false, status: (s.richStatus || 500), json: async () => ({}) });
        }
        return realFetch(u, o);
      };
      if (typeof worldsFetch !== 'function') return { error: 'worldsFetch is not a function' };
      await worldsFetch();
      // #3055: the stale note must SURVIVE a close/reopen while still offline (worldswClose
      // must not clear a last-known-list note). Exercise open -> close -> open.
      if (s.reopen && typeof worldswOpen === 'function' && typeof worldswClose === 'function') {
        worldswOpen(); worldswClose(); worldswOpen();
      }
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
  // D -- the stale note must SURVIVE a close/reopen while still offline (worldswClose must
  //      not clear a last-known-list note, or the reopened switcher looks live).
  const staleReopen = await drive({ cache: WORLDS, ok: false, reopen: true });
  // E -- FAST-FOLLOW CONTROL: an UNSIGNED post-switch board -- /api/worlds/names is live (200)
  //      but the token-gated /api/worlds 403s -- and NO cache. The switcher must render LIVE
  //      from the names route, with NO stale note, and cache for next time. This is the arm
  //      that REDS the pre-fast-follow page (which read /api/worlds -> 403 -> no cache -> hidden):
  //      it proves the primary-read swap, not just the localStorage net, cures the lockout.
  const unsignedLive = await drive({ namesLive: WORLDS, richStatus: 403 });

  await browser.close();

  const problems = [];
  const err = failedWithCache.error || throwWithCache.error || live.error || failedNoCache.error || staleReopen.error || unsignedLive.error;
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
    // D: the stale note survives a close/reopen while still offline (still shows the last-known rows + note).
    if (staleReopen.hidden || !staleReopen.rows.includes('Side Project')) problems.push('after a close/reopen the last-known switcher is gone. got: ' + JSON.stringify(staleReopen));
    if (staleReopen.bannerHidden || !/last-known/.test(staleReopen.bannerText)) problems.push('a close/reopen while still offline cleared the honest last-known note, so the reopened stale list looks live. got: ' + JSON.stringify(staleReopen));
    // E: FAST-FOLLOW -- the unsigned board (names live, /api/worlds 403) renders LIVE from the
    // names route with NO cache and NO stale note. This is the arm that reds the pre-fast-follow page.
    if (unsignedLive.hidden) problems.push('THE LOCKOUT (fast-follow): an unsigned board whose ungated /api/worlds/names is live left the switcher HIDDEN -- the primary-read swap did not take. got: ' + JSON.stringify(unsignedLive));
    if (!unsignedLive.rows.includes('Side Project')) problems.push('the unsigned-board live read did not list the Kosmoses from /api/worlds/names. got rows: ' + JSON.stringify(unsignedLive.rows));
    if (!unsignedLive.bannerHidden) problems.push('the unsigned-board read is LIVE (from /api/worlds/names), so it must show NO stale note. got: ' + JSON.stringify(unsignedLive));
    if (!unsignedLive.cachedPresent) problems.push('the unsigned-board live read did not cache the world list for a later failed read. got: ' + JSON.stringify(unsignedLive));
  }

  if (problems.length) {
    console.error('FAIL  render-worldsw-lockout-3055');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('PASS  render-worldsw-lockout-3055: the ungated /api/worlds/names renders the switcher LIVE even on an unsigned board (no stale note); a failed/unreachable read falls back to the last-known Kosmoses (switcher stays reachable, honest note); a live read caches; no cache stays hidden');
})().catch((err) => { console.error('FAIL  render-worldsw-lockout-3055: ' + ((err && err.message) || err)); process.exit(1); });
