// Browser-check-surface: plus-stars s-sec-plus plus-mark
'use strict';

/**
 * kosmos#3778 (Josh, 2026-09-25 13:07, testing Kosmos+ on 0.6.94): "All of the background circles
 * are stretched out into really long elliptical ovals. They should just be the dots moving
 * around." The Kosmos+ page's star field (#plus-stars) is stretched by CSS over #s-sec-plus, and
 * its drawing buffer was sized once, at mount, from the parent's box; when the section's height
 * moved afterwards the buffer was scaled unevenly and every dot became an oval.
 *
 * On a Retina-scale page (deviceScaleFactor 2), at two window sizes, this asserts the buffer's
 * aspect equals the canvas's displayed aspect:
 *   - once the page has settled after opening Kosmos+;
 *   - after the section's content grows (the case a one-time measurement cannot follow);
 *   - after a window resize;
 *   - after leaving Kosmos+ and coming back.
 * And that leaving disconnects the size watcher. RED on main: the settled arm already differs
 * (0.664 against 0.817 at 1400x900). Screenshots to argv[2]: the section at each size.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-plus-stars-3778.js [shotsDir]
 */
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-plus-stars-3778: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};
// Aspects agree within the rounding of a whole-pixel buffer.
const same = (m) => m && m.bufW > 0 && m.bufH > 0 && m.cssW > 0 && m.cssH > 0
  && Math.abs(m.bufW / m.bufH - m.cssW / m.cssH) / (m.cssW / m.cssH) <= 0.01;

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-plus-stars-3778: could not start a browser: ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  try {
    for (const [w, h] of [[1400, 900], [900, 700]]) {
      const t = `[${w}x${h}]`;
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
      await page.addInitScript(() => {
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        // /api/history in the page's own shape (Settings reads it on open); everything else {}.
        window.fetch = async (u) => enc(/\/api\/history/.test(String(u)) ? { readable: true, parts: [] } : {});
      });
      await page.goto(PAGE);
      const open = () => page.evaluate(() => {
        const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
        showTab('settings'); settingsGo('plus');
      });
      const read = () => page.evaluate(() => {
        const c = document.getElementById('plus-stars'); const r = c.getBoundingClientRect();
        return { cssW: Math.round(r.width), cssH: Math.round(r.height), bufW: c.width, bufH: c.height, active: document.body.classList.contains('plus-active') };
      });
      await open();
      await page.waitForTimeout(600);
      const settled = await read();
      chk(settled.active && same(settled), `${t} the star field's buffer has its displayed aspect once Kosmos+ has settled`, JSON.stringify(settled));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `3778-${w}x${h}.png`) });

      // The section's content grows after mount: the canvas's box moves with it.
      await page.evaluate(() => { const d = document.createElement('div'); d.id = 'check-3778-grow'; d.style.height = '420px'; document.getElementById('s-sec-plus').appendChild(d); });
      await page.waitForTimeout(300);
      const grown = await read();
      chk(same(grown) && grown.cssH > settled.cssH, `${t} after the section grows, the buffer follows (not only on a window resize)`, JSON.stringify({ settled, grown }));
      await page.evaluate(() => { const d = document.getElementById('check-3778-grow'); if (d) d.remove(); });
      await page.waitForTimeout(300);

      // A window resize.
      await page.setViewportSize({ width: w - 180, height: h - 60 });
      await page.waitForTimeout(400);
      const resized = await read();
      chk(same(resized), `${t} after a window resize the buffer has its displayed aspect`, JSON.stringify(resized));
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);

      // Away and back: the watcher goes with the page and comes back with it.
      // To the Agents tab (a Settings section would fetch its own data, which this stub answers with {}).
      await page.evaluate(() => showTab('agents'));
      await page.waitForTimeout(200);
      const away = await page.evaluate(() => ({ active: document.body.classList.contains('plus-active'), watcher: typeof plusStarsObs !== 'undefined' ? plusStarsObs : 'missing' }));
      chk(!away.active && away.watcher === null, `${t} leaving Kosmos+ disconnects the size watcher`, JSON.stringify(away));
      await page.evaluate(() => { showTab('settings'); settingsGo('plus'); });
      await page.waitForTimeout(500);
      const back = await read();
      chk(back.active && same(back), `${t} back on Kosmos+, the buffer has its displayed aspect`, JSON.stringify(back));

      chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  if (fail.length) {
    console.error('render-plus-stars-3778: ' + fail.length + ' check(s) failed');
    process.exit(1);
  }
  console.log('render-plus-stars-3778: the Kosmos+ star field draws round dots at every size.');
})().catch((err) => {
  console.error('FAIL  render-plus-stars-3778: the check itself threw: ' + (err && err.message ? err.message.split('\n')[0] : err));
  process.exit(1);
});
