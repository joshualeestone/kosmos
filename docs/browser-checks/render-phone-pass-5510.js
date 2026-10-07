'use strict';

/**
 * The phone board's design pass (#5510): what the Android app opens full screen, the board over Kosmos+ at a phone
 * width (html.kremote). The real web/index.html is served at kosmos-remote.test with every /api call answered by a
 * stub (no board runs), at 360 and 412 CSS px (a narrow and a mid Android phone), as a touch phone:
 *   T  the agents toolbar reads as one row: the sort menu fills the space between + and the view buttons, so the
 *      gap on each side is the row's own 12px (at its own width it sat 3px from the + at 360 and 55px at 412);
 *   N  a project's name gets two lines before it is cut ("Launch the spring catalogue" shows whole), where one line
 *      held 14 characters at 360;
 *   E  the room's emoji button is not shown on a phone touchscreen (the phone's keyboard has emoji), which is what
 *      gives the text box the room for its hint;
 *   P  the room composer's hint is the short "Write something…" on a phone, and turns back into the @name tip
 *      when the window widens (and short again when it narrows), so it is never cut after "Write something c".
 * CONTROLS at a desktop width (1280, mouse): the name stays on one line, the emoji button shows, the hint is the
 * long one; narrowed to 360 with the mouse, the emoji button still shows (only a touchscreen loses it). They keep N, E and P from passing on a page that simply changed every width.
 * Against web/index.html from before #5510, T, N, E and P FAIL:
 *   PHONEPASS_HTML=/path/to/old/index.html node docs/browser-checks/render-phone-pass-5510.js
 * Needs no URL. ENGINES=chromium,webkit adds WebKit (it has no isMobile; it gets touch only).
 *
 *   ENGINES=chromium HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-phone-pass-5510.js
 */
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-phone-pass-5510: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}
const HTML = fs.readFileSync(process.env.PHONEPASS_HTML || path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
const ORIGIN = 'http://kosmos-remote.test';
const LONG_NAME = 'Launch the spring catalogue';
const SHORT_HINT = 'Write something…';
const LONG_HINT = 'Write something or @name to message someone…';

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
  await pg.goto(ORIGIN + '/', { waitUntil: 'load' });
  await pg.waitForFunction(() => typeof kplusRemote === 'function');
  await pg.waitForTimeout(400);
  return { browser, pg, errors };
}

/* The project page's header and the room composer, shown as if a project were open (their ancestors unhidden), with
   the name set: what is measured is the CSS that applies at this width, not the app's routing. */
async function showProject(pg) {
  await pg.evaluate((name) => {
    const unhide = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { if (e.hidden) e.hidden = false; if (getComputedStyle(e).display === 'none') e.style.display = 'block'; } };
    const n = document.getElementById('pj-one-name');
    n.textContent = name;
    unhide(n);
    // As on a real project: the settings cog and Pause share the name's row, so the name has the room it has there.
    unhide(document.getElementById('pj-settings-link'));
    unhide(document.getElementById('pj-head-pause'));
    unhide(document.getElementById('pj-post'));
  }, LONG_NAME);
  await pg.waitForTimeout(100);
}

const lines = (pg) => pg.evaluate(() => {
  const n = document.getElementById('pj-one-name');
  const lh = parseFloat(getComputedStyle(n).lineHeight);
  return { lines: Math.round(n.getBoundingClientRect().height / lh), cut: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 };
});

(async () => {
  for (const engine of ENGINES) {
    for (const width of [360, 412]) {
      const { browser, pg, errors } = await open(engine, width, true);
      const tag = `${engine} ${width}`;
      ok(await pg.evaluate(() => document.documentElement.classList.contains('kremote')), `${tag}: the page is in its Kosmos+ phone layout (html.kremote)`);
      const gaps = await pg.evaluate(() => {
        const r = (sel) => { const e = document.querySelector(sel); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
        const plus = r('#boardbar > #new-agent'), sort = r('#boardbar .sortctl'), view = r('#boardbar .viewtoggle');
        return plus && sort && view ? { left: Math.round(sort.left - plus.right), right: Math.round(view.left - sort.right) } : null;
      });
      ok(gaps && gaps.left >= 10 && gaps.left <= 14 && gaps.right >= 10 && gaps.right <= 14,
        `${tag} T: the sort menu fills the toolbar row (12px each side)`, JSON.stringify(gaps));
      await showProject(pg);
      const room = await pg.evaluate(() => Math.round(document.getElementById('pj-one-name').getBoundingClientRect().width));
      ok(room < width - 100, `${tag} N: the name has a real header's room beside the cog and Pause (${room}px)`, String(room));
      const ln = await lines(pg);
      ok(ln.lines === 2 && !ln.cut, `${tag} N: "${LONG_NAME}" shows whole on two lines`, JSON.stringify(ln));
      ok(await pg.evaluate(() => getComputedStyle(document.getElementById('pj-emoji-btn')).display === 'none'),
        `${tag} E: no emoji button on a phone touchscreen`);
      ok(await pg.evaluate(() => document.getElementById('pj-post').placeholder) === SHORT_HINT, `${tag} P: the room hint is "${SHORT_HINT}"`);
      ok(!errors.length, `${tag}: no page errors`, errors.join(' | '));
      await browser.close();
    }
    // CONTROLS at a desktop width, with a mouse.
    const { browser, pg, errors } = await open(engine, 1280, false);
    await showProject(pg);
    const ln = await lines(pg);
    ok(ln.lines === 1, `${engine} 1280 CONTROL: on a desktop the name stays on one line`, JSON.stringify(ln));
    ok(await pg.evaluate(() => getComputedStyle(document.getElementById('pj-emoji-btn')).display !== 'none'),
      `${engine} 1280 CONTROL: the emoji button shows on a desktop`);
    ok(await pg.evaluate(() => document.getElementById('pj-post').placeholder) === LONG_HINT, `${engine} 1280 CONTROL: the room hint keeps the @name tip`);
    await pg.setViewportSize({ width: 360, height: 800 });
    await pg.waitForTimeout(150);
    ok(await pg.evaluate(() => document.getElementById('pj-post').placeholder) === SHORT_HINT, `${engine} P: narrowing the window shortens the hint`);
    // A narrow window with a MOUSE keeps the emoji button: only a phone touchscreen loses it (the (hover: none) half).
    ok(await pg.evaluate(() => getComputedStyle(document.getElementById('pj-emoji-btn')).display !== 'none'),
      `${engine} 360 CONTROL: a narrow window with a mouse keeps the emoji button`);
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.waitForTimeout(150);
    ok(await pg.evaluate(() => document.getElementById('pj-post').placeholder) === LONG_HINT, `${engine} P: widening it brings the @name tip back`);
    ok(!errors.length, `${engine} 1280: no page errors`, errors.join(' | '));
    await browser.close();
  }
  console.log(fails ? `\nrender-phone-pass-5510: ${fails} FAILED` : '\nrender-phone-pass-5510: all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  render-phone-pass-5510: ' + (e && e.stack || e)); process.exit(1); });
