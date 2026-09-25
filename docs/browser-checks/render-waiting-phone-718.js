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
 *
 * Touch is a Chromium mobile context (hasTouch + isMobile), which is what makes the page's
 * `(hover: none)` rules apply. Chromium only: WebKit is exercised by the ad hoc phone audit.
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
      chk(ask.hoverNone && ask.buttons.length >= 2 && ask.buttons.every((b) => b.h >= 44), '[allow/touch] every Allow button is at least 44px tall', JSON.stringify(ask.buttons));
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
    chk(!l1.error && l1.asked >= 1 && l1.before > 5 && Math.abs(l1.after) <= 2, '[landing/phone] an arrival scrolls the Direct Message section to the top', JSON.stringify(l1));
    await phone.close();

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
