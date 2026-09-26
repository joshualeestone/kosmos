'use strict';

/**
 * #718 mobile (Josh, 2026-09-24: "make sure the designs fit well on mobile"): the
 * "waiting on you" controls on a PHONE, rendered from the real page functions.
 *
 * (a) The Allow card (#askcard, a phone asking to use this Kosmos) has NO solid left bar
 *     (Josh: no left accent bar on cards, whatever the colour): its left border is the same
 *     1px as its top, in the gold edge. On a touchscreen its buttons are at least 44px tall.
 * (b) "Answer" on a needs-you card: on a touchscreen its ::after hit area extends it
 *     (inset -8px -6px), and with a mouse there is none.
 * (c) The landing: an arrival (a push tap or Answer) on a phone scrolls the Direct Message
 *     section to the top of the screen; in a wide window it does not move the page.
 * (d) The hold, with real timers: late content above the conversation is put back.
 * (e) End to end from a page load of ?tab=detail&agent=<name>, as a push tap arrives: a
 *     present agent lands on its conversation; a missing one goes to the board home.
 *
 * Touch is a Chromium mobile context (hasTouch + isMobile), which is what makes the page's
 * `(hover: none)` rules apply. Chromium only: no committed check covers WebKit here.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-waiting-phone-718.js
 */
const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-waiting-phone-718: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const BASE = require('./fixtures/agent-card.json');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

async function open(browser, opts) {
  const page = await browser.newPage(opts);
  await page.addInitScript(() => {
    window.__realSetInterval = window.setInterval.bind(window);   // the hold arm needs real timers
    window.setInterval = () => 0;                                  // the app's polls stay off
    window.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await page.goto(PAGE);
  await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.remove(); });
  return page;
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-waiting-phone-718: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  try {
    const phone = await open(browser, { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
    // (a) the Allow card, painted by the real paintAsk from one asking phone
    const ask = await phone.evaluate(() => {
      if (typeof paintAsk !== 'function' || typeof ASK !== 'object') return { error: 'paintAsk/ASK missing (renamed? re-anchor this check)' };
      ASK.email = 'her@example.com';
      ASK.devices = [{ device_id: 'phone1', name: 'iPhone', code: '482915', first_seen: Math.floor(Date.now() / 1000) - 60 }];
      paintAsk();
      const c = document.getElementById('askcard');
      if (!c || c.hidden) return { error: 'the Allow card did not show' };
      c.scrollIntoView();
      const cs = getComputedStyle(c);
      const btns = [...c.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0);
      return { left: cs.borderLeftWidth, top: cs.borderTopWidth, leftColor: cs.borderLeftColor, topColor: cs.borderTopColor,
        hoverNone: matchMedia('(hover: none)').matches,
        buttons: btns.map((b) => ({ t: b.textContent.trim().slice(0, 16), h: Math.round(b.getBoundingClientRect().height) })) };
    });
    if (ask.error) chk(false, '[allow] ' + ask.error);
    else {
      chk(ask.left === ask.top && ask.leftColor === ask.topColor, '[allow] no left accent bar: the left border is the top border', `left=${ask.left} ${ask.leftColor} top=${ask.top} ${ask.topColor}`);
      // #3829 addendum (Josh 20:00): off Kosmos Plus the top card is a one-line notice with Review; its button is thumb-size too.
      chk(ask.hoverNone && ask.buttons.length >= 1 && ask.buttons.every((b) => b.h >= 44), '[allow/touch] the notice\'s button is at least 44px tall', JSON.stringify(ask.buttons));
      // On Kosmos Plus the full cards sit above the panel; their Allow and Deny keep the 44px (#718).
      const inPanel = await phone.evaluate(() => {
        // This fixture is not enrolled, so show the connected panel the in-panel slot sits above.
        showTab('settings'); settingsGo('plus');
        const flow = document.getElementById('plus-flow'); const was = flow.hidden; flow.hidden = false; paintAsk();
        const box = document.getElementById('plus-asks');
        const got = (!box || box.hidden) ? { error: 'the request did not show above the Kosmos Plus panel' }
          : [...box.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => ({ t: b.textContent.trim().slice(0, 16), h: Math.round(b.getBoundingClientRect().height) }));
        flow.hidden = was; paintAsk();
        return got;
      });
      chk(Array.isArray(inPanel) && inPanel.length >= 2 && inPanel.every((b) => b.h >= 44), '[allow/touch] every Allow / Deny above the Kosmos Plus panel is at least 44px tall', JSON.stringify(inPanel));
      // Review (#3829): with the connected panel NOT showing (not enrolled, or mid sign-in) there is nothing to sit
      // above, so the full cards stay in the top card and the in-panel slot is empty.
      const noFlow = await phone.evaluate(() => {
        const flow = document.getElementById('plus-flow');
        const was = flow.hidden; flow.hidden = true; paintAsk();
        const out = { panel: document.getElementById('plus-asks').hidden, card: document.getElementById('askcard').hidden,
          allow: [...document.querySelectorAll('#ask-rows button[data-ask="allow"]')].length,
          slot: document.getElementById('plus-ask-rows').children.length };
        flow.hidden = was; paintAsk();
        return out;
      });
      chk(noFlow.panel && !noFlow.card && noFlow.allow >= 1 && noFlow.slot === 0, '[allow/place] with no connected panel showing, the full cards stay in the top card', JSON.stringify(noFlow));
    }
    // (b) Answer's hit area, on a real needs-you card
    const ans = async (page) => page.evaluate((base) => {
      if (typeof card !== 'function') return { error: 'card missing' };
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML = card(Object.assign({}, base, { sessionName: 'april', name: 'April', isNamedOurs: true, paneless: false,
        state: 'needs_you', stateReported: true, stateReportedBy: 'agent', because: 'Which venue?' }));
      const b = host.querySelector('.ansgo');
      if (!b) return { error: 'no Answer button on a needs-you card' };
      const a = getComputedStyle(b, '::after');
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      // A real hit test just above the pill's text: the extended area must catch it on touch.
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top - 5);
      return { content: a.content, top: a.top, left: a.left, hitAbove: !!(hit && hit.closest && hit.closest('.ansgo')) };
    }, BASE);
    const a1 = await ans(phone);
    chk(!a1.error && a1.content === '""' && a1.top === '-8px' && a1.left === '-6px', '[answer/touch] Answer has an extended hit area on a touchscreen', JSON.stringify(a1));
    chk(!a1.error && a1.hitAbove === true, '[answer/touch] a tap 5px above the Answer text still lands on Answer', JSON.stringify(a1));
    // (c) the landing: reveal on a phone scrolls the conversation to the top
    const land = async (page) => page.evaluate(() => {
      if (typeof detailRevealTalkOnPhone !== 'function' || typeof showTab !== 'function') return { error: 'reveal/showTab missing' };
      showTab('detail');
      const talk = document.getElementById('d-sec-talk');
      if (!talk) return { error: 'no #d-sec-talk' };
      talk.hidden = false;
      document.body.style.minHeight = '4000px';   // enough page to scroll in the bare static page
      window.scrollTo(0, 0);
      const before = Math.round(talk.getBoundingClientRect().top);
      // Count the reveal's scroll requests: a wide layout has nothing to scroll, so only the
      // count can show whether the reveal tried (a position check there cannot fail).
      let asked = 0;
      const real = talk.scrollIntoView.bind(talk);
      talk.scrollIntoView = (o) => { asked += 1; return real(o); };
      detailRevealTalkOnPhone();
      return { before, after: Math.round(talk.getBoundingClientRect().top), scrollY: Math.round(window.scrollY), asked };
    });
    const l1 = await land(phone);
    chk(!l1.error && l1.asked >= 1 && l1.before > 5 && Math.abs(l1.after) <= 2, '[landing/phone] an arrival scrolls the Direct Message section to the top', JSON.stringify(l1));
    // The hold, with REAL timers: content painted above the conversation after the reveal (the
    // Files list arriving late) pushes it down; the hold puts it back. Chromium's scroll
    // anchoring would compensate by itself (measured: the section did not move), so anchoring is
    // turned OFF here to stand in for an engine without it (Safari), which is what the hold is for.
    const hold = await phone.evaluate(() => new Promise((res) => {
      window.setInterval = window.__realSetInterval;
      document.documentElement.style.overflowAnchor = 'none'; document.body.style.overflowAnchor = 'none';
      const talk = document.getElementById('d-sec-talk');
      window.scrollTo(0, 0);
      detailRevealTalkOnPhone();
      const pushed = document.createElement('div'); pushed.style.height = '300px';
      talk.parentElement.insertBefore(pushed, talk);   // late content above it
      const right = Math.round(talk.getBoundingClientRect().top);
      setTimeout(() => res({ rightAfterPush: right, settled: Math.round(talk.getBoundingClientRect().top) }), 500);
    }));
    chk(Math.abs(hold.rightAfterPush) > 50 && Math.abs(hold.settled) <= 2, '[landing/phone] the hold puts the conversation back when late content pushes it down', JSON.stringify(hold));
    await phone.close();

    // (e) END TO END from a page load, as a push tap arrives: ?tab=detail&agent=<name> on a phone,
    // with /api/status stubbed and the page's own timers REAL, through tick -> settleWantAgent ->
    // openDetail -> the reveal. Present: it lands on the conversation. Missing: after the grace
    // it goes to the board home and the address loses the link.
    const fromLink = async (agents, waitMs) => {
      const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
      await page.addInitScript((list) => {
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        window.fetch = async (u) => (String(u).indexOf('/api/status') !== -1 ? enc({ agents: list, counts: {}, checkedAt: Date.now() }) : enc({}));
      }, agents);
      await page.goto(PAGE + '?tab=detail&agent=' + encodeURIComponent(BASE.sessionName));
      await page.evaluate(() => { const fr = document.getElementById('firstrun'); if (fr) fr.remove(); });
      await page.waitForTimeout(waitMs);
      const r = await page.evaluate(() => {
        const panel = document.getElementById('panel-detail'); const talk = document.getElementById('d-sec-talk');
        const box = document.getElementById('d-talk-box');
        return { detailShown: !!(panel && !panel.hidden && panel.offsetParent), tab: (typeof URL_TAB !== 'undefined') ? URL_TAB : null,
          current: (typeof CURRENT !== 'undefined' && CURRENT) ? CURRENT.sessionName : null,
          talkTop: talk ? Math.round(talk.getBoundingClientRect().top) : null, scrollY: Math.round(window.scrollY),
          docH: document.documentElement.scrollHeight, vh: window.innerHeight,
          boxBottom: box ? Math.round(box.getBoundingClientRect().bottom) : null,
          boxW: box ? Math.round(box.getBoundingClientRect().width) : 0, boxH: box ? Math.round(box.getBoundingClientRect().height) : 0,
          talkShown: !!(talk && !talk.hidden) };
      });
      await page.close();
      return r;
    };
    const present = await fromLink([BASE], 2000);
    // In the top quarter of the screen, not exactly 0: a short page scrolls only as far as it goes
    // (measured: scrollY at its maximum left the section 24px down, fully in view).
    // Two shapes land on the conversation: the page scrolled so Talk is in the top quarter, or the
    // chat-first phone layout (#718, mobile-chatfirst-718), where the page is exactly the screen and
    // the whole talk box is already on it without scrolling.
    const scrolledTo = present.scrollY > 0 && present.talkTop >= 0 && present.talkTop <= 667 / 4;
    // A hidden or collapsed box has an all-zero rect, which would pass the edge tests (Kano), so it
    // must have a real size too.
    const wholeScreen = present.talkShown && present.docH <= present.vh + 1 && present.talkTop >= 0 && present.boxW > 0 && present.boxH > 0
      && present.boxBottom !== null && present.boxBottom <= present.vh + 1;
    chk(present.detailShown && present.current === BASE.sessionName && (scrolledTo || wholeScreen),
      '[link/phone] a page load with ?tab=detail&agent= lands on that agent\'s conversation', JSON.stringify(present));
    const missing = await fromLink([], 11000);
    // The board home is the agents tab. (The address loses agent= at boot anyway, before the
    // settle runs, so checking the address here could not fail; it is not asserted.)
    chk(!missing.detailShown && missing.current === null && missing.tab === 'agents',
      '[link/phone] a link to an agent not on the board goes to the board home', JSON.stringify(missing));

    const wide = await open(browser, { viewport: { width: 1200, height: 900 } });
    const a2 = await ans(wide);
    chk(!a2.error && (a2.content === 'none' || a2.content === 'normal'), '[answer/mouse] no extended hit area with a mouse', JSON.stringify(a2));
    chk(!a2.error && a2.hitAbove === false, '[answer/mouse] with a mouse, 5px above the text is not Answer', JSON.stringify(a2));
    const l2 = await land(wide);
    chk(!l2.error && l2.asked === 0 && l2.after === l2.before, '[landing/wide] in a wide window the reveal does not scroll at all', JSON.stringify(l2));
    await wide.close();
  } finally {
    await browser.close();
  }
  console.log(fail.length ? `render-waiting-phone-718: ${fail.length} FAILED` : 'render-waiting-phone-718: all passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-waiting-phone-718:', e && e.stack); process.exit(1); });
