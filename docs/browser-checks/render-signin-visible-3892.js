// Browser-check-surface: d-reauth d-start-wrap d-start-agent dhead d-said d-instr-stale d-sec-talk d-swarm-panel d-nav-swarm d-dmthread linkish d-name d-task d-meta detail-state dnamerow
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
 *     152px floor for Start);
 *   - with Sign in again alone (no Start), the cap is unchanged;
 *   - through the page's own painter: an agent whose sign-in stopped (state auth_failed) gets Sign in again
 *     from paintDetail, on screen and tappable (the rules key on the hidden attribute the painter sets); and
 *     a SWARM agent whose sign-in stopped (the combination that really happens) gets the same header as any
 *     other: its controls are in the Swarm Settings view since #4433, so none is in the header, Sign in again
 *     is on screen at 44px, and the composer and Post stay on screen; also with a long name and a wrapping
 *     task sentence;
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
    return { reauth: one('d-reauth'), start: opts.start ? one('d-start-agent') : null };
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
        // The combination that really happens, painted by the page: a swarm agent whose sign-in stopped. Since #4433 its
        // controls are in the Swarm Settings view, so the header is the one any agent gets: Sign in again on screen at
        // 44px, no swarm control in it, and the composer and Post on screen. Also with a long name and a wrapping task.
        for (const name of ['April', 'Alexandria Montgomery-Whitfield of the Northern Research Desk']) {
          const { ctx: c3, page: p3, errs: e3 } = await open(browser, eng, w, h, theme, { state: 'auth_failed', swarm: { active: true }, name }, true);
          const both = await p3.evaluate(() => {
            const byPainter = { swarm: !document.getElementById('d-nav-swarm').hidden, reauth: !document.getElementById('d-reauth').hidden };
            if (document.getElementById('d-name').textContent.length > 20) { const task = document.getElementById('d-task'); task.hidden = false;
              task.textContent = 'This agent cannot work until its account is signed in again, and it has stopped taking new work from its helpers.'; }
            const vis = window.visualViewport ? window.visualViewport.height : innerHeight;
            const say = document.getElementById('d-say').getBoundingClientRect(); const send = document.getElementById('d-send').getBoundingClientRect();
            const head = document.querySelector('.dhead'); head.scrollTop = 0; const H = head.getBoundingClientRect();
            const re = document.getElementById('d-reauth'); const R = re.getBoundingClientRect();
            const hit = document.elementFromPoint((R.left + R.right) / 2, (R.top + R.bottom) / 2);
            const row = document.querySelector('.dnamerow').getBoundingClientRect();
            return { byPainter, inHeader: !!head.querySelector('#d-swarm-panel, #d-swarm-stop, .swcard'),
              composerOnScreen: say.height > 0 && say.bottom <= vis + 0.5 && send.bottom <= vis + 0.5, rowInside: row.right <= H.right + 0.5,
              reauth: { inHead: R.height > 0 && R.top >= H.top - 0.5 && R.bottom <= H.bottom + 0.5, onTop: hit === re || re.contains(hit), h: Math.round(R.height) } };
          });
          const tn = name.length > 20 ? ' (long name, wrapping task)' : '';
          chk(both.byPainter.swarm && both.byPainter.reauth && !both.inHeader && both.reauth.inHead && both.reauth.onTop && both.reauth.h >= MIN_TAP_PX && both.rowInside,
            `${t} a swarm agent whose sign-in stopped (painted by the page)${tn}: no swarm control in the header, and Sign in again is on screen at 44px`, JSON.stringify(both));
          chk(both.composerOnScreen, `${t} a swarm agent whose sign-in stopped (painted by the page)${tn}: the composer and Post stay on screen`, JSON.stringify(both));
          chk(e3.length === 0, `${t} no page errors (swarm, painted by the page${tn})`, e3.join(' | '));
          await c3.close();
        }
      }
      // A phone held sideways (640x360, 40rem wide, so still the phone block): the floors are held to 30% of
      // the height (a fixed 190px would take over half of it).
      {
        const t = `[${eng} 640x360 sideways]`;
        /* #3969: a TIED agent here (isNamedOurs), as a swarm agent always is (engine/status.js builds `swarm` only for a
           tied card); nameDerived is set only to match the other fixtures and changes nothing here. The untied card the other
           arms use also shows the 55px "this session is not that agent" note, a state a swarm agent never has; with
           #3969 giving the sideways chat its message box back, that note alone decided this arm. */
        const { ctx, page, errs } = await open(browser, eng, 640, 360, 'light', { state: 'auth_failed', swarm: { active: true }, isNamedOurs: true, nameDerived: true }, true);
        const side = await page.evaluate(() => {
          const head = document.querySelector('.dhead'); const re0 = document.getElementById('d-reauth');
          const shown = !re0.hidden && !document.getElementById('d-nav-swarm').hidden;
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
        // that, and the composer is no worse off than without Sign in again. (#3969 gave the sideways chat its
        // message box; with a tied agent the 30% floor still leaves it on screen, measured at 640x360.)
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
  /* 8 phone and theme runs x 16 checks, 2 sideways, 4 on wide screens. 21 per run until #4433 moved the swarm's
     controls out of the header: its 11 Stop-now checks per run became 6 (two painted swarm agents x 3). */
  const EXPECTED_PER_ENGINE = 134;
  const want = EXPECTED_PER_ENGINE * (process.env.ENGINES || 'chromium').split(',').length;
  if (RAN !== want) { console.log(`FAIL  ran ${RAN} checks, expected ${want}`); fail.push('check count'); }
  console.log(fail.length ? `\n${fail.length} FAILED` : `\nALL PASS (${RAN} checks)`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
