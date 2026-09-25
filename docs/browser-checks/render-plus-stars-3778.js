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
 * And that leaving disconnects the size watcher (a real disconnect() call, counted), and (review pass 2)
 * that a re-size keeps each dot in its place in proportion rather than re-seeding the field. RED on main: the settled arm already differs
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
        /* Review pass 2: count real disconnects, so "leaving disconnects" cannot pass on a null alone. */
        window.__roDisconnects = 0;
        const d = ResizeObserver.prototype.disconnect;
        ResizeObserver.prototype.disconnect = function () { window.__roDisconnects += 1; return d.apply(this, arguments); };
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
      const watching = await page.evaluate(() => (typeof plusStarsObs !== 'undefined' && plusStarsObs !== null));
      chk(watching, `${t} on Kosmos+ the size watcher is running`, String(watching));
      const settled = await read();
      chk(settled.active && same(settled), `${t} the star field's buffer has its displayed aspect once Kosmos+ has settled`, JSON.stringify(settled));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `3778-${w}x${h}.png`) });

      // The section's content grows after mount: the canvas's box moves with it.
      /* Review pass 2: the first few dots' places, as fractions of the box, so a re-size that re-seeds
         the field (every dot jumping) is told apart from one that keeps it. */
      const places = () => page.evaluate(() => plusParts.slice(0, 8).map((q) => [q.x / plusSW, q.y / plusSH]));
      const placesBefore = await places();
      await page.evaluate(() => { const d = document.createElement('div'); d.id = 'check-3778-grow'; d.style.height = '420px'; document.getElementById('s-sec-plus').appendChild(d); });
      await page.waitForTimeout(300);
      const grown = await read();
      chk(same(grown) && grown.cssH > settled.cssH, `${t} after the section grows, the buffer follows (not only on a window resize)`, JSON.stringify({ settled, grown }));
      /* A dot drifts at most about 0.14px a frame, so in ~20 frames it moves a few px: well under 3% of the
         box. A re-seed puts it anywhere. Eight dots all within 3% by chance is not a real risk. */
      const placesAfter = await places();
      const kept = placesBefore.length === 8 && placesBefore.every((p, i) => placesAfter[i] && Math.abs(p[0] - placesAfter[i][0]) < 0.03 && Math.abs(p[1] - placesAfter[i][1]) < 0.03);
      chk(kept, `${t} a re-size keeps each dot in its place (the field is not re-seeded, no jump)`, JSON.stringify({ placesBefore: placesBefore.slice(0, 2), placesAfter: placesAfter.slice(0, 2) }));
      /* Review pass 1: no blank frame when the buffer re-sizes. An observer made AFTER the page's own
         fires after it in the same frame, before paint; the field it sees must already have dots. */
      const blink = await page.evaluate(() => new Promise((resolve) => {
        const c = document.getElementById('plus-stars'); const bufBefore = c.height;
        const lit = () => { const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n; };
        let seen = null;
        const ro = new ResizeObserver(() => { if (seen === null && c.width) { seen = { lit: lit(), bufH: c.height, bufBefore }; ro.disconnect(); resolve(seen); } });
        ro.observe(c);
        requestAnimationFrame(() => { const d = document.createElement('div'); d.id = 'check-3778-grow2'; d.style.height = '37px'; document.getElementById('s-sec-plus').appendChild(d); });
        setTimeout(() => resolve(seen || { timeout: true }), 1500);
      }));
      /* Review pass 2: it must have RE-SIZED in that frame, or a buffer that never changed (still holding its last
         frame) passes on lit alone. */
      chk(blink && blink.lit > 0 && blink.bufH !== blink.bufBefore, `${t} the field is drawn in the same frame it re-sizes (no blank frame)`, JSON.stringify(blink));
      await page.evaluate(() => { const d = document.getElementById('check-3778-grow2'); if (d) d.remove(); });
      await page.evaluate(() => { const d = document.getElementById('check-3778-grow'); if (d) d.remove(); });
      await page.waitForTimeout(300);

      // A window resize.
      /* Review pass 2: a resize that leaves the canvas's box as it was tests nothing (1400 -> 1220 did not move it),
         so this one is narrow enough to move the box, and the arm requires that it did. */
      const before = await read();
      await page.setViewportSize({ width: Math.round(w * 0.6), height: h - 60 });
      await page.waitForTimeout(400);
      const resized = await read();
      chk(same(resized) && (resized.cssW !== before.cssW || resized.cssH !== before.cssH), `${t} after a window resize that moves the box, the buffer has its displayed aspect`, JSON.stringify({ before, resized }));
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);

      // Away and back: the watcher goes with the page and comes back with it.
      // To the Agents tab (a Settings section would fetch its own data, which this stub answers with {}).
      const discBefore = await page.evaluate(() => window.__roDisconnects);   // the check's own observers disconnect too
      await page.evaluate(() => showTab('agents'));
      await page.waitForTimeout(200);
      const away = await page.evaluate(() => ({ active: document.body.classList.contains('plus-active'), watcher: typeof plusStarsObs !== 'undefined' ? plusStarsObs : 'missing', disconnects: window.__roDisconnects }));
      chk(!away.active && away.watcher === null && away.disconnects - discBefore === 1, `${t} leaving Kosmos+ disconnects the size watcher`, JSON.stringify(away));
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
