// Browser-check-surface: d-sec-talk d-talk-box d-dmthread d-say d-send d-attach d-emoji-btn d-emoji d-talk-search d-talk-older d-nav dleft dhead d-talk-label dmbar kosmos-keyboard-up
'use strict';

/**
 * #718 (Josh, 2026-09-24: "make sure the designs fit well on mobile"; Liu Kang decided the
 * chat-first build). The agent page with Direct Message open, at real phone sizes, on the REAL
 * rendered page:
 *   - the page is exactly the screen: no page scroll, and the thread scrolls inside it
 *     (before this, an iPhone SE put the conversation 1,114px down and the composer at 1,541px);
 *   - the composer and its Post button are on screen, and stay above a simulated keyboard while
 *     the composer has focus (the visible height written the way the page's own script writes it);
 *   - Post, add-a-file, the emoji button and the Profile / Direct Message tabs meet the 44px minimum;
 *   - Profile is one tap away: its tab is on screen and opens the Profile section;
 *   - no sideways page scroll, and the page is not scroll-locked (a tall header menu such as the
 *     world switcher must still reach its last row);
 *   - a long agent name stays inside the screen in the compact header;
 *   - while typing the thread still shows some conversation, focus on Post does not bring the
 *     header back, and searching keeps the search row while the rest steps aside;
 *   - and at 800 and 1280 the Talk section keeps its stacked or side-by-side layout: the body is
 *     not locked, the 800px page still scrolls, and the tiles keep their box layout.
 *   - the visualViewport listener itself, driven through a stubbed window.visualViewport: the
 *     keyboard class turns on when the visible height drops, stays off for a pinch zoom (scale),
 *     turns on where the keyboard shrinks the layout viewport too, and resets on rotation.
 *   Not covered: iOS panning the layout viewport on focus (on the iOS simulator list).
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
const fs = require('node:fs');
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
    LAST = [{ sessionName: 'april', name: agentName, role: 'Researcher', status: 'working', isNamedOurs: true, nameDerived: true, context: { percent: 62 } }];
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
  // The phone breakpoint is written in the CSS block and in the listener's matchMedia; pin them equal.
  {
    const src = fs.readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'), 'utf8');
    const block = src.indexOf('#718 CHAT FIRST ON A PHONE');
    const css = (/@media \(max-width: ([0-9.]+rem)\)/.exec(src.slice(block)) || [])[1];
    const js = (/Same breakpoint as the CSS block[^\n]*\n\s*const PHONE_WIDTH = window\.matchMedia\('\(max-width: ([0-9.]+rem)\)'\)/.exec(src) || [])[1];
    chk(!!css && css === js, 'the CSS phone breakpoint and the listener\'s matchMedia are the same', `css=${css} js=${js}`);
  }
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
        chk(m.dm && m.dm.h >= MIN_TAP_PX && m.dm.left >= 0 && m.dm.bottom <= m.vh, `${t} the Direct Message tab is on screen and at least ${MIN_TAP_PX}px`, JSON.stringify(m.dm));
        chk(m.profile && m.profile.shown && m.profile.bottom <= m.vh && m.profile.left >= 0 && m.profile.right <= m.vw && m.profile.h >= MIN_TAP_PX, `${t} the Profile tab is on screen and at least ${MIN_TAP_PX}px`, JSON.stringify(m.profile));
        const ring = await page.evaluate(() => { const r = document.getElementById('d-ring').getBoundingClientRect(); const h = document.querySelector('.dhead').getBoundingClientRect(); const svg = document.querySelector('#d-ring svg'); return { drawn: !!svg, w: r.width, left: r.left, right: r.right, top: r.top, bottom: r.bottom, hl: h.left, hr: h.right, ht: h.top, hb: h.bottom }; });
        chk(ring.drawn && ring.w <= 60 && ring.left >= ring.hl - 0.5 && ring.right <= ring.hr + 0.5 && ring.top >= ring.ht - 0.5 && ring.bottom <= ring.hb + 0.5, `${t} the memory ring is sized to the compact avatar and sits inside the header`, JSON.stringify(ring));
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
        // Focus with NO keyboard (a script focusing the box, a narrow desktop window): the header stays.
        await page.focus('#d-say');
        const nk = await page.evaluate(measure);
        chk(nk.head && nk.head.shown && nk.profile && nk.profile.shown, `${t} focus without a keyboard leaves the header and tabs in place`);
        // Keyboard up: what the page's visualViewport listener does when the visible height drops.
        await page.evaluate((k) => { document.documentElement.style.setProperty('--kosmos-visible-height', (window.innerHeight - k) + 'px'); document.documentElement.classList.add('kosmos-keyboard-up'); }, SIMULATED_KEYBOARD_PX);
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
        chk(kp.head && !kp.head.shown && keptFocus === 'd-say', `${t} pressing Post keeps focus in the text box (the handler's job) and the header aside`, `active=${keptFocus}`);
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
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        await page.focus('#d-say');
        const crowd = await page.evaluate(() => {
          const q = document.getElementById('d-qask'); q.hidden = false; document.getElementById('d-qask-lab').textContent = 'This agent is waiting for you to trust its folder before it can start work again.';
          const chips = document.getElementById('d-attach-chips'); chips.hidden = false; chips.innerHTML = '<span class="chip">IMG_2041.png</span><span class="chip">quarterly-report.pdf</span>';
          document.getElementById('d-say-msg').textContent = 'Could not send just now. Try again in a moment.';
          const box = document.getElementById('d-talk-box'); box.scrollTop = box.scrollHeight;
          const m = document.getElementById('d-say-msg').getBoundingClientRect(); const b = box.getBoundingClientRect();
          return { overflowY: getComputedStyle(box).overflowY, msgBottom: m.bottom, boxBottom: b.bottom, composerShown: getComputedStyle(document.querySelector('#d-talk-box .dmbar')).display !== 'none', active: document.activeElement && document.activeElement.id };
        });
        chk(crowd.active === 'd-say' && crowd.composerShown && crowd.overflowY === 'auto' && crowd.msgBottom <= crowd.boxBottom + 1, `${t} with the keyboard up, a send error below the composer can be scrolled into view`, JSON.stringify(crowd));
        // The visualViewport listener follows a real viewport shrink (a keyboard opening shrinks
        // the visual viewport the same way; Playwright can only drive it through the window size).
        await page.evaluate(() => { document.activeElement.blur(); document.documentElement.style.removeProperty('--kosmos-visible-height'); document.documentElement.classList.remove('kosmos-keyboard-up'); });
        await page.setViewportSize({ width: w, height: h - SIMULATED_KEYBOARD_PX });
        await page.waitForFunction((want) => getComputedStyle(document.documentElement).getPropertyValue('--kosmos-visible-height').trim() === want + 'px', h - SIMULATED_KEYBOARD_PX, { timeout: 3000 }).catch(() => {});
        const shrunk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--kosmos-visible-height').trim());
        chk(shrunk === (h - SIMULATED_KEYBOARD_PX) + 'px', `${t} the visible height follows a viewport shrink`, `var=${shrunk}`);
        await page.setViewportSize({ width: w, height: h });
        // Let the page's own listener settle on the restored height before simulating again, or
        // its late resize overwrites the simulation below.
        const settled = await page.waitForFunction((want) => getComputedStyle(document.documentElement).getPropertyValue('--kosmos-visible-height').trim() === want + 'px' && !document.documentElement.classList.contains('kosmos-keyboard-up'), h, { timeout: 3000 }).then(() => true, () => false);
        chk(settled, `${t} the listener settles on the restored height`);
        // The connection banner above the panel with the keyboard up: the composer must still sit
        // above the keyboard (it is sticky at the bottom of the talk box).
        {
          await page.focus('#d-say');
          await page.evaluate((k) => { document.documentElement.style.setProperty('--kosmos-visible-height', (window.innerHeight - k) + 'px'); document.documentElement.classList.add('kosmos-keyboard-up'); const c = document.getElementById('conn'); c.hidden = false; c.textContent = 'Kosmos cannot reach this computer right now. Trying again.'; }, SIMULATED_KEYBOARD_PX);
          const kc = await page.evaluate(measure);
          chk(kc.box && kc.box.bottom <= limit + 1 && kc.box.top >= 0, `${t} with the connection banner and the keyboard up, the composer sits above the keyboard`, `bottom=${kc.box && Math.round(kc.box.bottom)} limit=${limit}`);
          await page.evaluate(() => { document.getElementById('conn').hidden = true; });
        }
        // Leave the composer (a person dismisses the keyboard), then Profile is one tap.
        await page.evaluate(() => { document.activeElement.blur(); document.documentElement.style.removeProperty('--kosmos-visible-height'); });
        await page.click('#d-nav [data-go=profile]');
        const prof = await page.evaluate(() => !document.getElementById('d-sec-profile').hidden);
        chk(prof, `${t} one tap on Profile opens the Profile section`);
        // Opening Profile scrolls the page to it (that section's own behaviour, not changed here),
        // so the way back is a scroll to the top and one tap on Direct Message.
        const back = await page.evaluate(() => { window.scrollTo(0, 0); const b = document.querySelector('#d-nav [data-go=talk]').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height, vh: window.innerHeight }; });
        chk(back.h >= MIN_TAP_PX && back.top >= 0 && back.bottom <= back.vh, `${t} from Profile, Direct Message is at the top of the page, one tap back`, JSON.stringify(back));
        // Every optional identity note at once (usage-limit quote, conflict, sign in again, start
        // this agent), on a fresh page: the identity block scrolls on its own and the thread keeps
        // room to read. The floor is lower on an SE, where the 189px top bar (Raiden's frame, a
        // one-line phone bar is on its way) takes the most.
        {
          const { page: np, errs: nerrs } = await open(browser, w, h, theme);
          await np.evaluate(() => {
            const show = (id, text) => { const e = document.getElementById(id); e.hidden = false; if (text) e.textContent = text; };
            show('d-said-lab', 'Its last words'); show('d-said', 'You have hit your usage limit. It resets at 5pm. Upgrade your plan to keep going, or wait for the reset and try again then.');
            show('d-instr-stale', 'These instructions changed since the agent last started. Restart it to use them.');
            show('d-reauth'); show('d-start-wrap');
          });
          const mn = await np.evaluate(measure);
          // The name must be visible at the top of the capped block, and Start this agent reachable
          // by scrolling the block (a centred row used to spill above it, out of reach).
          const reach = await np.evaluate(() => {
            const head = document.querySelector('.dhead'); head.scrollTop = 0;
            const hb = head.getBoundingClientRect(); const nm = document.getElementById('d-name').getBoundingClientRect();
            const btn = document.getElementById('d-start-agent'); btn.scrollIntoView({ block: 'nearest' });
            const bb = btn.getBoundingClientRect(); const hb2 = head.getBoundingClientRect();
            return { nameTop: nm.top, headTop: hb.top, btnTop: bb.top, btnBottom: bb.bottom, head2Top: hb2.top, head2Bottom: hb2.bottom, btnH: bb.height };
          });
          chk(reach.nameTop >= reach.headTop - 0.5 && reach.btnTop >= reach.head2Top - 0.5 && reach.btnBottom <= reach.head2Bottom + 0.5 && reach.btnH > 0, `${t} with every header note, the name is visible and Start this agent can be scrolled to`, JSON.stringify(reach));
          const floor = h < 700 ? 60 : 120;
          chk(mn.threadH >= floor && mn.box && mn.box.bottom <= mn.vh + 1 && mn.profile && mn.profile.shown && mn.profile.h >= MIN_TAP_PX, `${t} with every header note showing, the thread keeps room, the tabs keep their size and the composer is on screen`, `threadH=${mn.threadH} floor=${floor} box=${mn.box && Math.round(mn.box.bottom)} profileH=${mn.profile && mn.profile.h}`);
          chk(nerrs.length === 0, `${t} no page errors with every header note`, nerrs.join(' | '));
          await np.close();
        }
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
      // The emoji button shows from 481px (still a phone layout below 40rem): pressing it while
      // typing keeps focus in the text box, like Post, and it meets the tap minimum.
      {
        const { page, errs } = await open(browser, 520, 800, 'light');
        const t = `[${eng} 520x800 emoji]`;
        // Before typing starts (the search row steps aside while the keyboard is up).
        const sr = await page.evaluate(() => document.getElementById('d-talk-search').getBoundingClientRect().height);
        chk(sr >= 40, `${t} the search field itself is a full-height tap target`, `h=${sr}`);
        await page.focus('#d-say');
        await page.evaluate(() => { document.documentElement.style.setProperty('--kosmos-visible-height', (window.innerHeight - 300) + 'px'); document.documentElement.classList.add('kosmos-keyboard-up'); });
        const eb = await page.evaluate(() => { const r = document.getElementById('d-emoji-btn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; });
        chk(eb.w >= MIN_TAP_PX && eb.h >= MIN_TAP_PX, `${t} the emoji button is at least ${MIN_TAP_PX}px`, JSON.stringify(eb));
        await page.mouse.move(eb.x, eb.y); await page.mouse.down();
        const kept = await page.evaluate(() => ({ active: document.activeElement && document.activeElement.id, headShown: document.querySelector('.dhead').getBoundingClientRect().height > 0 }));
        await page.mouse.move(2, 2); await page.mouse.up();
        chk(kept.active === 'd-say' && !kept.headShown, `${t} pressing the emoji button keeps focus in the text box (the handler's job) and the header aside`, JSON.stringify(kept));
        // An emoji picked from the panel while typing: focus stays in the text box too.
        await page.evaluate(() => document.getElementById('d-say').focus());
        await page.click('#d-emoji-btn');
        await page.waitForSelector('#d-emoji:not([hidden]) button', { timeout: 3000 }).catch(() => {});
        const pick = await page.evaluate(() => { const b = document.querySelector('#d-emoji button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        let pickKept = null;
        if (pick) {
          await page.evaluate(() => document.getElementById('d-say').focus());
          await page.mouse.move(pick.x, pick.y); await page.mouse.down();
          pickKept = await page.evaluate(() => ({ active: document.activeElement && document.activeElement.id, headShown: document.querySelector('.dhead').getBoundingClientRect().height > 0 }));
          await page.mouse.move(2, 2); await page.mouse.up();
        }
        chk(pickKept && pickKept.active === 'd-say' && !pickKept.headShown, `${t} pressing an emoji in the panel keeps focus in the text box (the handler's job) and the header aside`, JSON.stringify({ pick: !!pick, pickKept }));
        const sf = await page.evaluate(() => getComputedStyle(document.getElementById('d-talk-search')).fontSize);
        chk(sf === '16px', `${t} the search box is 16px (iOS does not zoom on focus)`, sf);
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
      // A TOUCH tap on Post while typing (touch emulation; iOS itself is on the simulator list):
      // focus stays in the text box. The send goes to the stubbed fetch.
      {
        const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: eng === 'chromium' });
        const page = await ctx.newPage();
        const errs = []; page.on('pageerror', (e) => errs.push(e.message));
        await page.addInitScript(() => {
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.setInterval = () => 0;
          window.fetch = async (url) => { const u = String(url); if (u.includes('/thread')) return enc(window.__fx); if (u.includes('avatar')) return new Response('', { status: 404 }); return enc({}); };
        });
        await page.goto(PAGE);
        await page.evaluate((f) => { window.__fx = f; const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; document.querySelectorAll('body > *').forEach((el) => { el.inert = false; }); LAST = [{ sessionName: 'april', name: 'April', status: 'working', isNamedOurs: true, nameDerived: true }]; openDetail('april', 'talk'); }, FX);
        await page.evaluate(() => paintTalk('april', 'April'));
        await page.waitForSelector('#d-dmthread .msg');
        // sendTalk hands focus back to the text box after a send, which would mask a missing
        // handler; the arm measures the tap alone.
        await page.evaluate(() => { window.sendTalk = () => {}; });
        await page.focus('#d-say');
        await page.fill('#d-say', 'sent by a tap');
        const sb = await page.evaluate(() => { const r = document.getElementById('d-send').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.touchscreen.tap(sb.x, sb.y);
        await page.waitForTimeout(200);
        const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
        chk(active === 'd-say', `[${eng} 375x667 touch] a tap on Post while typing keeps focus in the text box (touch emulation, not iOS)`, `active=${active}`);
        chk(errs.length === 0, `[${eng} 375x667 touch] no page errors`, errs.join(' | '));
        await ctx.close();
      }
      // The emoji panel with a real (stubbed) keyboard up at 600x700: it must open inside the
      // visible screen, above the keyboard, and follow when the keyboard closes.
      {
        const page = await browser.newPage({ viewport: { width: 600, height: 700 } });
        const perrs = []; page.on('pageerror', (e) => perrs.push(e.message));
        await page.addInitScript(() => {
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.setInterval = () => 0;
          window.fetch = async (url) => { const u = String(url); if (u.includes('/thread')) return enc(window.__fx); if (u.includes('avatar')) return new Response('', { status: 404 }); return enc({}); };
          const vv = new EventTarget(); vv.height = 700; vv.scale = 1; vv.width = 600; vv.offsetTop = 0;
          Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
          window.__vv = (height) => { vv.height = height; vv.dispatchEvent(new Event('resize')); };
        });
        await page.goto(PAGE);
        await page.evaluate((f) => { window.__fx = f; const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; document.querySelectorAll('body > *').forEach((el) => { el.inert = false; }); LAST = [{ sessionName: 'april', name: 'April', status: 'working', isNamedOurs: true, nameDerived: true }]; openDetail('april', 'talk'); }, FX);
        await page.evaluate(() => paintTalk('april', 'April'));
        await page.waitForSelector('#d-dmthread .msg');
        const t = `[${eng} 600x700 emoji + keyboard]`;
        await page.focus('#d-say');
        await page.evaluate(() => window.__vv(370));
        await page.click('#d-emoji-btn');
        await page.waitForSelector('#d-emoji:not([hidden])', { timeout: 3000 });
        const up = await page.evaluate(() => { const r = document.getElementById('d-emoji').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height }; });
        chk(up.h > 0 && up.top >= 0 && up.bottom <= 370 + 0.5, `${t} the emoji panel opens above the keyboard`, JSON.stringify(up));
        await page.evaluate(() => window.__vv(700));
        const down = await page.evaluate(() => { const p = document.getElementById('d-emoji'); if (p.hidden) return { hidden: true }; const r = p.getBoundingClientRect(); const c = document.querySelector('#d-talk-box .dmbar').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, cTop: c.top, cBottom: c.bottom }; });
        chk(!down.hidden && (Math.abs(down.cTop - 6 - down.bottom) <= 2 || Math.abs(down.top - 6 - down.cBottom) <= 2), `${t} when the keyboard closes the panel stays open and follows the composer`, JSON.stringify(down));
        chk(perrs.length === 0, `${t} no page errors`, perrs.join(' | '));
        await page.close();
      }
      // The visualViewport listener, driven through a stub (a real keyboard or pinch cannot be
      // driven here). The stub is installed before the page's script reads window.visualViewport.
      {
        const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
        const vvErrs = []; page.on('pageerror', (e) => vvErrs.push(e.message));
        await page.addInitScript(() => {
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.setInterval = () => 0;
          window.fetch = async () => enc({});
          const vv = new EventTarget(); vv.height = window.innerHeight || 667; vv.scale = 1; vv.width = 375; vv.offsetTop = 0;
          Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
          window.__vv = (height, scale) => { vv.height = height; vv.scale = scale; vv.dispatchEvent(new Event('resize')); };
        });
        await page.goto(PAGE);
        const kb = () => page.evaluate(() => document.documentElement.classList.contains('kosmos-keyboard-up'));
        const t = `[${eng} visualViewport listener]`;
        await page.evaluate(() => window.__vv(667, 1));
        chk(!(await kb()), `${t} full height: no keyboard`);
        await page.evaluate(() => window.__vv(367, 1));
        chk(await kb(), `${t} visible height drops 300px: keyboard up`);
        await page.evaluate(() => window.__vv(667, 1));
        chk(!(await kb()), `${t} back to full height: keyboard down`);
        await page.evaluate(() => window.__vv(333.5, 2));
        chk(!(await kb()), `${t} a 2x pinch zoom is not a keyboard`);
        await page.evaluate(() => window.__vv(667, 1));
        // Where the keyboard shrinks the layout viewport too (Firefox Android, resizes-content).
        await page.setViewportSize({ width: 375, height: 367 });
        await page.evaluate(() => window.__vv(367, 1));
        chk(await kb(), `${t} keyboard that also shrinks the layout viewport: still keyboard up`);
        // Rotation (a width change) starts the baseline over.
        await page.setViewportSize({ width: 667, height: 375 });
        await page.evaluate(() => window.__vv(375, 1));
        chk(!(await kb()), `${t} after rotation the new height is the baseline`);
        // Rotating while typing: the keyboard stays up across both rotations.
        await page.setViewportSize({ width: 375, height: 667 });
        await page.evaluate(() => window.__vv(667, 1));
        await page.evaluate(() => window.__vv(367, 1));
        await page.setViewportSize({ width: 667, height: 375 });
        await page.evaluate(() => window.__vv(175, 1));
        chk(await kb(), `${t} rotating to an already-seen landscape width with the keyboard up: still keyboard up`);
        await page.setViewportSize({ width: 375, height: 667 });
        await page.evaluate(() => window.__vv(367, 1));
        chk(await kb(), `${t} rotating back with the keyboard up: still keyboard up`);
        chk(vvErrs.length === 0, `${t} no page errors`, vvErrs.join(' | '));
        await page.close();
      }
      // A swarm agent (#3564) on the phone chat: the cluster fits the 40px slot, and Stop now is on
      // screen without scrolling the header.
      {
        const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
        const serrs = []; page.on('pageerror', (e) => serrs.push(e.message));
        await page.addInitScript(() => {
          const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
          window.setInterval = () => 0;
          window.fetch = async (url) => { const u = String(url); if (u.includes('/thread')) return enc(window.__fx); if (u.includes('avatar')) return new Response('', { status: 404 }); return enc({}); };
        });
        await page.goto(PAGE);
        await page.evaluate((f) => { window.__fx = f; const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true; document.querySelectorAll('body > *').forEach((el) => { el.inert = false; }); SWARMS_ON = true; LAST = [{ sessionName: 'april', name: 'April', status: 'working', isNamedOurs: true, nameDerived: true, swarm: { maxHelpers: 4, activeHelpers: 2, metered: true } }]; openDetail('april', 'talk'); }, FX);
        await page.evaluate(() => paintTalk('april', 'April'));
        await page.waitForSelector('#d-dmthread .msg');
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const t = `[${eng} 375x667 swarm]`;
        const sw = await page.evaluate(() => {
          const R = (e) => e && e.getBoundingClientRect();
          const c = R(document.querySelector('#d-swarm .swc')); const slot = R(document.querySelector('.dhead .detail-av'));
          const stop = R(document.getElementById('d-swarm-stop')); const head = R(document.querySelector('.dhead'));
          const th = document.getElementById('d-dmthread');
          return { panelShown: !document.getElementById('d-swarm-panel').hidden, cw: c && c.width, slotW: slot && slot.width, stopTop: stop && stop.top, stopBottom: stop && stop.bottom, headBottom: head && head.bottom, vh: innerHeight, threadH: th.clientHeight };
        });
        chk(sw.panelShown && sw.cw && sw.cw <= sw.slotW + 0.5, `${t} the swarm cluster fits the compact avatar slot`, JSON.stringify(sw));
        chk(sw.stopTop >= 0 && sw.stopBottom <= sw.headBottom + 0.5 && sw.stopBottom <= sw.vh, `${t} Stop now is on screen in the header, not inside a scroll`, JSON.stringify(sw));
        chk(sw.threadH >= 60, `${t} the thread keeps room to read`, `threadH=${sw.threadH}`);
        const swn = await page.evaluate(() => {
          const show = (id, text) => { const e = document.getElementById(id); e.hidden = false; if (text) e.textContent = text; };
          show('d-said-lab', 'Its last words'); show('d-said', 'You have hit your usage limit. It resets at 5pm. Upgrade your plan to keep going, or wait for the reset and try again then.');
          show('d-instr-stale', 'These instructions changed since the agent last started. Restart it to use them.');
          const stop = document.getElementById('d-swarm-stop').getBoundingClientRect(); const head = document.querySelector('.dhead').getBoundingClientRect();
          return { stopTop: stop.top, stopBottom: stop.bottom, headTop: head.top, headBottom: head.bottom, threadH: document.getElementById('d-dmthread').clientHeight };
        });
        chk(swn.stopTop >= swn.headTop - 0.5 && swn.stopBottom <= swn.headBottom + 0.5 && swn.threadH >= 60, `${t} with notes showing too, Stop now stays visible and the thread keeps room`, JSON.stringify(swn));
        chk(serrs.length === 0, `${t} no page errors`, serrs.join(' | '));
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
