'use strict';
// Browser-check-scope: page  (#6192: it watches every read the page makes at load, so it runs on any page change)

/*
 * #6192: a refused read's body is always read, so the request finishes. Left unread, a refused fetch never finishes
 * (measured on a real board: 19 requests still open 8 s after a load whose every read was refused), and anything
 * that waits for the page's network to go quiet waits forever (#6188's hung check).
 *
 * The page is loaded from a real board, and every GET under /api/ is sent on to that same board at a path it does
 * not have, so each one gets the board's own 404 over the real network (a request answered at the browser
 * finishes at once and could not show this). Then:
 *   QUIET    8 s after load, no GET under /api/ is still open.
 *   CONTROL  a fetch made with the page's ORIGINAL fetch (saved before the page's own script runs), its body left
 *            unread, IS still open 4 s later: the instrument can see an open request, so QUIET's zero means something.
 *
 *   KOSMOS_URL=http://127.0.0.1:17372 NODE_PATH=~/work/pw-runtime/node_modules node docs/browser-checks/render-refusedbody-6192.js
 */

const { chromium } = require('playwright');

const BASE = (process.env.KOSMOS_URL || 'http://127.0.0.1:16180').replace(/\/+$/, '');
const fail = [];
const say = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' || !process.env.HEADED });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => say(false, 'no page errors', e.message));
    const open = new Map();
    page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname.startsWith('/api/')) open.set(r, new URL(r.url()).pathname); });
    page.on('requestfinished', (r) => open.delete(r));
    page.on('requestfailed', (r) => open.delete(r));
    await page.addInitScript(() => { window.__originalFetch = window.fetch; });
    await page.route('**/api/**', (route) => {
      const r = route.request();
      if (r.method() !== 'GET') return route.continue();
      return route.continue({ url: BASE + '/api/refused-by-check-6192' + new URL(r.url()).pathname.replace(/\//g, '-') });
    });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(8000);
    const loadOpen = [...open.values()].filter((p) => !p.includes('control-6192'));
    say(loadOpen.length === 0, 'quiet: no refused read is still open 8 s after load', loadOpen.length ? JSON.stringify(loadOpen) : '');
    await page.evaluate(() => { window.__originalFetch('/api/control-6192'); });   // body left unread on purpose
    await page.waitForTimeout(4000);
    const ctl = [...open.values()].filter((p) => p.includes('control-6192')).length;
    say(ctl === 1, 'control: an unread refusal from the original fetch is still open (the instrument can see one)', String(ctl));
  } catch (e) {
    say(false, 'the check ran to the end', (e && e.message) || String(e));
  } finally {
    await browser.close();
  }
  console.log(fail.length ? 'FAIL render-refusedbody-6192 (' + fail.length + ')' : 'PASS render-refusedbody-6192');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
