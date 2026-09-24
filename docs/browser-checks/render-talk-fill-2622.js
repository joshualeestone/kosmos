// Browser-check-surface: d-talk-box
'use strict';

/**
 * The Talk dialog box fills to the bottom of the window (#2622 part 2).
 *
 * Josh, product review: "the dialog box should fill the bottom of the screen
 * 100%, all the way down. Regardless of where the window's bottom edge is
 * dragged, the dialog box should stay 100% tall and fill that space (right now
 * it's a big empty gap)."
 *
 * This is the Talk-box analog of #2012 (which fixed WIDTH + the Terminal
 * #d-window, never the Talk #d-talk-box). A flex chain runs down to #d-dmthread with the
 * thread's own `max-height: 15rem` cap lifted. The height comes per layout: wide, the body is a
 * viewport-tall flex column and the panel fills what is left (#3497); narrow, the page scrolls and
 * #d-talk-box is its own window-tall block (talk-narrow-fill).
 *
 * 🛑 THE FILL ASSERTIONS ARE CONTROLS, not bare reads. Each would FAIL on the
 * pre-change build: #d-talk-box was content-height (~short), so on a tall window
 * its bottom sat far above the viewport bottom (the "big empty gap"). "bottom
 * within TOL of the viewport bottom, at TWO window heights" is the control.
 *
 * #3497 (Josh 2026-09-23): in the wide layout the box also meets the header rule and the
 * right edge, and the composer's bottom margin equals its side margins (A1b-A1g), including
 * when the header grows taller (A1f) and without moving the identity column (A1g).
 *
 * Scoping guard (A6): a non-Talk section (Model) must NOT be forced tall -- the
 * fill is :has()-gated to the Talk section only.
 *
 *   node docs/browser-checks/render-talk-fill-2622.js            # headed
 *   HEADED=0 node docs/browser-checks/render-talk-fill-2622.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-talk-fill-2622.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tf-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

// A1/A2 are the loose pre-#3497 controls (the box within TOL of the viewport bottom);
// A1b is the tight one (flush within 1px). Pre-change the gap was many hundreds of px, so TOL discriminates.
const TOL = 130;

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// Measure the Talk box / composer / thread geometry after scrolling to top.
async function measure(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 0);
    const box = document.getElementById('d-talk-box');
    const panel = document.getElementById('panel-detail');
    const thread = document.getElementById('d-dmthread');
    const composer = document.querySelector('#d-talk-box .dmbar.composerbox');
    const back = document.getElementById('detail-back');
    const br = box.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    const cr = composer ? composer.getBoundingClientRect() : null;
    return {
      innerHeight: window.innerHeight,
      panelTop: Math.round(pr.top),
      panelBottom: Math.round(pr.bottom),
      panelWidth: Math.round(pr.width),
      backWidth: back ? Math.round(back.getBoundingClientRect().width) : null,
      boxTop: Math.round(br.top),
      boxLeft: Math.round(br.left),
      boxRight: Math.round(br.right),
      viewW: window.innerWidth, // the WINDOW edge: html's clientWidth hides a reserved scrollbar gutter
      headBottom: Math.round(document.querySelector('.apphead').getBoundingClientRect().bottom),
      backRight: back ? Math.round(back.getBoundingClientRect().right) : null,
      backBottom: back ? Math.round(back.getBoundingClientRect().bottom) : null,
      identTop: (() => { const d = document.querySelector('#panel-detail .dleft'); const f = d && d.firstElementChild; return f ? Math.round(f.getBoundingClientRect().top) : null; })(),
      composerLeft: cr ? Math.round(cr.left) : null,
      composerRight: cr ? Math.round(cr.right) : null,
      boxBottom: Math.round(br.bottom),
      gapBelowBox: Math.round(window.innerHeight - br.bottom),
      composerBottom: cr ? Math.round(cr.bottom) : null,
      composerTop: cr ? Math.round(cr.top) : null,
      threadScrollH: thread.scrollHeight,
      threadClientH: thread.clientHeight,
      docScrollH: document.documentElement.scrollHeight,
    };
  });
}

(async () => {
  fleet.install([
    fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix', role: 'Collections Coordinator' }),
  ]);

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="beatrix"]', { timeout: 8000 });
    // Header positions on the board, before opening the agent (A1n compares Talk and Model to it).
    const headPos = () => page.evaluate(() => {
      const r = document.querySelector('.apphead .headright').getBoundingClientRect();
      const t = document.getElementById('tabs').getBoundingClientRect();
      return { headRight: Math.round(r.right), tabsLeft: Math.round(t.left),
        gutter: getComputedStyle(document.documentElement).scrollbarGutter,
        sbw: getComputedStyle(document.documentElement).getPropertyValue('--scrollbar-width').trim(),
        padRight: getComputedStyle(document.querySelector('.apphead')).paddingRight };
    });
    const boardHead = await headPos();
    await page.click('[data-agent="beatrix"]');
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(300);

    // Fill the thread with enough rows that, capped, it would want to scroll.
    await page.evaluate(() => {
      const t = document.getElementById('d-dmthread');
      for (let i = 0; i < 40; i++) {
        const row = document.createElement('div');
        row.className = 'dm' + (i % 2 ? ' mine' : '');
        row.innerHTML = '<div class="msg-b">Fixture message line ' + i + ' for the fill check.</div>';
        t.appendChild(row);
      }
    });
    await page.waitForTimeout(150);

    // --- Tall window (1100) ---
    const tall = await measure(page);
    console.log('MEASURE tall(1100): ' + JSON.stringify(tall));
    chk(tall.boxBottom > tall.innerHeight - TOL,
      'A1 tall window: the Talk box fills to near the viewport bottom (control: pre-change it sat far above)',
      'boxBottom=' + tall.boxBottom + ' innerHeight=' + tall.innerHeight + ' gap=' + tall.gapBelowBox);
    // #3497: the wide layout fills to three edges and the composer's bottom margin equals its
    // side margins. Control: on the pre-#3497 page the box sat 53px below the header, 24px
    // short of the right edge and 64px above the bottom, and the composer's bottom gap was 42
    // against 24 at the sides, so A1b and A1c red there. A1d and A1e guard what the fill could
    // break (a page scroll; the absolutely placed back link overlapping the identity block).
    const edges = (m, tag) => {
      chk(Math.abs(m.boxTop - m.headBottom) <= 1 && Math.abs(m.boxRight - m.viewW) <= 1 && Math.abs(m.boxBottom - m.innerHeight) <= 1,
        'A1b ' + tag + ': the Talk box meets the header rule, the right edge and the bottom edge',
        'boxTop=' + m.boxTop + ' headBottom=' + m.headBottom + ' boxRight=' + m.boxRight + ' viewW=' + m.viewW + ' boxBottom=' + m.boxBottom + ' innerHeight=' + m.innerHeight);
      const gl = m.composerLeft - m.boxLeft, gr = m.boxRight - m.composerRight, gb = m.boxBottom - m.composerBottom;
      chk(m.composerBottom !== null && Math.abs(gb - gl) <= 2 && Math.abs(gb - gr) <= 2,
        'A1c ' + tag + ': the composer bottom margin equals its left and right margins',
        'left=' + gl + ' right=' + gr + ' bottom=' + gb);
      chk(m.docScrollH <= m.innerHeight + 1,
        'A1d ' + tag + ': the filled page does not scroll', 'docScrollH=' + m.docScrollH + ' innerHeight=' + m.innerHeight);
      chk(m.backBottom !== null && m.identTop !== null && m.backBottom <= m.identTop,
        'A1e ' + tag + ': the back link does not overlap the identity block', 'backBottom=' + m.backBottom + ' identTop=' + m.identTop);
    };
    edges(tall, 'tall window');
    // A1m: the wide Talk view drops the #1309 scrollbar gutter (so the box can reach the window
    // edge on a Mac that shows scrollbars). A computed-style read, so it holds in any scrollbar
    // mode; A1b shows the result where the runner's scrollbars take width.
    const talkHead = await headPos();
    chk(talkHead.gutter === 'auto', 'A1m the wide Talk view drops the scrollbar gutter', JSON.stringify(talkHead));
    // A1g (checked at the Model visit below): the identity block sits at the same distance from the
    // header on Talk as on Model, so switching sections does not make it jump.
    const talkIdentFromHead = tall.identTop - tall.headBottom;
    // A1h: the build marker is not inside the box (it moves to the bottom-left in this state).
    const mark = await page.evaluate(() => {
      const b = document.getElementById('buildmark'); const box = document.getElementById('d-talk-box');
      if (!b || b.hidden) return null;
      const r = b.getBoundingClientRect(), x = box.getBoundingClientRect();
      return { overlaps: r.right > x.left && r.left < x.right && r.bottom > x.top && r.top < x.bottom, left: Math.round(r.left) };
    });
    chk(mark !== null && !mark.overlaps, 'A1h the build marker is present and does not sit inside the Talk box', JSON.stringify(mark));
    // A1i: a phone-pairing card between the header and the panel is not covered by the box.
    const ask = await page.evaluate(() => {
      const a = document.getElementById('askcard'); if (!a) return null;
      const keep = a.innerHTML;
      a.hidden = false; a.textContent = 'Fixture pairing request';
      const r = a.getBoundingClientRect(), x = document.getElementById('d-talk-box').getBoundingClientRect();
      const out = { askBottom: Math.round(r.bottom), boxTop: Math.round(x.top), boxBottom: Math.round(x.bottom), innerHeight: window.innerHeight };
      a.innerHTML = keep; a.hidden = true; return out;
    });
    chk(ask !== null && ask.askBottom <= ask.boxTop && Math.abs(ask.boxBottom - ask.innerHeight) <= 1,
      'A1i a visible phone-pairing card is not covered, and the box still meets the bottom', JSON.stringify(ask));
    // A1j: a body-level notice BELOW the panel (#conn, the connection banner) stays visible and the
    // box shrinks to make room, with no page scroll.
    const conn = await page.evaluate(() => {
      const c = document.getElementById('conn'); if (!c) return null;
      const keep = c.textContent; c.hidden = false; c.textContent = 'Fixture connection notice';
      const r = c.getBoundingClientRect(), x = document.getElementById('d-talk-box').getBoundingClientRect();
      const out = { connTop: Math.round(r.top), connBottom: Math.round(r.bottom), boxBottom: Math.round(x.bottom), innerHeight: window.innerHeight, docScrollH: document.documentElement.scrollHeight };
      c.textContent = keep; c.hidden = true; return out;
    });
    chk(conn !== null && conn.boxBottom <= conn.connTop && conn.connBottom <= conn.innerHeight + 1 && conn.docScrollH <= conn.innerHeight + 1,
      'A1j a connection notice below the panel stays on screen, the box makes room, no page scroll', JSON.stringify(conn));
    // A1k: scrolling a tall identity column (#3385) never slides it under the back link.
    const scrolled = await page.evaluate(() => {
      const d = document.querySelector('#panel-detail .dleft'); const b = document.getElementById('detail-back');
      return { dleftTop: Math.round(d.getBoundingClientRect().top), backBottom: Math.round(b.getBoundingClientRect().bottom) };
    });
    chk(scrolled.dleftTop >= scrolled.backBottom,
      'A1k the identity column scroll box starts below the back link', JSON.stringify(scrolled));
    // A1f: a TALLER header (a wrapped update notice, other fonts) must shrink the box, not push it
    // past the bottom. Control: a fixed-offset height would leave boxTop at the header but boxBottom
    // past innerHeight by the added 60px, and the page would scroll.
    await page.evaluate(() => { const h = document.querySelector('.apphead'); const x = document.createElement('div'); x.style.height = '60px'; h.appendChild(x); window.__tfTallNotice = x; });
    await page.waitForTimeout(150);
    const taller = await measure(page);
    edges(taller, 'taller header');
    await page.evaluate(() => { if (window.__tfTallNotice) window.__tfTallNotice.remove(); });
    await page.waitForTimeout(100);
    chk(tall.boxBottom < tall.innerHeight + 40,
      'A3 tall window: the box does not massively overshoot the viewport',
      'boxBottom=' + tall.boxBottom + ' innerHeight=' + tall.innerHeight);
    chk(tall.composerBottom !== null && tall.composerBottom > tall.innerHeight - 200 && tall.composerBottom <= tall.innerHeight + 5,
      'A4 tall window: the composer is pinned near the bottom of the window',
      'composerBottom=' + tall.composerBottom + ' innerHeight=' + tall.innerHeight);
    // A5 has two arms so it discriminates the CAP LIFT, not just "it scrolls": a thread
    // still capped at 15rem (~240px) would ALSO scroll on 40 rows, so scrollH>clientH alone
    // does not red on the pre-change page. threadClientH growing well past 240px on a tall
    // window is what the lifted cap buys (measured ~532 lifted vs <=240 capped), and it reds
    // on the pre-change page where the cap holds.
    chk(tall.threadScrollH > tall.threadClientH + 20,
      'A5a the thread scrolls INTERNALLY on a long conversation (own overflow)',
      'threadScrollH=' + tall.threadScrollH + ' threadClientH=' + tall.threadClientH);
    chk(tall.threadClientH > 240,
      'A5b the thread height grows well past the old 15rem (~240px) cap (control: capped stays <=240)',
      'threadClientH=' + tall.threadClientH);
    // A8: the flex column must not stretch the .back button to full width (its content would
    // then center). Control: pre-fix (align-items default stretch, no align-self) backWidth
    // equals panelWidth; the intrinsic button is a small fraction of the wide panel.
    chk(tall.backWidth !== null && tall.backWidth < tall.panelWidth * 0.6,
      'A8 the back button keeps its intrinsic left-aligned width (not stretched by the flex column)',
      'backWidth=' + tall.backWidth + ' panelWidth=' + tall.panelWidth);

    // --- Short window (700): fill must still hold when the edge is dragged up ---
    await page.setViewportSize({ width: 1400, height: 700 });
    await page.waitForTimeout(200);
    const short = await measure(page);
    console.log('MEASURE short(700): ' + JSON.stringify(short));
    chk(short.boxBottom > short.innerHeight - TOL,
      'A2 short window: the Talk box still fills to near the viewport bottom',
      'boxBottom=' + short.boxBottom + ' innerHeight=' + short.innerHeight + ' gap=' + short.gapBelowBox);
    edges(short, 'short window');
    // A1l: Josh's window size (0.6.91 QA, about 1000x660), where a reserved scrollbar gutter left a
    // 15px strip down the right edge (box right 985 in a 1000 window). A1b above now measures to
    // window.innerWidth, so it reds on that strip.
    await page.setViewportSize({ width: 1000, height: 660 });
    await page.waitForTimeout(200);
    edges(await measure(page), 'Josh window 1000x660');

    // --- Narrow width (<=56rem): the identity block and nav stack above the Talk box, so the page
    // scrolls and the box is its own window-tall block; the header is not sticky in this view.
    // Control for A2b/A2d/A2e: with a window-tall PANEL (the #2622 fill) the box got the sliver left
    // under the nav: at 500x900, box 775-842 and composer 874-928, below the box and the window. ---
    await page.setViewportSize({ width: 500, height: 900 });
    await page.waitForTimeout(200);
    const narrowAt = (where) => page.evaluate((w) => {
      const box = document.getElementById('d-talk-box');
      if (w === 'end') box.scrollIntoView({ block: 'end' });
      else window.scrollTo(0, document.documentElement.scrollHeight);
      const b = box.getBoundingClientRect();
      const c = document.querySelector('#d-talk-box .dmbar.composerbox').getBoundingClientRect();
      const h = document.querySelector('.apphead').getBoundingClientRect();
      const out = { boxHeight: Math.round(b.height), boxTop: Math.round(b.top), boxBottom: Math.round(b.bottom),
        headBottom: Math.round(h.bottom), composerTop: Math.round(c.top), composerBottom: Math.round(c.bottom),
        innerHeight: window.innerHeight, gutter: getComputedStyle(document.documentElement).scrollbarGutter };
      window.scrollTo(0, 0);
      return out;
    }, where);
    const onScreen = (m) => m.boxTop >= Math.max(0, m.headBottom) && m.boxBottom <= m.innerHeight
      && m.composerTop >= m.boxTop && m.composerBottom <= m.boxBottom;
    const nEnd = await narrowAt('end');
    const nMax = await narrowAt('max');
    console.log('MEASURE narrow(500x900) end=' + JSON.stringify(nEnd) + ' max=' + JSON.stringify(nMax));
    chk(nEnd.boxHeight >= 320 && nEnd.boxHeight <= nEnd.innerHeight,
      'A2b narrow width: the Talk box is a usable, window-fitting height', JSON.stringify(nEnd));
    chk(onScreen(nEnd),
      'A2d narrow width: scrolled to the box, all of it (header row to composer) is on screen and uncovered', JSON.stringify(nEnd));
    chk(nEnd.gutter === 'stable', 'A1m scope: the narrow Talk view (which scrolls) keeps the scrollbar gutter', 'gutter=' + nEnd.gutter);
    chk(onScreen(nMax),
      'A2e narrow width: at the end of the page (where scrolling stops), the whole box is on screen and uncovered', JSON.stringify(nMax));
    // A2f: focusing the box (the app does, e.g. the paintTalk rescue) keeps its composer on screen,
    // and at the end of the page the build marker sits below the box, not under Post.
    const nFocus = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const box = document.getElementById('d-talk-box'); box.focus();
      const c = document.querySelector('#d-talk-box .dmbar.composerbox').getBoundingClientRect();
      const out = { composerBottom: Math.round(c.bottom), innerHeight: window.innerHeight };
      window.scrollTo(0, document.documentElement.scrollHeight);
      const m = document.getElementById('buildmark'); const b = box.getBoundingClientRect();
      const r = m && !m.hidden ? m.getBoundingClientRect() : null;
      out.markInBox = r ? (r.top < b.bottom && r.bottom > b.top && r.left < b.right && r.right > b.left) : null;
      box.blur(); window.scrollTo(0, 0);
      return out;
    });
    chk(nFocus.composerBottom <= nFocus.innerHeight && nFocus.markInBox === false,
      'A2f narrow width: focusing the box keeps the composer on screen; the build marker is present and clear of the box', JSON.stringify(nFocus));

    // --- A long THREAD in a SHORT window: the composer must stay reachable. This
    // guards a failure mode the FILL ITSELF introduces, NOT a pre-change control
    // (pre-change #d-talk-box had no constrained height, so it never overflowed and
    // the page scrolled): the fixed panel height can clip the non-thread children
    // once the thread grows, so the box's overflow-y:auto fallback must let them be
    // scrolled to. A9a first asserts the overflow was genuinely created (so A9b is
    // not vacuous), then A9b asserts the box scrolls and the composer is reachable;
    // toggling overflow-y off would red A9b, which is the within-fix control.
    // #3419: overflow used to be forced with the removed #d-qask-text/#d-qopts menu
    // box. A needs_you question is a thread bubble now, so the natural overflow
    // source is a long thread -- filled straight into #d-dmthread, measured inside
    // the poll interval so a repaint does not wipe it before the read. ---
    await page.setViewportSize({ width: 1400, height: 440 });
    await page.evaluate(() => {
      const thread = document.getElementById('d-dmthread');
      if (thread) {
        thread.innerHTML = Array.from({ length: 40 }, (_, i) =>
          '<div class="msg"><div class="msg-bd">a long enough message row number ' + i
          + ' to take a line or two of the thread box in a short window</div></div>').join('');
      }
    });
    await page.waitForTimeout(150);
    const qask = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const box = document.getElementById('d-talk-box');
      const thread = document.getElementById('d-dmthread');
      const composer = document.querySelector('#d-talk-box .dmbar.composerbox');
      // #3419: the THREAD is the scroller now (it has overflow-y:auto and grows to
      // fill the flex chain), so a long thread overflows #d-dmthread, not the fixed
      // #d-talk-box. The invariant is that the thread absorbs it INTERNALLY while the
      // composer stays pinned within the box -- not that the box itself overflows.
      const threadOverflows = thread.scrollHeight > thread.clientHeight + 4;
      thread.scrollTop = thread.scrollHeight;         // scroll the thread to its foot
      const br = box.getBoundingClientRect();
      const cr = composer.getBoundingClientRect();
      return { threadOverflows, threadOverflowY: getComputedStyle(thread).overflowY, composerWithinBox: cr.bottom <= br.bottom + 4 };
    });
    console.log('MEASURE thread-short(1400x440): ' + JSON.stringify(qask));
    chk(qask.threadOverflows === true,
      'A9a the long thread genuinely overflows the thread box (so A9b is not vacuous)',
      'threadOverflows=' + qask.threadOverflows + ' (thread scrollHeight > clientHeight)');
    chk(qask.threadOverflowY === 'auto' && qask.composerWithinBox,
      'A9b the thread scrolls internally so the composer stays reachable when it overflows',
      'threadOverflowY=' + qask.threadOverflowY + ' composerWithinBox=' + qask.composerWithinBox);

    // Repaint the thread so the scoping guard below sees a normal talk section
    // (the injected rows are inert markup the next real poll would replace anyway).
    await page.evaluate(() => { const t = document.getElementById('d-dmthread'); if (t) t.innerHTML = ''; });

    // --- Scoping guard: a non-Talk section (Model) is NOT forced tall ---
    await page.setViewportSize({ width: 1400, height: 1100 });
    await page.click('#panel-detail .snav button[data-go="model"]');
    await page.waitForSelector('#d-sec-model:not([hidden])');
    await page.waitForTimeout(200);
    const model = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const sec = document.getElementById('d-sec-model');
      const r = sec.getBoundingClientRect();
      const d = document.querySelector('#panel-detail .dleft'); const f = d && d.firstElementChild;
      const head = document.querySelector('.apphead').getBoundingClientRect().bottom;
      return { innerHeight: window.innerHeight, secBottom: Math.round(r.bottom), secHeight: Math.round(r.height),
        identFromHead: f ? Math.round(f.getBoundingClientRect().top - head) : null };
    });
    console.log('MEASURE model section: ' + JSON.stringify(model));
    // A1m scope + A1n: every other view keeps the #1309 gutter, and the header does not move
    // between the board, Talk and Model (--scrollbar-width pads the header by the dropped gutter's width).
    const modelHead = await headPos();
    chk(modelHead.gutter === 'stable' && boardHead.gutter === 'stable',
      'A1m scope: the board and the Model section keep the scrollbar gutter', JSON.stringify({ boardHead, modelHead }));
    // A1n measures the real thing, but only where this runner's scrollbars take width (--scrollbar-width > 0);
    // with overlay scrollbars there is no gutter to drop, so a pass would prove nothing: SKIP, loudly.
    if (boardHead.sbw && boardHead.sbw !== '0px') {
      chk(boardHead.headRight === talkHead.headRight && talkHead.headRight === modelHead.headRight
        && boardHead.tabsLeft === talkHead.tabsLeft && talkHead.tabsLeft === modelHead.tabsLeft,
        'A1n the header controls and tabs do not move between the board, Talk and Model',
        JSON.stringify({ boardHead, talkHead, modelHead }));
    } else {
      console.log('SKIP  A1n (overlay scrollbars on this runner, --scrollbar-width=' + boardHead.sbw + '; headless always hides them, run HEADED on a Mac that shows scrollbars); A1o covers the mechanism');
    }
    // A1o, the mechanism in any scrollbar mode: with a 15px scrollbar the Talk header gains exactly
    // 15px of right padding, and the other views do not.
    const pad = await page.evaluate(async () => {
      const bootWidth = document.documentElement.style.getPropertyValue('--scrollbar-width');
      document.documentElement.style.setProperty('--scrollbar-width', '15px');
      const read = () => getComputedStyle(document.querySelector('.apphead')).paddingRight;
      const model = read();
      document.querySelector('#panel-detail .snav button[data-go="talk"]').click();
      await new Promise((r) => setTimeout(r, 150));
      const talk = read();
      // The consolidated layout preference keeps data-layout on html even on an agent's page, and
      // reserves no gutter anywhere, so the Talk header must NOT gain the padding there.
      const prevLayout = document.documentElement.getAttribute('data-layout');
      document.documentElement.setAttribute('data-layout', 'consolidated');
      const consTalk = read();
      if (prevLayout === null) document.documentElement.removeAttribute('data-layout');
      else document.documentElement.setAttribute('data-layout', prevLayout);
      if (bootWidth) document.documentElement.style.setProperty('--scrollbar-width', bootWidth);
      else document.documentElement.style.removeProperty('--scrollbar-width');
      return { model, talk, consTalk };
    });
    chk(parseFloat(pad.talk) - parseFloat(pad.model) === 15,
      'A1o in Talk the header is padded by the scrollbar width (15px here), and not in Model (the page is left on Talk)', JSON.stringify(pad));
    // A1p: the width is re-measured, not fixed at load. A resize (which a zoom or a display move
    // fires) replaces a planted wrong value with the measured one, and the Windows stamp re-measures
    // too (its scrollbar rule changes the width).
    const remeasure = await page.evaluate(async () => {
      const before = document.documentElement.style.getPropertyValue('--scrollbar-width');
      document.documentElement.style.setProperty('--scrollbar-width', '99px');
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const after = document.documentElement.style.getPropertyValue('--scrollbar-width');
      return { before, after, platformHook: /kosmosMeasureScrollbarWidth\(\)/.test(String(applyPlatformCopy)) };
    });
    chk(remeasure.after === remeasure.before && remeasure.after !== '99px' && remeasure.platformHook,
      'A1p the scrollbar width is re-measured on resize and after the Windows stamp', JSON.stringify(remeasure));
    chk(pad.consTalk === pad.model,
      'A1o scope: with the consolidated layout chosen (no gutter anywhere), the Talk header is not padded', JSON.stringify(pad));
    chk(model.identFromHead !== null && Math.abs(model.identFromHead - talkIdentFromHead) <= 1,
      'A1g the identity block stays where it was (within 1px of Model; the 1px is the pre-existing Talk/Model line-box difference)',
      'talk=' + talkIdentFromHead + ' model=' + model.identFromHead);
    chk(model.secBottom < model.innerHeight - 200,
      'A6 scoping: a non-Talk section (Model) stays content-height, NOT stretched to the window',
      'secBottom=' + model.secBottom + ' innerHeight=' + model.innerHeight);

    chk(errs.length === 0, 'A7 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall Talk-box fill checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
