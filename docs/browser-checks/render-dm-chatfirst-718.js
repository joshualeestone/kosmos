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
 *   - no sideways page scroll, and the page is not scroll-locked (a tall header menu such as the
 *     world switcher must still reach its last row);
 *   - a long agent name stays inside the screen in the compact header;
 *   - while typing the thread still shows some conversation, focus on Post does not bring the
 *     header back, and searching keeps the search row while the rest steps aside;
 *   - and at 800 and 1280 the Talk section keeps its stacked or side-by-side layout: the body is
 *     not locked, the 800px page still scrolls, and the tiles keep their box layout.
 *   Not covered: pinch zoom (the listener multiplies by visualViewport.scale; Playwright cannot
 *   drive a pinch), and iOS panning the layout viewport on focus (on the iOS simulator list).
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
/** While typing, the thread must still show at least a line or two of conversation. */
const MIN_THREAD_WHILE_TYPING_PX = 40;

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

/** Long enough to overflow the compact one-row header on an iPhone SE if nothing ellipsizes it. */
const LONG_AGENT_NAME = 'Alexandria Montgomery-Whitfield of the Northern Research Desk';

async function open(browser, w, h, theme, agentName = 'April') {
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
  await page.evaluate(([f, agentName]) => {
    window.__fx = f;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    LAST = [{ sessionName: 'april', name: agentName, role: 'Researcher', status: 'working', isNamedOurs: true, nameDerived: true }];
    openDetail('april', 'talk');
  }, [FX, agentName]);
  await page.evaluate((n) => paintTalk('april', n), agentName);
  await page.waitForSelector('#d-dmthread .msg');
  return { page, errs };
}

/* Runs in the page: rects of what a person needs, and whether the page itself scrolls. */
function measure() {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height, shown: r.width > 0 && r.height > 0 }; };
  const th = document.getElementById('d-dmthread');
  return {
    vh: window.innerHeight, vw: document.documentElement.clientWidth,
    docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth,
    say: R('#d-say'), send: R('#d-send'), attach: R('#d-attach'), box: R('.dmbar.composerbox'),
    profile: R('#d-nav [data-go=profile]'), dm: R('#d-nav [data-go=talk]'),
    threadScrolls: th.scrollHeight > th.clientHeight, threadH: th.clientHeight,
    head: R('.dhead'), label: R('#d-talk-label'),
    tabsRow: getComputedStyle(document.getElementById('d-nav')).flexDirection,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    visibleVar: getComputedStyle(document.documentElement).getPropertyValue('--kosmos-visible-height').trim(),
    boxMinH: getComputedStyle(document.getElementById('d-talk-box')).minHeight,
    labelDisplay: getComputedStyle(document.getElementById('d-talk-label')).display,
    labelText: (document.getElementById('d-talk-label').textContent || '').trim(),
    search: R('#d-talk-search'), conn: R('#conn'),
    bodyPadLeft: parseFloat(getComputedStyle(document.body).paddingLeft),
    boxLeft: R('#d-talk-box') && R('#d-talk-box').left,
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
        chk(m.profile && m.profile.shown && m.profile.bottom <= m.vh && m.profile.left >= 0 && m.profile.right <= m.vw && m.profile.h >= MIN_TAP_PX, `${t} the Profile tab is on screen and at least ${MIN_TAP_PX}px`, JSON.stringify(m.profile));
        chk(Math.abs(m.boxLeft) <= 0.5, `${t} the conversation box runs edge to edge (its negative margin matches the page gutter)`, `left=${m.boxLeft} bodyPad=${m.bodyPadLeft}`);
        chk(m.tabsRow === 'row', `${t} the section tabs are one row`, m.tabsRow);
        chk(!(m.label && m.label.w > 2 && m.label.h > 2) && m.labelDisplay !== 'none' && m.labelText.length > 0, `${t} the caption that repeats the agent's name is not shown but kept for screen readers`, JSON.stringify({ label: m.label, display: m.labelDisplay, text: m.labelText }));
        chk(m.visibleVar === m.vh + 'px', `${t} the page's visualViewport listener writes the visible height`, `var=${m.visibleVar} vh=${m.vh}`);
        chk(m.boxMinH === '0px', `${t} the phone rules win over the 56rem talk-fill block (talk box min-height 0)`, m.boxMinH);
        chk(m.docW <= m.vw, `${t} no sideways page scroll`, `docW=${m.docW} vw=${m.vw}`);
        // Not scroll-locked: a header menu taller than the screen (the world switcher with many
        // Kosmos instances) must still be able to scroll the page to its last row.
        chk(m.bodyOverflow !== 'hidden', `${t} the body is not overflow:hidden (a tall header menu can still scroll the page)`, m.bodyOverflow);

        // Simulated keyboard: focus the composer, shrink the visible height the way the page's
        // visualViewport listener would, and the composer must sit above the keyboard.
        await page.focus('#d-say');
        await page.evaluate((k) => document.documentElement.style.setProperty('--kosmos-visible-height', (window.innerHeight - k) + 'px'), SIMULATED_KEYBOARD_PX);
        const k = await page.evaluate(measure);
        const limit = k.vh - SIMULATED_KEYBOARD_PX;
        chk(k.box && k.box.bottom <= limit + 1 && k.box.top >= 0, `${t} with the keyboard up the composer sits above it`, `bottom=${k.box && Math.round(k.box.bottom)} limit=${limit}`);
        chk(k.head && !k.head.shown, `${t} while typing the header steps aside`);
        chk(k.threadH >= MIN_THREAD_WHILE_TYPING_PX, `${t} while typing the thread still shows conversation`, `threadH=${k.threadH}`);
        // A real press on Post (pointer down, measured before release, then released off the
        // button so nothing is sent): the text box keeps focus and the header stays aside. WebKit
        // does not focus a button on click, so programmatic focus would not test this.
        const sb = await page.evaluate(() => { const r = document.getElementById('d-send').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.mouse.move(sb.x, sb.y); await page.mouse.down();
        const kp = await page.evaluate(measure);
        const keptFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
        await page.mouse.move(2, 2); await page.mouse.up();
        chk(kp.head && !kp.head.shown && keptFocus === 'd-say', `${t} pressing Post keeps focus in the text box and the header aside`, `active=${keptFocus}`);
        // Searching opens the keyboard too: the search row stays, the rest steps aside. A person
        // leaves the composer first (the search row is aside while it has focus).
        await page.evaluate(() => document.activeElement.blur());
        await page.focus('#d-talk-search');
        const searchFocused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'd-talk-search');
        chk(searchFocused, `${t} the search box can take focus`);
        const ks = await page.evaluate(measure);
        chk(ks.search && ks.search.shown && ks.search.bottom <= limit && ks.threadH >= MIN_THREAD_WHILE_TYPING_PX, `${t} searching with the keyboard up keeps the search box and some thread visible`, `search=${ks.search && Math.round(ks.search.bottom)} threadH=${ks.threadH} limit=${limit}`);

        // Everything below the thread stays reachable while typing: the folder-trust box, file
        // chips and a send error can outgrow a short talk box, which then scrolls (#2622).
        const crowd = await page.evaluate(() => {
          const q = document.getElementById('d-qask'); q.hidden = false; document.getElementById('d-qask-lab').textContent = 'This agent is waiting for you to trust its folder before it can start work again.';
          const chips = document.getElementById('d-attach-chips'); chips.hidden = false; chips.innerHTML = '<span class="chip">IMG_2041.png</span><span class="chip">quarterly-report.pdf</span>';
          document.getElementById('d-say-msg').textContent = 'Could not send just now. Try again in a moment.';
          const box = document.getElementById('d-talk-box'); box.scrollTop = box.scrollHeight;
          const m = document.getElementById('d-say-msg').getBoundingClientRect(); const b = box.getBoundingClientRect();
          return { overflowY: getComputedStyle(box).overflowY, msgBottom: m.bottom, boxBottom: b.bottom };
        });
        chk(crowd.overflowY === 'auto' && crowd.msgBottom <= crowd.boxBottom + 1, `${t} with the keyboard up, a send error below the composer can be scrolled into view`, JSON.stringify(crowd));
        // The visualViewport listener follows a real viewport shrink (a keyboard opening shrinks
        // the visual viewport the same way; Playwright can only drive it through the window size).
        await page.evaluate(() => { document.activeElement.blur(); document.documentElement.style.removeProperty('--kosmos-visible-height'); });
        await page.setViewportSize({ width: w, height: h - SIMULATED_KEYBOARD_PX });
        await page.waitForFunction((want) => getComputedStyle(document.documentElement).getPropertyValue('--kosmos-visible-height').trim() === want + 'px', h - SIMULATED_KEYBOARD_PX, { timeout: 3000 }).catch(() => {});
        const shrunk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kosmos-visible-height').trim());
        chk(shrunk === (h - SIMULATED_KEYBOARD_PX) + 'px', `${t} the visible height follows a viewport shrink`, `var=${shrunk}`);
        await page.setViewportSize({ width: w, height: h });
        // Leave the composer (a person dismisses the keyboard), then Profile is one tap.
        await page.evaluate(() => { document.activeElement.blur(); document.documentElement.style.removeProperty('--kosmos-visible-height'); });
        await page.click('#d-nav [data-go=profile]');
        const prof = await page.evaluate(() => !document.getElementById('d-sec-profile').hidden);
        chk(prof, `${t} one tap on Profile opens the Profile section`);
        // Every optional identity note at once (usage-limit quote, conflict, sign in again, start
        // this agent), on a fresh page: the identity block scrolls on its own and the thread keeps
        // room to read. The floor is lower on an SE, where the 189px top bar (Raiden's frame, a
        // one-line phone bar is on its way) takes the most.
        {
          const { page: np, errs: nerrs } = await open(browser, w, h, theme);
          await np.evaluate(() => {
            const show = (id, text) => { const e = document.getElementById(id); e.hidden = false; if (text) e.textContent = text; };
            show('d-said-lab', 'Its last words'); show('d-said', 'You have hit your usage limit. It resets at 5pm. Upgrade your plan to keep going, or wait for the reset and try again then.');
            show('d-conflict', 'Two windows claim this agent. We are showing the one that answered most recently; the other may be stale.');
            show('d-reauth'); show('d-start-wrap');
          });
          const mn = await np.evaluate(measure);
          const floor = h < 700 ? 60 : 120;
          chk(mn.threadH >= floor && mn.box && mn.box.bottom <= mn.vh + 1 && mn.profile && mn.profile.shown && mn.profile.h >= MIN_TAP_PX, `${t} with every header note showing, the thread keeps room, the tabs keep their size and the composer is on screen`, `threadH=${mn.threadH} floor=${floor} box=${mn.box && Math.round(mn.box.bottom)} profileH=${mn.profile && mn.profile.h}`);
          chk(nerrs.length === 0, `${t} no page errors with every header note`, nerrs.join(' | '));
          await np.close();
        }
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
      // A long agent name in the compact phone header: it must stay inside the screen.
      {
        const { page, errs } = await open(browser, 375, 667, 'light', LONG_AGENT_NAME);
        const t = `[${eng} 375x667 long name]`;
        const n = await page.evaluate(() => {
          const name = document.getElementById('d-name'); const head = document.querySelector('.dhead');
          const r = name.getBoundingClientRect(); const hr = head.getBoundingClientRect();
          return { right: r.right, headRight: hr.right, vw: document.documentElement.clientWidth, docW: document.documentElement.scrollWidth };
        });
        chk(n.right <= n.vw + 0.5 && n.headRight <= n.vw + 0.5 && n.docW <= n.vw, `${t} the name stays inside the screen`, JSON.stringify(n));
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
      for (const [w, h] of WIDE) {
        const { page, errs } = await open(browser, w, h, 'light');
        const t = `[${eng} ${w}x${h}]`;
        const m = await page.evaluate(measure);
        chk(m.tabsRow === 'column', `${t} the section tiles keep their stacked box layout`, m.tabsRow);
        chk(m.bodyOverflow !== 'hidden', `${t} the page is not locked to the screen`, m.bodyOverflow);
        if (w < 900) chk(m.docH > m.vh, `${t} the stacked tablet page still scrolls`, `docH=${m.docH} vh=${m.vh}`);
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
