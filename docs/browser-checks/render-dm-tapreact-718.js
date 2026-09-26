// Browser-check-surface: d-dmthread rxn-quick rxn-show rxn-below pjRxnTap pjRxnPlace pjRxnVisibleBand pjRxnClose RXN_SHOW_HOST rxnOpenRow
'use strict';

/**
 * #718 (Josh, 2026-09-24: "really flesh out all the native mobile apps"): TAP TO REACT in the
 * agent's Direct Message on a touchscreen. The DM's reactions (#3650) are the room's pills and
 * bar, which open on hover; a phone has no hover, so the bar could not be reached there. The
 * room's tap handler (#3809, Kano) now serves both threads. Measured on the REAL page, with
 * real taps in a touch context, at the four phone sizes:
 *   - a tap on the agent's message opens its bar, and every emoji in it takes its own tap
 *     (the topmost element at its centre is that emoji: not the next message, not the composer);
 *   - the bar is inside the thread and inside what is showing (never under the composer);
 *   - its targets are at least the room's 36px;
 *   - a second tap closes it, a tap on your own message opens nothing, a tap between messages
 *     closes it for good, a tap outside the thread (the text box) closes it;
 *   - a repaint of the thread keeps it on the same message, and opening another agent drops it
 *     (the new agent's thread starts empty, which closes it), and a repaint for another agent with
 *     the same messages still there does not bring it back (the per-agent scope);
 *   - the first message's bar opens below it and still takes every tap, and the tap's sticky hover
 *     does not keep a closed bar showing;
 *   - a message taller than the thread: the bar is pinned inside it, above the composer, and stays
 *     there as the thread scrolls the message's top away;
 *   - picking an emoji, from the bar or from the full list, reacts to THAT message (the react route
 *     gets its `at`), closes the bar and lets go of focus; a new message arriving keeps the bar;
 *   - with a mouse (1280, no touch) a click opens nothing and hover still shows the bar.
 * Not covered: a tap on a link or file card inside the open message leaves the bar open, as in the
 * room (a link keeps its own job); no arm drives it in the DM.
 *
 * Harness posture mirrors render-dm-phone-718.js: file://, fetch stubbed, the thread answered
 * from a fixture, the agent opened through openDetail. No board and no real conversation.
 * Touch is emulated (hasTouch); WebKit is an engine approximation, not Safari or WKWebView.
 * KOSMOS_PAGE=<path to an index.html> runs it against another build (the negative control on main).
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-tapreact-718.js
 *   ENGINES=chromium,webkit ... for both engines. The gate runs Chromium only.
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

/** The room's touch target for these small repeated controls (#3811), reused by the DM. */
const MIN_RXN_TAP_PX = 36;

const at = (i) => new Date(Date.now() - (60 - i) * 60e3).toISOString();
const FX = {
  messages: Array.from({ length: 14 }, (_, i) => (i % 2
    ? { at: at(i), text: 'message ' + i + ' from the person, long enough to take two lines on a phone', delivery: { state: 'placed' } }
    : { from: 'april', at: at(i), text: 'reply ' + i + ' from the agent', reactions: i === 12 ? [{ emoji: '👍', count: 1, mine: true }] : [] })),
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};
const PHONES = [[375, 667], [393, 852], [412, 915], [430, 932]];

async function open(browser, eng, w, h, touch) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.__reacts = [];
    window.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/thread/react')) { window.__reacts.push(JSON.parse((init && init.body) || '{}')); return enc({ reactions: [] }); }
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
    LAST = [{ sessionName: 'april', name: 'April', status: 'working', isNamedOurs: true, nameDerived: true },
      { sessionName: 'bruno', name: 'Bruno', status: 'working', isNamedOurs: true, nameDerived: true }];
    openDetail('april', 'talk');
  }, FX);
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForSelector('#d-dmthread .msg .rxns[data-at]', { state: 'attached' });
  return { ctx, page, errs };
}

/* Runs in the page: the open bar (if any) and what a thumb would hit at each of its buttons. */
function openBar(minTap) {
  const shown = [...document.querySelectorAll('#d-dmthread .msg.rxn-show')];
  const row = shown[0]; const q = row && row.querySelector('.rxn-quick');
  const thread = document.getElementById('d-dmthread');
  if (!q) return { shown: shown.length, hoverNone: matchMedia('(hover: none)').matches };
  const Q = q.getBoundingClientRect(); const T = thread.getBoundingClientRect();
  const bar = document.querySelector('#d-talk-box .dmbar');
  const composerTop = bar && bar.offsetParent ? bar.getBoundingClientRect().top : Infinity;
  const vv = window.visualViewport;
  const screenBottom = vv ? vv.offsetTop + vv.height : innerHeight;
  const buttons = [...q.querySelectorAll('button')];
  return {
    shown: shown.length, at: row.querySelector('.rxns').getAttribute('data-at'),
    hoverNone: matchMedia('(hover: none)').matches, op: getComputedStyle(q).opacity,
    hits: buttons.map((b) => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === b || b.contains(top); }),
    small: buttons.map((b) => b.getBoundingClientRect()).filter((r) => r.width < minTap - 0.5 || r.height < minTap - 0.5).length,
    inside: Q.left >= T.left - 0.5 && Q.right <= T.right + 0.5 && Q.top >= Math.max(T.top, 0) - 0.5 && Q.bottom <= Math.min(T.bottom, composerTop, screenBottom) + 0.5,
    rect: [Math.round(Q.left), Math.round(Q.top), Math.round(Q.right), Math.round(Q.bottom)], thread: [Math.round(T.left), Math.round(T.top), Math.round(T.right), Math.round(T.bottom)],
    composerTop: Math.round(composerTop),
  };
}

/* Runs in the page: rewrite the thread the way a poll's repaint does (fresh rows, nothing open). */
function repaint() {
  const t = document.getElementById('d-dmthread');
  const fresh = t.cloneNode(true);
  fresh.querySelectorAll('.msg').forEach((m) => m.classList.remove('rxn-show', 'rxn-below'));
  fresh.querySelectorAll('.rxn-quick').forEach((q) => q.removeAttribute('style'));
  t.innerHTML = fresh.innerHTML;
  return new Promise((res) => setTimeout(() => { const r = t.querySelector('.msg.rxn-show .rxns'); res(r ? r.getAttribute('data-at') : null); }, 60));
}

(async () => {
  const engines = (process.env.ENGINES || 'chromium').split(',');
  for (const eng of engines) {
    const browser = await pw[eng].launch({ headless: process.env.HEADED !== '1' });
    try {
      for (const [w, h] of PHONES) {
        const tag = `[${eng} ${w}x${h} touch]`;
        const { ctx, page, errs } = await open(browser, eng, w, h, true);
        // The agent's LAST reply (just above the composer) and one near the middle of the thread.
        const agentRows = page.locator('#d-dmthread .msg:not(.you) .msg-bd');
        const lastAgent = agentRows.last();
        const midAgent = agentRows.nth(3);
        await lastAgent.tap();
        // An emulated tap leaves the row :hover, which would show the bar by itself (the base
        // .msg:hover rule): move the pointer off it so what is measured is the tap's .rxn-show.
        await page.mouse.move(1, 1);
        await page.waitForTimeout(300);   // the bar fades in over .12s
        const first = await page.evaluate(openBar, MIN_RXN_TAP_PX);
        const wantAt = await page.evaluate(() => { const r = [...document.querySelectorAll('#d-dmthread .msg:not(.you)')].pop(); return r.querySelector('.rxns').getAttribute('data-at'); });
        chk(first.hoverNone && first.shown === 1 && first.op === '1' && first.at === wantAt, `${tag} a tap on the agent's message opens its reaction bar`, JSON.stringify({ shown: first.shown, op: first.op, hoverNone: first.hoverNone }));
        chk(first.hits && first.hits.length >= 4 && first.hits.every(Boolean), `${tag} every emoji in the open bar takes its own tap (nothing painted over it)`, JSON.stringify(first.hits));
        chk(first.inside === true, `${tag} the bar is inside the thread and above the composer`, JSON.stringify({ bar: first.rect, thread: first.thread, composerTop: first.composerTop }));
        chk(first.small === 0, `${tag} every target in the bar is at least ${MIN_RXN_TAP_PX}px`, `small=${first.small}`);
        const pill = await page.evaluate(() => { const p = document.querySelector('#d-dmthread .rxn'); return p ? Math.round(p.getBoundingClientRect().height) : null; });
        chk(pill !== null && pill >= MIN_RXN_TAP_PX - 0.5, `${tag} a reaction already on a message is a ${MIN_RXN_TAP_PX}px target`, `h=${pill}`);
        // The open state alone shows the bar: a row the pointer is NOT over (checked), marked open the
        // way a tap marks it, shows its bar. Measured apart from any tap, whose sticky hover would show
        // the bar by itself.
        const showRule = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#d-dmthread .msg:not(.you)')].filter((r) => !r.matches(':hover') && !r.classList.contains('rxn-show'));
          const r = rows[0]; if (!r) return { error: 'no unhovered agent row' };
          r.classList.add('rxn-still', 'rxn-show');   // rxn-still: no fade, so the value is read at once
          const op = getComputedStyle(r.querySelector('.rxn-quick')).opacity;
          r.classList.remove('rxn-still', 'rxn-show');
          return { hovered: r.matches(':hover'), op };
        });
        chk(!showRule.error && !showRule.hovered && showRule.op === '1', `${tag} the open state alone shows the bar (on a row the pointer is not over)`, JSON.stringify(showRule));
        // The first message at the top of the thread: no room above, so its bar opens BELOW it, where it
        // lies over the next message and must still take every tap (the open row is lifted).
        await lastAgent.tap(); await page.waitForTimeout(300);   // close the one above first
        await page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = 0; const f = t.querySelector('.msg:not(.you)'); f.scrollIntoView({ block: 'start' }); t.scrollTop = 0; });
        await page.waitForTimeout(200);
        await agentRows.first().tap(); await page.mouse.move(1, 1); await page.waitForTimeout(300);
        const low = await page.evaluate(() => { const r = document.querySelector('#d-dmthread .msg.rxn-show'); return r ? { below: r.classList.contains('rxn-below'), first: r === document.querySelector('#d-dmthread .msg:not(.you)') } : null; });
        const lowBar = await page.evaluate(openBar, MIN_RXN_TAP_PX);
        chk(low && low.first && low.below && lowBar.hits && lowBar.hits.length >= 4 && lowBar.hits.every(Boolean), `${tag} the first message's bar opens below it and every emoji still takes its own tap`, JSON.stringify(Object.assign({}, low, { hits: lowBar.hits })));
        await agentRows.first().tap(); await page.waitForTimeout(300);   // close it
        await lastAgent.scrollIntoViewIfNeeded(); await lastAgent.tap(); await page.mouse.move(1, 1); await page.waitForTimeout(300);
        // A repaint keeps it on the same message.
        const afterRepaint = await page.evaluate(repaint);
        chk(afterRepaint === wantAt, `${tag} a repaint of the thread keeps the bar on the same message`, `after=${afterRepaint}`);
        // A real repaint (the page's own paintTalk, a new message arriving) keeps it on the same message.
        // The person's message, so the agent's last message (which the arms below tap) stays last.
        const realRepaint = await page.evaluate(async () => {
          window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.concat([{ at: new Date().toISOString(), text: 'a new message arrives', delivery: { state: 'placed' } }]) });
          await paintTalk('april', 'April');
          await new Promise((res) => setTimeout(res, 150));
          const r = document.querySelector('#d-dmthread .msg.rxn-show .rxns');
          return { rows: document.querySelectorAll('#d-dmthread .msg').length, open: r ? r.getAttribute('data-at') : null };
        });
        chk(realRepaint.open === wantAt && realRepaint.rows > 14, `${tag} a new message arriving (the page's own repaint) keeps the bar on the same message`, JSON.stringify(realRepaint));
        // A second tap closes it.
        await lastAgent.tap(); await page.waitForTimeout(300);
        const closed = await page.evaluate(openBar, MIN_RXN_TAP_PX);
        // The row keeps the tap's sticky :hover (checked, or this proves nothing): the bar must still be hidden.
        const sticky = await page.evaluate(() => { const r = [...document.querySelectorAll('#d-dmthread .msg:not(.you)')].pop(); return { hover: r.matches(':hover'), op: getComputedStyle(r.querySelector('.rxn-quick')).opacity }; });
        chk(closed.shown === 0 && sticky.hover && sticky.op === '0', `${tag} a second tap closes it, and the tap's sticky hover does not keep it showing`, JSON.stringify(Object.assign({ shown: closed.shown }, sticky)));
        // A tap on your own message opens nothing (only the agent's messages take reactions), and
        // closes a bar open on another message. Precondition: one is open right before.
        await midAgent.tap(); await page.waitForTimeout(300);
        const before = (await page.evaluate(openBar, MIN_RXN_TAP_PX)).shown;
        await page.locator('#d-dmthread .msg.you .msg-bd').nth(2).tap(); await page.waitForTimeout(300);
        const own = await page.evaluate(openBar, MIN_RXN_TAP_PX);
        chk(before === 1 && own.shown === 0, `${tag} a tap on your own message opens nothing and closes the open bar`, JSON.stringify({ before, after: own.shown }));
        // A tap outside the thread (the text box) closes it.
        await lastAgent.tap(); await page.waitForTimeout(300);
        const beforeOut = (await page.evaluate(openBar, MIN_RXN_TAP_PX)).shown;
        await page.locator('#d-say').tap(); await page.waitForTimeout(300);
        const out = await page.evaluate(openBar, MIN_RXN_TAP_PX);
        chk(beforeOut === 1 && out.shown === 0, `${tag} a tap on the text box closes the open bar`, JSON.stringify({ before: beforeOut, after: out.shown }));
        await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        await page.waitForTimeout(200);
        // A tap BETWEEN messages closes it for good: a repaint after it does not bring it back.
        await lastAgent.tap(); await page.waitForTimeout(300);
        // Thread space that is not a message: the rows fill the thread edge to edge, and a tap near
        // a row lands on it (Chromium's mobile emulation), so the check adds a plain 96px gap just
        // above the open message (below it, the last message's gap falls under the sticky composer on
        // an SE), taps 16px into its top (the open bar sits over its lower part), and requires the tap to
        // land in the thread outside every message.
        const gap = await page.evaluate(() => {
          const t = document.getElementById('d-dmthread');
          const opened = t.querySelectorAll('.msg.rxn-show').length;
          const open = t.querySelector('.msg.rxn-show');
          if (!open) return { opened, error: 'no open bar' };
          const g = document.createElement('div'); g.className = 'arm-gap'; g.style.cssText = 'display: block !important; height: 96px !important; min-height: 96px !important; flex: 0 0 96px !important;'; g.textContent = '\u00a0';
          open.before(g);
          const r = g.getBoundingClientRect();
          return { opened, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 16), h: Math.round(r.height) };
        });
        await page.waitForTimeout(100);
        // Precondition: the tap really landed in the thread and outside every message.
        await page.evaluate(() => { window.__tapHit = null; document.addEventListener('click', (ev) => { const el = ev.target; window.__tapHit = { inThread: !!el.closest('#d-dmthread'), inMessage: !!el.closest('.msg') }; }, { capture: true, once: true }); });
        if (!gap.error) await page.touchscreen.tap(gap.x, gap.y);
        await page.waitForTimeout(200);
        gap.hit = await page.evaluate(() => { const g = document.querySelector('#d-dmthread .arm-gap'); if (g) g.remove(); return window.__tapHit; });
        const afterGap = await page.evaluate(repaint);
        chk(!gap.error && gap.h === 96 && gap.hit && gap.hit.inThread && !gap.hit.inMessage && gap.opened === 1 && afterGap === null, `${tag} a tap between messages closes the bar for good`, JSON.stringify(Object.assign({ afterGap }, gap)));
        // Picking an emoji reacts to THAT message, closes the bar and lets go of focus (Android keeps it).
        await lastAgent.tap(); await page.waitForTimeout(300);
        const picked = await page.evaluate(() => new Promise((res) => {
          const b = document.querySelector('#d-dmthread .msg.rxn-show .rxn-pick');
          if (!b) return res({ error: 'no open bar' });
          const rowAt = b.closest('.rxns').getAttribute('data-at');
          b.focus(); const focusedFirst = document.activeElement === b;
          b.click();
          setTimeout(() => res({ focusedFirst, rowAt, sent: window.__reacts.map((r) => r.at),
            shown: document.querySelectorAll('#d-dmthread .msg.rxn-show').length,
            focusInBar: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.rxn-quick')) }), 300);
        }));
        chk(!picked.error && picked.focusedFirst && picked.sent.length === 1 && picked.sent[0] === picked.rowAt && picked.shown === 0 && !picked.focusInBar,
          `${tag} picking an emoji reacts to that message, closes the bar and lets go of focus`, JSON.stringify(picked));
        // The full emoji list, opened from a tapped bar: a pick reacts to that message and closes the bar too.
        await lastAgent.tap(); await page.mouse.move(1, 1); await page.waitForTimeout(300);
        const beforeMore = await page.evaluate(() => { window.__reacts = []; const r = document.querySelector('#d-dmthread .msg.rxn-show'); return r ? r.querySelector('.rxns').getAttribute('data-at') : null; });
        if (beforeMore) await page.locator('#d-dmthread .msg.rxn-show .rxn-more').tap();   // no bar (main): a clean FAIL below
        await page.waitForTimeout(200);
        const pickerOpen = await page.evaluate(() => { const p = document.getElementById('rxn-picker'); return !!(p && !p.hidden); });
        if (pickerOpen) await page.locator('#rxn-picker .rxn-pick').first().tap();
        await page.waitForTimeout(300);
        const fromList = await page.evaluate(() => ({ sent: window.__reacts.map((r) => r.at), shown: document.querySelectorAll('#d-dmthread .msg.rxn-show').length, picker: !!(document.getElementById('rxn-picker') && !document.getElementById('rxn-picker').hidden) }));
        chk(beforeMore && pickerOpen && fromList.sent.length === 1 && fromList.sent[0] === beforeMore && fromList.shown === 0 && !fromList.picker,
          `${tag} a pick from the full emoji list reacts to that message and closes the bar`, JSON.stringify(Object.assign({ beforeMore, pickerOpen }, fromList)));
        // The agent changing under an open bar, with its thread NOT emptied first: only the per-agent
        // scope (RXN_SHOW_PID against CURRENT.sessionName) can tell, since the same `at`s are still there.
        await lastAgent.tap(); await page.mouse.move(1, 1); await page.waitForTimeout(300);
        const scoped = await page.evaluate(async () => {
          const before = document.querySelectorAll('#d-dmthread .msg.rxn-show').length;
          const was = CURRENT; CURRENT = Object.assign({}, CURRENT, { sessionName: 'bruno' });
          const t = document.getElementById('d-dmthread'); const fresh = t.cloneNode(true);
          fresh.querySelectorAll('.msg').forEach((m) => m.classList.remove('rxn-show', 'rxn-below')); t.innerHTML = fresh.innerHTML;
          await new Promise((res) => setTimeout(res, 60));
          const after = document.querySelectorAll('#d-dmthread .msg.rxn-show').length;
          CURRENT = was;
          return { before, after };
        });
        chk(scoped.before === 1 && scoped.after === 0, `${tag} a repaint for another agent does not bring the bar back, even when the same messages are there`, JSON.stringify(scoped));
        // Opening another agent's DM drops the bar: `at` values repeat across agents.
        await lastAgent.tap(); await page.waitForTimeout(300);
        const beforeSwitch = (await page.evaluate(openBar, MIN_RXN_TAP_PX)).shown;
        await page.evaluate(() => { openDetail('bruno', 'talk'); return paintTalk('bruno', 'Bruno'); });
        await page.waitForTimeout(300);
        const afterSwitch = await page.evaluate(() => ({ shown: document.querySelectorAll('#d-dmthread .msg.rxn-show').length, current: CURRENT && CURRENT.sessionName }));
        chk(beforeSwitch === 1 && afterSwitch.current === 'bruno' && afterSwitch.shown === 0, `${tag} opening another agent drops the open bar`, JSON.stringify(Object.assign({ beforeSwitch }, afterSwitch)));
        // A message taller than the thread: the tapped bar is pinned inside what shows, and stays there,
        // under the header and above the sticky composer, as the thread scrolls the message's top away.
        await page.evaluate(() => { const r = document.querySelector('#d-dmthread .msg.rxn-show'); if (r) pjRxnClose(); });
        const tallAt = await page.evaluate(async () => {
          const at = new Date(Date.now() - 1000).toISOString();
          window.__fx = Object.assign({}, window.__fx, { messages: window.__fx.messages.concat([{ from: 'april', at, text: 'TALL ' + 'a long line of text that wraps on a phone screen. '.repeat(90) }]) });
          openDetail('april', 'talk'); await paintTalk('april', 'April');
          await new Promise((res) => setTimeout(res, 150));
          return at;
        });
        const tallPos = await page.evaluate((at) => {
          const t = document.getElementById('d-dmthread'); const b = t.querySelector('.rxns[data-at="' + at + '"]'); if (!b) return { error: 'no tall row' };
          const row = b.closest('.msg'); const T = t.getBoundingClientRect();
          t.scrollTop += row.getBoundingClientRect().top - (T.top + 20);
          const R = row.getBoundingClientRect(); const bd = row.querySelector('.msg-bd').getBoundingClientRect();
          return { x: Math.round(bd.left + bd.width / 2), y: Math.round(R.top + 60), taller: R.height > T.height };
        }, tallAt);
        await page.waitForTimeout(150);
        if (!tallPos.error) { await page.touchscreen.tap(tallPos.x, tallPos.y); await page.mouse.move(1, 1); }
        await page.waitForTimeout(300);
        const inBand = () => page.evaluate(() => {
          const r = document.querySelector('#d-dmthread .msg.rxn-show'); const q = r && r.querySelector('.rxn-quick');
          if (!q) return { open: false };
          const t = document.getElementById('d-dmthread').getBoundingClientRect(); const Q = q.getBoundingClientRect();
          const bar = document.querySelector('#d-talk-box .dmbar'); const cTop = bar && bar.offsetParent ? bar.getBoundingClientRect().top : Infinity;
          return { open: true, pinned: RXN_PINNED, top: Math.round(Q.top), bottom: Math.round(Q.bottom), threadTop: Math.round(t.top), composerTop: Math.round(cTop),
            inside: Q.top >= t.top - 0.5 && Q.bottom <= Math.min(t.bottom, cTop) + 0.5 && Q.left >= t.left - 0.5 && Q.right <= t.right + 0.5 };
        });
        const atOpen = await inBand();
        await page.evaluate(() => { document.getElementById('d-dmthread').scrollTop += 200; });
        await page.waitForTimeout(250);
        const afterScroll = await inBand();
        const rowTopGone = await page.evaluate((at) => { const b = document.querySelector('#d-dmthread .rxns[data-at="' + at + '"]'); const t = document.getElementById('d-dmthread').getBoundingClientRect(); return b ? b.closest('.msg').getBoundingClientRect().top < t.top : null; }, tallAt);
        chk(!tallPos.error && tallPos.taller && atOpen.open && atOpen.pinned && atOpen.inside && rowTopGone && afterScroll.open && afterScroll.inside,
          `${tag} a message taller than the thread: its bar is pinned inside the thread, above the composer, and stays there as the thread scrolls`, JSON.stringify({ tallPos, atOpen, afterScroll, rowTopGone }));
        chk(errs.length === 0, `${tag} no page errors`, errs.join(' | '));
        await ctx.close();
      }
      // A mouse at 1280: a click opens nothing (the tap handler is touch-only); hover still shows the bar.
      {
        const { ctx, page, errs } = await open(browser, eng, 1280, 900, false);
        const row = page.locator('#d-dmthread .msg:not(.you) .msg-bd').last();
        await row.click(); await page.mouse.move(2, 2); await page.waitForTimeout(300);
        const clicked = await page.evaluate(() => document.querySelectorAll('#d-dmthread .msg.rxn-show').length);
        await row.hover(); await page.waitForTimeout(300);
        const hovered = await page.evaluate(() => { const q = [...document.querySelectorAll('#d-dmthread .msg:not(.you)')].pop().querySelector('.rxn-quick'); return getComputedStyle(q).opacity; });
        chk(clicked === 0 && hovered === '1', `[${eng} 1280x900 mouse] a click opens nothing and hover still shows the bar`, JSON.stringify({ clicked, hovered }));
        chk(errs.length === 0, `[${eng} 1280x900 mouse] no page errors`, errs.join(' | '));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
  console.log(fail.length ? `\n${fail.length} FAILED` : '\nALL PASS');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
