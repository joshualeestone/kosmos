// Browser-check-surface: d-reauth d-start-wrap d-start-agent dhead d-said d-instr-stale d-sec-talk d-swarm-panel d-swarm-stop d-dmthread linkish d-name d-task d-meta detail-state dnamerow
'use strict';

/**
 * #3892 (#3882's open risk 3; Liu Kang: "Sign in again must never hide"): on the phone chat the agent's
 * header is a capped block that scrolls on its own, and Sign in again comes last in its notes, after the
 * usage-limit quote. Measured on main, it sat below that block's fold at every phone size, with nothing
 * showing the block scrolls. On the REAL page, with every header note showing (a usage-limit quote, a
 * stale-instructions note, Sign in again, Start this agent), at 375x667, 393x852, 412x915 and 430x932 in
 * light and dark:
 *   - Sign in again is inside the header's visible block, on top (the element at its centre is the button)
 *     and at least 44px tall, with the block scrolled to its top and to its bottom;
 *   - Start this agent is inside the visible block and on top too (the pinned button does not cover it);
 *     a defensive arm: today Start shows for an agent that is off and a stopped sign-in counts as on, so
 *     the two never show together; the notes are shown by hand here for that reason;
 *   - with every note and (defensively) Start: on a phone larger than an SE the conversation keeps the
 *     height it has without Sign in again, measured in the same run; an SE gives up at most 32px (the
 *     152px floor for Start); for a swarm agent whose sign-in stopped the floor is 190px: an SE gives up at
 *     most 70px, larger phones at most 37px, and the composer and Post stay on screen (checked as painted);
 *   - a swarm agent (#3564) whose sign-in stopped: Stop now is on screen and not covered at the
 *     middle of any of its four edges, and Sign in again is on screen;
 *   - with Sign in again alone (no Start), the cap is unchanged;
 *   - through the page's own painter: an agent whose sign-in stopped (state auth_failed) gets Sign in again
 *     from paintDetail, on screen and tappable (the rules key on the hidden attribute the painter sets); and
 *     a SWARM agent whose sign-in stopped (the combination that really happens) keeps Stop now uncovered,
 *     and scrolling the header brings Stop now's whole warning into view above the pinned button;
 *     also with a long name and a wrapping task sentence (the name row stays one line in that state: the
 *     task sentence is not shown, the state badge is whole, the name ellipsizes);
 *   - at 800 and 1280 Sign in again is not pinned (position static): the desktop layout is unchanged.
 * Phones narrower than 375 (a 320px first iPhone SE) are not covered: 375 is the smallest size #718 targets.
 *
 * Harness posture as render-dm-chatfirst-718.js: file://, fetch stubbed, the agent opened through
 * openDetail, the notes shown the way paintDetail shows them (hidden off, text in). No board, no real
 * agent. WebKit is an engine approximation, not Safari. KOSMOS_PAGE=<index.html> runs it against
 * another build (the negative control on main).
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-signin-visible-3892.js
 *   ENGINES=chromium,webkit ... for both engines. The gate runs Chromium only.
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const fail = [];
const chk = (ok, label, extra) => {
  RAN += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

/** Apple's and Google's minimum comfortable tap target. */
const MIN_TAP_PX = 44;
/** What an iPhone SE may give up while two actions share the header: the CSS floor (152px) minus the SE's
 *  18% cap (120px). Change both together. */
const SE_BUDGET_PX = 152 - 120;
/** The same for a swarm agent, whose floor (190px) also fits Stop now's warning; larger phones give up at
 *  most 190 minus their own cap (153px at 393 wide): 37px. */
const SWARM_BUDGET_PX = 190 - 120;
const SWARM_BUDGET_LARGE_PX = 190 - 153;   // the 393x852 cap; 412 and 430 have larger caps, so this is a ceiling there
/** One line of the compact name row, with room for the badge's padding. */
const ONE_LINE_MAX_PX = 40;
/** How far the fade above the pinned button reaches (index.html: 10px offset + 8px blur - 2px spread). */
const FADE_PX = 16;
let RAN = 0;
const PHONES = [[375, 667], [393, 852], [412, 915], [430, 932]];

async function open(browser, eng, w, h, theme, card, swarms) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w < 700, isMobile: w < 700 && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url) => (String(url).includes('/thread') ? enc({ messages: [{ from: 'april', at: '2026-09-25T10:00:00Z', text: 'hi' }] }) : enc({}));
  });
  await page.goto(PAGE);
  await page.evaluate(([card, swarms]) => {
    if (swarms) SWARMS_ON = true;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    LAST = [Object.assign({ sessionName: 'april', name: 'April', status: 'working' }, card || {})];
    openDetail('april', 'talk');
  }, [card, swarms]);
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

/* Runs in the page: show the notes (all four, or without Start), then measure both actions in the header. */
function notesAndMeasure(opts) {
  const show = (id, text) => { const e = document.getElementById(id); e.hidden = false; if (text) e.textContent = text; };
  show('d-said-lab', 'Its last words');
  show('d-said', 'You have hit your usage limit. It resets at 5pm. Upgrade your plan to keep going, or wait for the reset and try again then.');
  show('d-instr-stale', 'These instructions changed since the agent last started. Restart it to use them.');
  if (opts.start) show('d-start-wrap'); else document.getElementById('d-start-wrap').hidden = true;
  if (opts.swarm) show('d-swarm-panel'); else document.getElementById('d-swarm-panel').hidden = true;
  // The same-run baseline: the conversation with every other note, before Sign in again shows.
  document.getElementById('d-reauth').hidden = true;
  const baseThreadH = Math.round(document.getElementById('d-dmthread').getBoundingClientRect().height);
  show('d-reauth');
  const head = document.querySelector('.dhead');
  const at = (scroll) => {
    head.scrollTop = scroll === 'top' ? 0 : head.scrollHeight;
    const H = head.getBoundingClientRect();
    const one = (id) => {
      const e = document.getElementById(id); const R = e.getBoundingClientRect();
      const top = document.elementFromPoint(R.left + R.width / 2, R.top + R.height / 2);
      return { inHead: R.height > 0 && R.top >= H.top - 0.5 && R.bottom <= H.bottom + 0.5, onTop: top === e || e.contains(top), h: Math.round(R.height) };
    };
    // Stop now: the middle of each of its four edges, not only the centre, must be on top (a pinned button
    // covering its bottom edge would still pass a centre test). Edge midpoints, not corners: the button is
    // rounded, and a point in a rounded corner hit-tests to its parent.
    const corners = (id) => {
      const e = document.getElementById(id); const R = e.getBoundingClientRect(); const cx = (R.left + R.right) / 2; const cy = (R.top + R.bottom) / 2;
      const pts = [[cx, R.top + 2], [cx, R.bottom - 2], [R.left + 2, cy], [R.right - 2, cy]];
      return { inHead: R.height > 0 && R.top >= H.top - 0.5 && R.bottom <= H.bottom + 0.5, allOnTop: pts.every(([x, y]) => { const t = document.elementFromPoint(x, y); return t === e || e.contains(t); }) };
    };
    return { reauth: one('d-reauth'), start: opts.start ? one('d-start-agent') : null, stop: opts.swarm ? corners('d-swarm-stop') : null };
  };
  const top = at('top'); const bottom = at('bottom'); head.scrollTop = 0;
  const T = document.getElementById('d-dmthread').getBoundingClientRect();
  return { baseThreadH, top, bottom, capPx: Math.round(parseFloat(getComputedStyle(head).maxHeight)), headH: Math.round(head.getBoundingClientRect().height),
    threadH: Math.round(T.height), position: getComputedStyle(document.getElementById('d-reauth')).position };
}

(async () => {
  for (const eng of (process.env.ENGINES || 'chromium').split(',')) {
    const browser = await pw[eng].launch({ headless: process.env.HEADED !== '1' });
    try {
      for (const [w, h] of PHONES) for (const theme of ['light', 'dark']) {
        const t = `[${eng} ${w}x${h} ${theme}]`;
        const { ctx, page, errs } = await open(browser, eng, w, h, theme);
        const m = await page.evaluate(notesAndMeasure, { start: true });
        // With the block scrolled to its end, the quote's last line ends clear of the fade above the button.
        const gap = await page.evaluate(() => {
          const head = document.querySelector('.dhead'); head.scrollTop = head.scrollHeight;
          const q = document.getElementById('d-said').getBoundingClientRect(); const b = document.getElementById('d-reauth').getBoundingClientRect();
          head.scrollTop = 0;
          return { quoteBottom: Math.round(q.bottom), buttonTop: Math.round(b.top), gap: Math.round(b.top - q.bottom) };
        });
        chk(gap.gap >= FADE_PX, `${t} scrolled to its end, the quote's last line is clear of the fade above Sign in again (${FADE_PX}px)`, JSON.stringify(gap));
        for (const where of ['top', 'bottom']) {
          const r = m[where].reauth;
          chk(r.inHead && r.onTop && r.h >= MIN_TAP_PX, `${t} with every note, Sign in again is on screen in the header and takes its own tap (block scrolled to its ${where})`, JSON.stringify(r));
        }
        // A keyboard reaches Sign in again with its whole focus ring visible: Tab (Option-Tab in WebKit) from Start this agent (a
        // real key, so :focus-visible applies), then the ring (outline box) must lie inside the header.
        await page.evaluate(() => { document.querySelector('.dhead').scrollTop = 0; document.getElementById('d-start-agent').focus(); });
        // WebKit, like Safari by default, moves Tab between text fields only; Option-Tab reaches buttons.
        await page.keyboard.press(eng === 'webkit' ? 'Alt+Tab' : 'Tab');
        const ring = await page.evaluate(() => {
          const e = document.activeElement; const head = document.querySelector('.dhead').getBoundingClientRect();
          if (!e || e.id !== 'd-reauth') return { error: 'Tab did not reach Sign in again', at: e && e.id };
          const c = getComputedStyle(e); const R = e.getBoundingClientRect();
          // The ring reaches this far past the button box; negative (drawn inside) with the fix, 4px without it.
          const out = (parseFloat(c.outlineOffset) || 0) + (parseFloat(c.outlineWidth) || 0);
          return { visible: e.matches(':focus-visible'), style: c.outlineStyle, out,
            inside: R.left - out >= head.left - 0.5 && R.right + out <= head.right + 0.5 && R.top - out >= head.top - 0.5 && R.bottom + out <= head.bottom + 0.5 };
        });
        chk(!ring.error && ring.visible && ring.style !== 'none' && ring.inside, `${t} Tab reaches Sign in again and its whole focus ring is inside the header`, JSON.stringify(ring));
        const s = m.top.start;
        chk(s.inHead && s.onTop, `${t} with every note, Start this agent is on screen in the header and not covered`, JSON.stringify(s));
        chk(w > 375 ? m.threadH >= m.baseThreadH : m.threadH >= m.baseThreadH - SE_BUDGET_PX, `${t} the conversation keeps its height without Sign in again (an SE gives up at most ${SE_BUDGET_PX}px)`, `threadH=${m.threadH} base=${m.baseThreadH}`);
        await page.evaluate(() => { document.querySelectorAll('#d-said-lab, #d-said, #d-instr-stale, #d-reauth, #d-start-wrap').forEach((e) => { e.hidden = true; }); });
        const plainCap = await page.evaluate(() => Math.round(parseFloat(getComputedStyle(document.querySelector('.dhead')).maxHeight)));
        const alone = await page.evaluate(notesAndMeasure, { start: false });
        chk(alone.top.reauth.inHead && alone.top.reauth.onTop && alone.bottom.reauth.inHead && alone.bottom.reauth.onTop && alone.capPx === plainCap, `${t} Sign in again alone (no Start) is on screen at the block's top and bottom and the header cap is unchanged`, JSON.stringify({ top: alone.top.reauth, bottom: alone.bottom.reauth, cap: alone.capPx, plainCap }));
        // A swarm agent whose sign-in stopped: Stop now (it acts at once) stays uncovered.
        const sw = await page.evaluate(notesAndMeasure, { start: false, swarm: true });
        chk(sw.top.stop.inHead && sw.top.stop.allOnTop && sw.top.reauth.inHead && sw.top.reauth.onTop && sw.top.reauth.h >= MIN_TAP_PX, `${t} a swarm agent with every note: Stop now is on screen and uncovered at every edge, and Sign in again is on screen at 44px`, JSON.stringify({ stop: sw.top.stop, reauth: sw.top.reauth }));
        chk(sw.threadH >= sw.baseThreadH - (w > 375 ? SWARM_BUDGET_LARGE_PX : SWARM_BUDGET_PX), `${t} a swarm agent whose sign-in stopped: the conversation gives up at most ${w > 375 ? SWARM_BUDGET_LARGE_PX : SWARM_BUDGET_PX}px (the header fits Stop now's warning)`, `threadH=${sw.threadH} base=${sw.baseThreadH}`);
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
        // Through the page's own painter, not by hand: an agent whose sign-in stopped (state auth_failed)
        // gets Sign in again from paintDetail, and it is on screen and takes its own tap. If the painter
        // ever stops using the hidden attribute, the :not([hidden]) rules stop applying and this arm fails.
        {
          const { ctx: c2, page: p2, errs: e2 } = await open(browser, eng, w, h, theme, { state: 'auth_failed' });
          const painted = await p2.evaluate(() => {
            const show = (id, text) => { const e = document.getElementById(id); e.hidden = false; if (text) e.textContent = text; };
            const shownByPainter = !document.getElementById('d-reauth').hidden;
            show('d-said-lab', 'Its last words');
            show('d-said', 'Please run /login. Your sign-in has expired. Sign in again to keep working, then try the last message again.');
            show('d-instr-stale', 'These instructions changed since the agent last started. Restart it to use them.');
            const head = document.querySelector('.dhead'); head.scrollTop = 0; const H = head.getBoundingClientRect();
            const e = document.getElementById('d-reauth'); const R = e.getBoundingClientRect();
            const top = document.elementFromPoint(R.left + R.width / 2, R.top + R.height / 2);
            return { shownByPainter, inHead: R.height > 0 && R.top >= H.top - 0.5 && R.bottom <= H.bottom + 0.5, onTop: top === e || e.contains(top), h: Math.round(R.height) };
          });
          chk(painted.shownByPainter && painted.inHead && painted.onTop && painted.h >= MIN_TAP_PX, `${t} an agent whose sign-in stopped (painted by the page): Sign in again is on screen and takes its own tap`, JSON.stringify(painted));
          chk(e2.length === 0, `${t} no page errors (painted by the page)`, e2.join(' | '));
          await c2.close();
        }
        // The combination that really happens, painted by the page: a swarm agent whose sign-in stopped.
        // swarmPagePaint shows the swarm panel whatever the state, paintDetail shows Sign in again.
        {
          const { ctx: c3, page: p3, errs: e3 } = await open(browser, eng, w, h, theme, { state: 'auth_failed', swarm: { active: true } }, true);
          const both = await p3.evaluate(() => {
            const byPainter = { swarm: !document.getElementById('d-swarm-panel').hidden, reauth: !document.getElementById('d-reauth').hidden };
            // Same-run baseline: the conversation with Sign in again hidden, then as painted.
            const re0 = document.getElementById('d-reauth'); re0.hidden = true;
            const baseThreadH = Math.round(document.getElementById('d-dmthread').getBoundingClientRect().height);
            re0.hidden = false;
            const threadH = Math.round(document.getElementById('d-dmthread').getBoundingClientRect().height);
            // The composer and Post stay on the visible screen (the "not answering" banner is up in this harness too).
            const vis = window.visualViewport ? window.visualViewport.height : innerHeight;
            const say = document.getElementById('d-say').getBoundingClientRect(); const send = document.getElementById('d-send').getBoundingClientRect();
            const composer = { sayBottom: Math.round(say.bottom), sendBottom: Math.round(send.bottom), vis: Math.round(vis), onScreen: say.height > 0 && say.bottom <= vis + 0.5 && send.bottom <= vis + 0.5 };
            const head = document.querySelector('.dhead'); head.scrollTop = 0; const H = head.getBoundingClientRect();
            const hitAll = (e, pts) => pts.every(([x, y]) => { const t = document.elementFromPoint(x, y); return t === e || e.contains(t); });
            const st = document.getElementById('d-swarm-stop'); const S = st.getBoundingClientRect(); const cx = (S.left + S.right) / 2; const cy = (S.top + S.bottom) / 2;
            const re = document.getElementById('d-reauth'); const R = re.getBoundingClientRect();
            const nm = document.getElementById('d-name');
            return { byPainter, baseThreadH, threadH, composer, nameWhole: nm.scrollWidth <= nm.clientWidth + 1 && nm.clientWidth > 0,
              stop: { inHead: S.height > 0 && S.top >= H.top - 0.5 && S.bottom <= H.bottom + 0.5, uncovered: hitAll(st, [[cx, S.top + 2], [cx, S.bottom - 2], [S.left + 2, cy], [S.right - 2, cy]]) },
              reauth: { inHead: R.height > 0 && R.top >= H.top - 0.5 && R.bottom <= H.bottom + 0.5, onTop: hitAll(re, [[(R.left + R.right) / 2, (R.top + R.bottom) / 2]]), h: Math.round(R.height) } };
          });
          // Stop now's warning (it says work is dropped): scrolling the block brings the whole of it into view
          // above the pinned button and clear of its fade.
          const hint = await p3.evaluate((fade) => {
            const head = document.querySelector('.dhead'); const el = document.getElementById('d-swarm-stop-hint');
            head.scrollTop += el.getBoundingClientRect().top - head.getBoundingClientRect().top - 4;
            const H = head.getBoundingClientRect(); const R = el.getBoundingClientRect(); const B = document.getElementById('d-reauth').getBoundingClientRect();
            const mid = document.elementFromPoint((R.left + R.right) / 2, R.bottom - 3);
            const out = { top: Math.round(R.top - H.top), bottom: Math.round(R.bottom - H.top), buttonTop: Math.round(B.top - H.top),
              whole: R.top >= H.top - 0.5 && R.bottom <= B.top - fade + 0.5, lastLineOnTop: mid === el || el.contains(mid) };
            head.scrollTop = 0; return out;
          }, FADE_PX);
          chk(hint.whole && hint.lastLineOnTop, `${t} a swarm agent whose sign-in stopped: scrolling the header brings Stop now's whole warning into view above Sign in again`, JSON.stringify(hint));
          chk(both.byPainter.swarm && both.byPainter.reauth && both.stop.inHead && both.stop.uncovered && both.reauth.inHead && both.reauth.onTop && both.reauth.h >= MIN_TAP_PX,
            `${t} a swarm agent whose sign-in stopped (painted by the page): Stop now is uncovered and Sign in again is on screen at 44px`, JSON.stringify(both));
          chk(both.nameWhole, `${t} a swarm agent whose sign-in stopped: a short name ("April") is shown whole on the one-line row`, JSON.stringify({ nameWhole: both.nameWhole }));
          const budget = w > 375 ? SWARM_BUDGET_LARGE_PX : SWARM_BUDGET_PX;
          chk(both.threadH >= both.baseThreadH - budget && both.composer.onScreen, `${t} a swarm agent whose sign-in stopped (painted by the page): the conversation gives up at most ${budget}px and the composer and Post stay on screen`, JSON.stringify({ threadH: both.threadH, base: both.baseThreadH, composer: both.composer }));
          chk(e3.length === 0, `${t} no page errors (swarm, painted by the page)`, e3.join(' | '));
          await c3.close();
        }
        // The same, with a long name and a task sentence long enough to wrap: the name row stays one line,
        // so Stop now stays where the floor was measured, uncovered.
        {
          const { ctx: c4, page: p4, errs: e4 } = await open(browser, eng, w, h, theme, { state: 'auth_failed', swarm: { active: true }, name: 'Alexandria Montgomery-Whitfield of the Northern Research Desk' }, true);
          const longer = await p4.evaluate(() => {
            const task = document.getElementById('d-task'); task.hidden = false;
            task.textContent = 'This agent cannot work until its account is signed in again, and it has stopped taking new work from its helpers.';
            const head = document.querySelector('.dhead'); head.scrollTop = 0; const H = head.getBoundingClientRect();
            const row = document.querySelector('.dnamerow').getBoundingClientRect();
            const hitAll = (e, pts) => pts.every(([x, y]) => { const t = document.elementFromPoint(x, y); return t === e || e.contains(t); });
            const st = document.getElementById('d-swarm-stop'); const S = st.getBoundingClientRect(); const cx = (S.left + S.right) / 2; const cy = (S.top + S.bottom) / 2;
            const badge = document.querySelector('.detail-state'); const B = badge.getBoundingClientRect();
            const nmEl = document.getElementById('d-name'); const ch = parseFloat(getComputedStyle(nmEl).fontSize) * 0.5;
            return { rowH: Math.round(row.height), rowInside: row.right <= H.right + 0.5, nameW: Math.round(nmEl.getBoundingClientRect().width), minNameW: Math.round(Math.min(8 * ch, 0.45 * row.width) - 2),
              taskShown: getComputedStyle(task).display !== 'none', badge: { w: Math.round(B.width), clipped: badge.scrollWidth > badge.clientWidth + 1 },
              stop: { inHead: S.height > 0 && S.top >= H.top - 0.5 && S.bottom <= H.bottom + 0.5, uncovered: hitAll(st, [[cx, S.top + 2], [cx, S.bottom - 2], [S.left + 2, cy], [S.right - 2, cy]]) } };
          });
          chk(longer.rowH <= ONE_LINE_MAX_PX && longer.rowInside && longer.stop.inHead && longer.stop.uncovered, `${t} a swarm agent whose sign-in stopped, with a long name and a wrapping task sentence: the name row stays one line and Stop now stays uncovered`, JSON.stringify(longer));
          chk(longer.nameW >= longer.minNameW, `${t} with a long name, the name keeps a readable width (at least 8 characters, or 45% of the row) on the one-line row`, JSON.stringify({ nameW: longer.nameW, min: longer.minNameW }));
          chk(!longer.taskShown && longer.badge.w > 0 && !longer.badge.clipped, `${t} in that state the task sentence is not shown and the state badge is whole (it says the sign-in stopped)`, JSON.stringify({ taskShown: longer.taskShown, badge: longer.badge }));
          chk(e4.length === 0, `${t} no page errors (long name)`, e4.join(' | '));
          await c4.close();
        }
      }
      // A phone held sideways (640x360, 40rem wide, so still the phone block): the floors are held to 30% of
      // the height (a fixed 190px would take over half of it).
      {
        const t = `[${eng} 640x360 sideways]`;
        const { ctx, page, errs } = await open(browser, eng, 640, 360, 'light', { state: 'auth_failed', swarm: { active: true } }, true);
        const side = await page.evaluate(() => {
          const head = document.querySelector('.dhead'); const re0 = document.getElementById('d-reauth');
          const shown = !re0.hidden && !document.getElementById('d-swarm-panel').hidden;
          const vis0 = window.visualViewport ? window.visualViewport.height : innerHeight;
          const onScreen = () => { const a = document.getElementById('d-say').getBoundingClientRect(); const b = document.getElementById('d-send').getBoundingClientRect(); return a.height > 0 && a.bottom <= vis0 + 0.5 && b.bottom <= vis0 + 0.5; };
          re0.hidden = true; const base = Math.round(document.getElementById('d-dmthread').getBoundingClientRect().height); const composerBefore = onScreen(); re0.hidden = false;
          const T = document.getElementById('d-dmthread').getBoundingClientRect();
          const vis = window.visualViewport ? window.visualViewport.height : innerHeight;
          const say = document.getElementById('d-say').getBoundingClientRect(); const send = document.getElementById('d-send').getBoundingClientRect();
          return { shown, capPx: Math.round(parseFloat(getComputedStyle(head).maxHeight)), vis: Math.round(vis), base, threadH: Math.round(T.height),
            composerBefore, composerOnScreen: say.height > 0 && say.bottom <= vis + 0.5 && send.bottom <= vis + 0.5 };
        });
        // This PR's part only: the floor is held to 30% of the height and costs the conversation no more than
        // that, and the composer is no worse off than without Sign in again. (Sideways, the chat-first layout
        // leaves no conversation even without it, on main too: outside #718's sizes, a follow-up.)
        chk(side.shown && side.capPx <= Math.round(0.3 * side.vis) + 1 && side.threadH >= side.base - Math.round(0.12 * side.vis) - 1 && side.composerOnScreen === side.composerBefore,
          `${t} a swarm agent whose sign-in stopped: the header floor is held to 30% of the height and costs the conversation and composer nothing beyond that`, JSON.stringify(side));
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
      }
      for (const [w, h] of [[800, 1000], [1280, 900]]) {
        const t = `[${eng} ${w}x${h}]`;
        const { ctx, page, errs } = await open(browser, eng, w, h, 'light');
        const m = await page.evaluate(notesAndMeasure, { start: true });
        chk(m.position === 'static', `${t} Sign in again is not pinned on a wide screen (the desktop layout is unchanged)`, m.position);
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
  // A run cut short, or a loop that ran nothing, must not read as a pass: the count is part of the result.
  const EXPECTED_PER_ENGINE = 174;   // 8 phone and theme runs x 21 checks, 2 sideways, 4 on wide screens
  const want = EXPECTED_PER_ENGINE * (process.env.ENGINES || 'chromium').split(',').length;
  if (RAN !== want) { console.log(`FAIL  ran ${RAN} checks, expected ${want}`); fail.push('check count'); }
  console.log(fail.length ? `\n${fail.length} FAILED` : `\nALL PASS (${RAN} checks)`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
