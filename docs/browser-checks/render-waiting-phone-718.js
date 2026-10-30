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
      // On Kosmos Plus the full cards sit above the panel; their Allow and Not me keep the 44px (#718).
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
      chk(Array.isArray(inPanel) && inPanel.length >= 2 && inPanel.every((b) => b.h >= 44), '[allow/touch] every Allow / Not me above the Kosmos Plus panel is at least 44px tall', JSON.stringify(inPanel));
      // #4610 (Josh, 12:50) reverses #3829's review rule here: with the connected panel NOT showing (not enrolled, or mid
      // sign-in) the requests still render in the Kosmos Plus section, never spread across the top of the window.
      const noFlow = await phone.evaluate(() => {
        const flow = document.getElementById('plus-flow');
        const was = flow.hidden; flow.hidden = true; paintAsk();
        const out = { panel: document.getElementById('plus-asks').hidden, card: document.getElementById('askcard').hidden,
          allow: [...document.querySelectorAll('#ask-rows button[data-ask="allow"]')].length,
          slot: document.getElementById('plus-ask-rows').children.length };
        flow.hidden = was; paintAsk();
        return out;
      });
      chk(!noFlow.panel && noFlow.card && noFlow.allow === 0 && noFlow.slot >= 1, '[allow/place] #4610: with no connected panel showing, the requests are still in the Kosmos Plus section, not the top card', JSON.stringify(noFlow));
    }
    // (b) #6400: a needs-you card's pill says only Issue, and the card itself is the answer target, so a tap anywhere
    //     on it (the pill included) reaches the question. Measured on a real card, by a real hit test on the pill.
    const ans = async (page) => page.evaluate((base) => {
      if (typeof card !== 'function') return { error: 'card missing' };
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML = card(Object.assign({}, base, { sessionName: 'april', name: 'April', isNamedOurs: true, paneless: false,
        state: 'needs_you', stateReported: true, stateReportedBy: 'agent', because: 'Which venue?' }));
      const c = host.querySelector('.acard');
      const pill = host.querySelector('.astate');
      if (!c || !pill) return { error: 'no needs-you card or pill' };
      pill.scrollIntoView({ block: 'center' });
      const r = pill.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const out = { link: !!host.querySelector('.ansgo'), route: c.getAttribute('data-answer'),
        pillTap: !!(hit && hit.closest && hit.closest('[data-answer]') === c), pillWords: pill.textContent.trim() };
      host.remove();
      return out;
    }, BASE);
    const a1 = await ans(phone);
    chk(!a1.error && a1.link === false && a1.route === 'april', '[answer/touch] the pill has no Answer link and the card carries the answer route (#6400)', JSON.stringify(a1));
    chk(!a1.error && a1.pillTap === true, '[answer/touch] a tap on the pill reaches the answer route', JSON.stringify(a1));
    // (b2) #6398 (Josh 2026-10-17): a rate-limited card says only "Rate Limit" in its pill, with no sentence under it;
    //      the sentence (how long, what to do) is the pill's hover text. Stuck past the threshold, the long one.
    const rl = await phone.evaluate((base) => {
      if (typeof card !== 'function') return { error: 'card missing' };
      const host = document.createElement('div'); document.body.appendChild(host);
      host.innerHTML = card(Object.assign({}, base, { sessionName: 'april', name: 'April', isNamedOurs: true, paneless: false,
        state: 'rate_limited', stateReported: true, stateConfidence: 'structured',
        stuckError: { stuck: true, state: 'rate_limited', forMs: 45 * 60000 } }));
      const c = host.querySelector('.acard'), pill = c && c.querySelector('.astate'), task = c && c.querySelector('.atask');
      // What is DRAWN: the card's text without its visually hidden parts (.vh carries the sentence for a screen reader).
      const seen = c ? c.cloneNode(true) : null; if (seen) seen.querySelectorAll('.vh').forEach((e) => e.remove());
      const out = c ? { words: (pill.querySelector('b') || pill).textContent.trim(), task: task ? task.textContent.trim() : null, title: pill.getAttribute('title') || '',
        text: seen.textContent, sr: [...pill.querySelectorAll('.vh')].map((e) => e.textContent).join(' ') } : { error: 'no card' };
      host.remove();
      return out;
    }, BASE);
    chk(!rl.error && rl.words === 'Rate Limit' && rl.task === '', '[rate limit] the pill reads Rate Limit and the card carries no sentence', JSON.stringify(rl));
    chk(!rl.error && /about 45 minutes/.test(rl.title) && !/paused by a rate limit/.test(rl.text), '[rate limit] the sentence is the pill\'s hover text, not drawn card text', JSON.stringify(rl));
    chk(!rl.error && /about 45 minutes/.test(rl.sr), '[rate limit] a screen reader still hears the sentence, in the pill', JSON.stringify(rl));
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
    // #7280 review 1: `files` makes the agent's Files list (painted above every section) arrive 600 ms late with 8 rows,
    // the drift the landing's hold exists for.
    const fromLink = async (agents, waitMs, extra, files) => {
      const page = await browser.newPage({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
      await page.addInitScript(([list, files]) => {
        const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
        const rows = Array.from({ length: 8 }, (_, i) => ({ name: 'notes-' + (i + 1) + '.md', modified: Date.now() - i * 60000, size: 1200 }));
        // Chromium anchors scrolling and absorbs content growing above; WebKit (Safari, the iPhone) does not, which is why
        // the hold exists. With the late list, anchoring is off so this measures what Safari would see.
        if (files) document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '* { overflow-anchor: none !important; }'; document.head.appendChild(st); });
        window.fetch = async (u) => {
          if (String(u).indexOf('/api/status') !== -1) return enc({ agents: list, counts: {}, checkedAt: Date.now() });
          if (files && /\/api\/agent\/[^/]+\/files/.test(String(u))) { await new Promise((r) => setTimeout(r, 600)); return enc({ ok: true, stamp: 'late-7280', files: rows }); }
          return enc({});
        };
      }, [agents, !!files]);
      await page.goto(PAGE + '?tab=detail&agent=' + encodeURIComponent(BASE.sessionName) + (extra || ''));
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
          talkShown: !!(talk && !talk.hidden),
          // #7280: AI Settings (d-sec-model) shown, and where it sits on the screen.
          modelShown: !!(document.getElementById('d-sec-model') && !document.getElementById('d-sec-model').hidden),
          modelTop: document.getElementById('d-sec-model') ? Math.round(document.getElementById('d-sec-model').getBoundingClientRect().top) : null,
          fileRows: document.querySelectorAll('#d-files-list > *').length,
          // Where a scroll lands under the app header on a phone (html scroll-padding-top): the section's correct top.
          landing: Math.round(parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0),
          filesShown: !!(document.getElementById('d-files') && !document.getElementById('d-files').hidden) };
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
    // #7280: the link may name a section. &sec=model opens AI Settings (not the conversation), on screen; an unknown
    // section lands on the conversation as before. A main without the change lands &sec=model on the conversation,
    // which the first arm reads as a failure (measured against origin/main when this was written).
    const toModel = await fromLink([BASE], 2000, '&sec=model');
    chk(toModel.detailShown && toModel.current === BASE.sessionName && toModel.modelShown && !toModel.talkShown
      && toModel.modelTop !== null && toModel.modelTop >= 0 && toModel.modelTop < 667,
      '[link/phone] ?tab=detail&agent=&sec=model opens that agent\'s AI Settings, on screen', JSON.stringify(toModel));
    // Review 1: with the Files list landing late above it (scroll anchoring off, as on Safari), AI Settings is put back
    // where a scroll lands, under the app header (scroll-padding-top, 187px at this width), not left pushed down. The
    // stimulus must have fired (8 rows painted) or the arm proves nothing; the control with the hold replaced by a
    // one-shot scroll must fail it.
    const toModelFiles = await fromLink([BASE], 3000, '&sec=model', true);
    if (!(toModelFiles.filesShown && toModelFiles.fileRows >= 8)) chk(false, '[link/phone] the late Files list really painted above AI Settings', JSON.stringify(toModelFiles));
    else chk(toModelFiles.modelShown && toModelFiles.modelTop !== null && Math.abs(toModelFiles.modelTop - toModelFiles.landing) <= 2,
      '[link/phone] &sec=model stays where it landed when the Files list arrives late above it', JSON.stringify(toModelFiles));
    for (const sec of ['remove', 'term']) {
      const r = await fromLink([BASE], 2000, '&sec=' + sec);
      chk(r.detailShown && r.talkShown, '[link/phone] &sec=' + sec + ' is not a section a link opens: it lands on the conversation', JSON.stringify(r));
    }
    const toUnknown = await fromLink([BASE], 2000, '&sec=nonsense');
    chk(toUnknown.detailShown && toUnknown.current === BASE.sessionName && toUnknown.talkShown && !toUnknown.modelShown,
      '[link/phone] an unknown &sec= lands on the conversation as before', JSON.stringify(toUnknown));
    const missing = await fromLink([], 11000);
    // The board home is the agents tab. (The address loses agent= at boot anyway, before the
    // settle runs, so checking the address here could not fail; it is not asserted.)
    chk(!missing.detailShown && missing.current === null && missing.tab === 'agents',
      '[link/phone] a link to an agent not on the board goes to the board home', JSON.stringify(missing));

    const wide = await open(browser, { viewport: { width: 1200, height: 900 } });
    const a2 = await ans(wide);
    // #6400: with a mouse too, the pill carries no Answer link and a click on it reaches the card's answer route.
    chk(!a2.error && a2.link === false && a2.route === 'april' && a2.pillTap === true, '[answer/mouse] no Answer link, and a click on the pill answers', JSON.stringify(a2));
    const l2 = await land(wide);
    chk(!l2.error && l2.asked === 0 && l2.after === l2.before, '[landing/wide] in a wide window the reveal does not scroll at all', JSON.stringify(l2));
    await wide.close();
  } finally {
    await browser.close();
  }
  console.log(fail.length ? `render-waiting-phone-718: ${fail.length} FAILED` : 'render-waiting-phone-718: all passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error('FAIL  render-waiting-phone-718:', e && e.stack); process.exit(1); });
