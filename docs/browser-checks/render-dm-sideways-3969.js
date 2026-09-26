// Browser-check-surface: d-sec-talk d-talk-box d-dmthread d-say d-send d-nav dhead dav-wrap d-talk-caprow panel-detail
'use strict';

/**
 * #3969 (#718; Liu Kang m1061): the agent chat on a phone held sideways. On main at 640x360 the
 * conversation was 0px and the message box below the screen; at 740x360 (past the 40rem phone block)
 * the chat sat under the whole profile, about 900px down a scrolling page. On the REAL page, a phone
 * held sideways (touch, landscape, at most 30rem tall, narrower than 56rem) at 640x360, 740x360, 667x375 and
 * 852x393, light and dark (from 56rem, a 932x430 Pro Max, the side-by-side layout already fits the chat):
 *   - the page does not scroll, and there is no sideways scroll;
 *   - at least MIN_THREAD_PX of the conversation is on screen, and the message box and Post are on screen;
 *   - the Profile tab is on screen and a 44px target (the rest of the agent is one tap away);
 * and, as controls: portrait phones keep the chat-first layout as before (the "All agents" link, the
 * search row and the avatar are shown), and a short but wide window with a mouse (800x400) does not get
 * the sideways rules.
 *
 * Harness as render-dm-chatfirst-718.js: file://, fetch stubbed, the agent opened through openDetail. No
 * board and no real conversation. Touch is emulated; WebKit is an engine approximation, not Safari.
 * KOSMOS_PAGE=<index.html> runs it against another build (the negative control on main).
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-sideways-3969.js
 *   ENGINES=chromium,webkit ... for both engines. The gate runs Chromium only.
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const fail = [];
let RAN = 0;
const chk = (ok, label, extra) => {
  RAN += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

/** Enough of the conversation to read a message or two (measured 57 to 116px on the fixed page). */
const MIN_THREAD_PX = 50;
const MIN_TAP_PX = 44;
const SIDEWAYS = [[640, 360], [740, 360], [667, 375], [852, 393]];   // from 56rem (a 932x430 Pro Max) the side-by-side layout already fits the chat
const PORTRAIT = [[375, 667], [393, 852]];

const at = (i) => new Date(Date.now() - (60 - i) * 60e3).toISOString();
const FX = { messages: Array.from({ length: 12 }, (_, i) => (i % 2 ? { at: at(i), text: 'message ' + i + ' from the person', delivery: { state: 'placed' } } : { from: 'april', at: at(i), text: 'reply ' + i + ' from the agent' })), olderCount: 0, presence: 'on', asking: false };

async function open(browser, eng, w, h, theme, touch) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: touch, isMobile: touch && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url) => { const u = String(url); if (u.includes('/thread')) return enc(window.__fx); if (u.includes('avatar')) return new Response('', { status: 404 }); return enc({}); };
  });
  await page.goto(PAGE);
  await page.evaluate((f) => {
    window.__fx = f;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    LAST = [{ sessionName: 'april', name: 'April', role: 'Researcher', status: 'working', isNamedOurs: true, nameDerived: true }];
    openDetail('april', 'talk');
  }, FX);
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

/* Runs in the page: what a person sees without scrolling. */
function measure() {
  const vis = window.visualViewport ? window.visualViewport.height : innerHeight;
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, shown: r.height > 0 && getComputedStyle(e).display !== 'none' }; };
  const t = R('#d-dmthread');
  const shownThread = t ? Math.max(0, Math.min(t.bottom, vis) - Math.max(t.top, 0)) : 0;
  const say = R('#d-say'); const send = R('#d-send'); const prof = R('#d-nav [data-go=profile]');
  return {
    vis: Math.round(vis), docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth,
    shownThread: Math.round(shownThread),
    composer: !!(say && send && say.shown && say.bottom <= vis + 0.5 && send.bottom <= vis + 0.5 && say.top >= 0),
    profile: prof ? { onScreen: prof.shown && prof.top >= 0 && prof.bottom <= vis + 0.5, h: Math.round(prof.h) } : null,
    back: !!(R('#panel-detail > .back') || {}).shown, search: !!(R('#d-talk-box .d-talk-caprow') || {}).shown, avatar: !!(R('.dhead .dav-wrap') || {}).shown,
  };
}

(async () => {
  for (const eng of (process.env.ENGINES || 'chromium').split(',')) {
    const browser = await pw[eng].launch({ headless: process.env.HEADED !== '1' });
    try {
      for (const [w, h] of SIDEWAYS) for (const theme of ['light', 'dark']) {
        const t = `[${eng} ${w}x${h} sideways ${theme}]`;
        const { ctx, page, errs } = await open(browser, eng, w, h, theme, true);
        const m = await page.evaluate(measure);
        chk(m.docH <= m.vis + 1 && m.docW <= m.vw, `${t} the page does not scroll, down or sideways`, JSON.stringify({ docH: m.docH, vis: m.vis, docW: m.docW, vw: m.vw }));
        chk(m.shownThread >= MIN_THREAD_PX, `${t} at least ${MIN_THREAD_PX}px of the conversation is on screen`, `shown=${m.shownThread}`);
        chk(m.composer, `${t} the message box and Post are on screen`, JSON.stringify(m));
        chk(m.profile && m.profile.onScreen && m.profile.h >= MIN_TAP_PX, `${t} the Profile tab is on screen and a ${MIN_TAP_PX}px target`, JSON.stringify(m.profile));
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
      }
      for (const [w, h] of PORTRAIT) {
        const t = `[${eng} ${w}x${h} portrait]`;
        const { ctx, page, errs } = await open(browser, eng, w, h, 'light', true);
        const m = await page.evaluate(measure);
        chk(m.back && m.search && m.avatar && m.composer && m.docH <= m.vis + 1, `${t} unchanged: the All agents link, the search row and the avatar show, the composer is on screen, no page scroll`, JSON.stringify(m));
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
      }
      {
        const t = `[${eng} 800x400 mouse]`;
        const { ctx, page, errs } = await open(browser, eng, 800, 400, 'light', false);
        const m = await page.evaluate(measure);
        chk(m.back && m.search && m.avatar, `${t} a short wide window with a mouse does not get the sideways rules`, JSON.stringify({ back: m.back, search: m.search, avatar: m.avatar }));
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
  const EXPECTED_PER_ENGINE = 46;   // 8 sideways runs x 5, 2 portrait x 2, 2 mouse
  const want = EXPECTED_PER_ENGINE * (process.env.ENGINES || 'chromium').split(',').length;
  if (RAN !== want) { console.log(`FAIL  ran ${RAN} checks, expected ${want}`); fail.push('check count'); }
  console.log(fail.length ? `\n${fail.length} FAILED` : `\nALL PASS (${RAN} checks)`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
