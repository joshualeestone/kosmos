// Browser-check-surface: d-sec-talk d-talk-box d-dmthread d-say d-send d-attach d-nav dleft dhead d-talk-label
'use strict';

/**
 * #718 (Josh, 2026-09-24: "make sure the designs fit well on mobile"; Liu Kang decided the
 * chat-first build). The agent page with Direct Message open, at real phone sizes, on the REAL
 * rendered page:
 *   - the page is exactly the screen: no page scroll, and the thread scrolls inside it
 *     (before this, an iPhone SE put the conversation 1,114px down and the composer at 1,541px);
 *   - the composer and its Post button are on screen, and stay above a simulated keyboard while
 *     the composer has focus (the visible height written the way the page's own script writes it);
 *   - the composer's controls and the section tabs meet the 44px tap minimum;
 *   - Profile is one tap away: its tab is on screen and opens the Profile section;
 *   - no sideways page scroll;
 *   - and at 800 and 1280 the Talk section keeps its stacked or side-by-side layout: the page
 *     is not locked to the screen height below 56rem, and the tiles keep their box layout.
 *
 * Harness posture mirrors render-dm-phone-718.js: file://, the thread poll answered from a
 * fixture, the agent opened through openDetail. No board and no real conversation are involved.
 * The keyboard is SIMULATED by setting --kosmos-visible-height, which is what the page's
 * visualViewport listener does on a device; a real on-screen keyboard is not driven here, and
 * WebKit is an engine approximation, not Safari or WKWebView.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-chatfirst-718.js
 *   ENGINES=chromium,webkit ... for both engines. The gate runs Chromium only.
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

/** A keyboard takes roughly this much of a phone's height; used to simulate it. */
const SIMULATED_KEYBOARD_PX = 300;
/** Apple's and Google's minimum comfortable tap target. */
const MIN_TAP_PX = 44;

const at = (i) => new Date(Date.now() - (60 - i) * 60e3).toISOString();
const FX = {
  messages: Array.from({ length: 14 }, (_, i) => (i % 2
    ? { at: at(i), text: 'message ' + i + ' from the person, long enough to take two lines on a phone', delivery: { state: 'placed' } }
    : { from: 'april', at: at(i), text: 'reply ' + i + ' from the agent' })),
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};
const PHONES = [[375, 667], [393, 852], [412, 915], [430, 932]];
const WIDE = [[800, 1000], [1280, 900]];

async function open(browser, w, h, theme) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/thread')) return enc(window.__fx);
      if (u.includes('avatar')) return new Response('', { status: 404 });
      return enc({});
    };
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
  await page.waitForSelector('#d-dmthread .msg');
  return { page, errs };
}

/* Runs in the page: rects of what a person needs, and whether the page itself scrolls. */
function measure() {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 }; };
  const th = document.getElementById('d-dmthread');
  return {
    vh: window.innerHeight, vw: document.documentElement.clientWidth,
    docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth,
    say: R('#d-say'), send: R('#d-send'), attach: R('#d-attach'), box: R('.dmbar.composerbox'),
    profile: R('#d-nav [data-go=profile]'), dm: R('#d-nav [data-go=talk]'),
    threadScrolls: th.scrollHeight > th.clientHeight, threadH: th.clientHeight,
    head: R('.dhead'), label: R('#d-talk-label'),
    tabsRow: getComputedStyle(document.getElementById('d-nav')).flexDirection,
  };
}

(async () => {
  for (const eng of (process.env.ENGINES || 'chromium').split(',')) {
    const browser = await pw[eng].launch({ headless: process.env.HEADED === '0' });
    try {
      for (const [w, h] of PHONES) for (const theme of ['light', 'dark']) {
        const { page, errs } = await open(browser, w, h, theme);
        const t = `[${eng} ${w}x${h} ${theme}]`;
        const m = await page.evaluate(measure);
        chk(m.docH <= m.vh + 1, `${t} the page is the screen: it does not scroll`, `docH=${m.docH} vh=${m.vh}`);
        chk(m.threadScrolls && m.threadH >= 120, `${t} the thread scrolls inside it with room to read`, `threadH=${m.threadH}`);
        chk(m.box && m.box.bottom <= m.vh && m.box.top >= 0, `${t} the composer is on screen`, JSON.stringify(m.box));
        chk(m.send && m.send.bottom <= m.vh && m.send.h >= MIN_TAP_PX, `${t} Post is on screen and at least ${MIN_TAP_PX}px tall`, JSON.stringify(m.send));
        chk(m.attach && m.attach.w >= MIN_TAP_PX && m.attach.h >= MIN_TAP_PX, `${t} the add-a-file button is at least ${MIN_TAP_PX}px`, JSON.stringify(m.attach));
        chk(m.profile && m.profile.shown && m.profile.bottom <= m.vh && m.profile.h >= MIN_TAP_PX, `${t} the Profile tab is on screen and at least ${MIN_TAP_PX}px`, JSON.stringify(m.profile));
        chk(m.tabsRow === 'row', `${t} the section tabs are one row`, m.tabsRow);
        chk(!(m.label && m.label.shown), `${t} the caption that repeats the agent's name is not shown`);
        chk(m.docW <= m.vw, `${t} no sideways page scroll`, `docW=${m.docW} vw=${m.vw}`);

        // Simulated keyboard: focus the composer, shrink the visible height the way the page's
        // visualViewport listener would, and the composer must sit above the keyboard.
        await page.focus('#d-say');
        await page.evaluate((k) => document.documentElement.style.setProperty('--kosmos-visible-height', (window.innerHeight - k) + 'px'), SIMULATED_KEYBOARD_PX);
        const k = await page.evaluate(measure);
        const limit = k.vh - SIMULATED_KEYBOARD_PX;
        chk(k.box && k.box.bottom <= limit + 1 && k.box.top >= 0, `${t} with the keyboard up the composer sits above it`, `bottom=${k.box && Math.round(k.box.bottom)} limit=${limit}`);
        chk(k.head && !k.head.shown, `${t} while typing the header steps aside`);

        // Leave the composer (a person dismisses the keyboard), then Profile is one tap.
        await page.evaluate(() => { document.activeElement.blur(); document.documentElement.style.removeProperty('--kosmos-visible-height'); });
        await page.click('#d-nav [data-go=profile]');
        const prof = await page.evaluate(() => !document.getElementById('d-sec-profile').hidden);
        chk(prof, `${t} one tap on Profile opens the Profile section`);
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
      for (const [w, h] of WIDE) {
        const { page, errs } = await open(browser, w, h, 'light');
        const t = `[${eng} ${w}x${h}]`;
        const m = await page.evaluate(measure);
        chk(m.tabsRow === 'column', `${t} the section tiles keep their stacked box layout`, m.tabsRow);
        chk(m.label && m.label.shown, `${t} the "Direct Message to" caption still shows`);
        chk(m.dm && m.dm.h > 60, `${t} the Direct Message tile keeps its large size`, JSON.stringify(m.dm));
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
