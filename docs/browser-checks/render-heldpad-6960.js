// Browser-check-surface: pj-room pj-held panel-projects
'use strict';
/**
 * kosmos#6960: in a held room the composer (with #5800's strip inside it) sticks to the window's bottom, and a post
 * brought into view by a jump stopped at the window's bottom edge, under it. Drives the real page, file://, fetch
 * stubbed, on chromium and webkit, at a phone (393x852) and a desktop (1280x800):
 *   - the room is filled with posts and the held strip is drawn by the page's own pjHeldNotice;
 *   - the newest post is scrolled into view (as a jump does): the point just above its bottom edge is the post, not
 *     the composer, and its bottom is at or above the composer's top;
 *   - the page's scroll-padding-bottom is the composer's height (pjComposerTrack), read after the strip grew it;
 *   - CONTROL, at the phone: with scroll-padding-bottom forced to 0 the same jump leaves the post under the composer,
 *     so the check can see the failure it guards.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-heldpad-6960.js [shots-dir]
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const SHOTS = process.argv[2] || '';
const fail = [];
let RAN = 0;
const chk = (ok, label, extra) => {
  RAN += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

async function open(browser, w, h, eng) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 700, isMobile: w < 700 && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.setInterval = () => 0;   // no poll of the page's own: nothing may repaint the room under the check
    window.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await page.goto(PAGE);
  await page.evaluate(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    document.querySelectorAll('body > section').forEach((s) => { s.hidden = s.id !== 'panel-projects'; });
    // The room column and everything above it shown, as an open project shows it.
    for (let e = document.getElementById('pj-room'); e && e !== document.body; e = e.parentElement) e.hidden = false;
    const room = document.getElementById('pj-room');
    room.textContent = '';
    for (let i = 1; i <= 14; i += 1) {
      const m = document.createElement('div');
      m.className = 'msg';
      m.innerHTML = '<div class="msg-av">A</div><div class="msg-bd"><b>Ada</b><div>Post ' + i + ': the draft goes back for one more pass on the second section, and the figures stay as they are.</div></div>';
      room.appendChild(m);
    }
    const strip = document.getElementById('pj-held');
    strip.innerHTML = pjHeldNotice({ until: new Date(Date.now() + 3600e3).toISOString() }, 'p6960');
    strip.hidden = false;
  });
  await page.waitForTimeout(300);   // the ResizeObserver reports the grown composer before any jump, as in the app
  return { ctx, page, errs };
}

/* Scrolls the room to its end and the newest post into view, then reads where it ended up against the composer. */
async function jump(page, noPad) {
  return page.evaluate(async (np) => {
    if (np) document.documentElement.style.scrollPaddingBottom = '0px';
    const room = document.getElementById('pj-room');
    room.scrollTop = room.scrollHeight;
    const last = room.lastElementChild;
    last.scrollIntoView({ block: 'nearest' });
    await new Promise((r) => setTimeout(r, 250));
    const lr = last.getBoundingClientRect(), cr = document.querySelector('.pjmid .composer').getBoundingClientRect();
    const at = document.elementFromPoint(lr.left + lr.width / 2, lr.bottom - 6);
    return { lastBottom: Math.round(lr.bottom), composerTop: Math.round(cr.top), composerH: Math.ceil(cr.height),
      pad: getComputedStyle(document.documentElement).scrollPaddingBottom, seen: !!at && last.contains(at),
      at: at ? String(at.className || at.tagName).slice(0, 30) : null };
  }, noPad);
}

let STEP = 'start';
const WATCHDOG = setTimeout(() => { console.log('FAIL  render-heldpad-6960 did not finish in 4 minutes (stuck at: ' + STEP + ')'); process.exit(3); }, 240000);
(async () => {
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    const t = `[${eng}]`;
    for (const [w, h, name] of [[393, 852, 'phone'], [1280, 800, 'desktop']]) {
      STEP = `${eng} ${name}`;
      const { ctx, page, errs } = await open(browser, w, h, eng);
      const r = await jump(page, false);
      chk(r.seen && r.lastBottom <= r.composerTop + 1,
        `${t} ${name}: the newest post, jumped to in a held room, ends above the composer and is what shows at its end`, JSON.stringify(r));
      chk(parseFloat(r.pad) >= r.composerH - 1 && parseFloat(r.pad) <= r.composerH + 1,
        `${t} ${name}: scroll-padding-bottom is the composer's height, read after the held strip grew it`, JSON.stringify(r));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `heldpad-${eng}-${name}.png`) });
      chk(errs.length === 0, `${t} ${name}: no page errors`, errs.join(' | '));
      await ctx.close();
    }
    STEP = `${eng} control`;
    const c = await open(browser, 393, 852, eng);
    const cr = await jump(c.page, true);
    chk(!cr.seen && cr.lastBottom > cr.composerTop + 20,
      `${t} CONTROL phone: with no scroll-padding-bottom the same jump leaves the post under the composer`, JSON.stringify(cr));
    await c.ctx.close();
    await browser.close();
  }
  if (engines.length === 0) chk(false, 'ENGINES named no engine, so nothing ran');
  const EXPECTED_PER_ENGINE = 7;
  if (RAN !== EXPECTED_PER_ENGINE * engines.length) chk(false, `ran ${RAN} checks, expected ${EXPECTED_PER_ENGINE * engines.length}`);
  clearTimeout(WATCHDOG);
  console.log(`render-heldpad-6960: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
