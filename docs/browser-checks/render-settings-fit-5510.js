'use strict';

/**
 * Settings fits a phone (#5510). The kind-of-business select in Settings, Community, sized itself to its longest option
 * ("A construction or trades business", 290px) and ran 3px past the Settings panel on a 360px phone. The real
 * web/index.html is served with every /api call answered by a stub (no board runs), as the Android app shows it
 * (over Kosmos+, at kosmos-remote.test), and the page's own industryPaint() fills the select:
 *   F  at 360 and 412 CSS px, as a touch phone, the select ends inside the Settings panel's content box, and the panel
 *      does not scroll sideways;
 *   C  CONTROL at 1280 with a mouse, the select is still its own width (not stretched to the row), so the fix did not
 *      change the desktop.
 * Against web/index.html from before #5510, F FAILS at 360:
 *   SETTINGSFIT_HTML=/path/to/old/index.html node docs/browser-checks/render-settings-fit-5510.js
 * Needs no URL. ENGINES=chromium,webkit adds WebKit.
 *
 *   ENGINES=chromium HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-settings-fit-5510.js
 */
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-settings-fit-5510: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
const HTML = fs.readFileSync(process.env.SETTINGSFIT_HTML || path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
const ORIGIN = 'http://kosmos-remote.test';
// The board's own list holds this label (engine/community industries); the longest is what sized the select.
const INDUSTRIES = [{ key: 'trades', display: 'A construction or trades business' }, { key: 'shop', display: 'A shop' }];

let fails = 0;
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (cond || !detail ? '' : '  (' + detail + ')'));
  if (!cond) fails++;
};

async function open(engine, width, phone) {
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  const ctx = await browser.newContext({
    viewport: { width, height: phone ? 800 : 900 },
    ...(phone ? { hasTouch: true, ...(engine === 'chromium' ? { isMobile: true, deviceScaleFactor: 2 } : {}) } : {}),
  });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e && e.message)));
  await pg.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await pg.goto(ORIGIN + '/?tab=settings&sec=automation', { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof industryPaint === 'function');
  await pg.waitForTimeout(400);
  await pg.evaluate((industries) => industryPaint({ ok: true, industries, industry: 'trades' }), INDUSTRIES);
  await pg.evaluate(() => document.getElementById('community-industry').scrollIntoView({ block: 'center' }));
  await pg.waitForTimeout(150);
  return { browser, pg, errors };
}

const measure = (pg) => pg.evaluate(() => {
  const s = document.getElementById('community-industry');
  const panel = s.closest('.panel');
  const r = s.getBoundingClientRect(), pr = panel.getBoundingClientRect(), pcs = getComputedStyle(panel);
  const row = s.parentElement.getBoundingClientRect();
  const intrinsic = (() => { const c = s.cloneNode(true); c.style.cssText = 'position:absolute;visibility:hidden;max-width:none;min-width:0;width:auto'; document.body.appendChild(c); const w = c.getBoundingClientRect().width; c.remove(); return w; })();
  return { shown: s.getClientRects().length > 0, right: Math.round(r.right), inner: Math.round(pr.right - parseFloat(pcs.paddingRight)),
    width: Math.round(r.width), row: Math.round(row.width), intrinsic: Math.round(intrinsic), sideways: panel.scrollWidth > panel.clientWidth };
});

(async () => {
  for (const engine of ENGINES) {
    for (const width of [360, 412]) {
      const { browser, pg, errors } = await open(engine, width, true);
      const m = await measure(pg);
      ok(m.shown, `${engine} ${width}: the kind-of-business select is on screen`, JSON.stringify(m));
      ok(m.right <= m.inner && !m.sideways, `${engine} ${width} F: it ends inside the Settings panel, which does not scroll sideways`, JSON.stringify(m));
      ok(!errors.length, `${engine} ${width}: no page errors`, errors.join(' | '));
      await browser.close();
    }
    const { browser, pg, errors } = await open(engine, 1280, false);
    const m = await measure(pg);
    ok(m.shown && Math.abs(m.width - m.intrinsic) <= 2 && m.width < m.row, `${engine} 1280 CONTROL: on a desktop the select keeps its own width`, JSON.stringify(m));
    ok(!errors.length, `${engine} 1280: no page errors`, errors.join(' | '));
    await browser.close();
  }
  console.log(fails ? `\nrender-settings-fit-5510: ${fails} FAILED` : '\nrender-settings-fit-5510: all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  render-settings-fit-5510: ' + (e && e.stack || e)); process.exit(1); });
