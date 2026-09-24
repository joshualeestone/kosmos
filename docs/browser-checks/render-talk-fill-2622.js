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
 * #d-window, never the Talk #d-talk-box). The fix is a definite viewport height on
 * the document-scroll #panel-detail plus a flex chain down to #d-dmthread, with
 * the thread's own `max-height: 15rem` cap lifted (per the #980 lesson: a bare
 * max-height does not grow a short box, and a min-height lets content grow the
 * panel unbounded so the thread never scrolls).
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

// The dialog box may sit up to TOL px above the viewport bottom and still read
// as "filled" -- that room is the body's own bottom padding (64px) plus a little
// rounding. Pre-change the gap was many hundreds of px, so TOL discriminates.
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
      viewW: document.documentElement.clientWidth,
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
    chk(mark === null || !mark.overlaps, 'A1h the build marker does not sit inside the Talk box', JSON.stringify(mark));
    // A1i: a phone-pairing card between the header and the panel is not covered by the box.
    const ask = await page.evaluate(() => {
      const a = document.getElementById('askcard'); if (!a) return null;
      a.hidden = false; a.textContent = 'Fixture pairing request';
      const r = a.getBoundingClientRect(), x = document.getElementById('d-talk-box').getBoundingClientRect();
      const out = { askBottom: Math.round(r.bottom), boxTop: Math.round(x.top), boxBottom: Math.round(x.bottom), innerHeight: window.innerHeight };
      a.hidden = true; return out;
    });
    chk(ask !== null && ask.askBottom <= ask.boxTop && Math.abs(ask.boxBottom - ask.innerHeight) <= 1,
      'A1i a visible phone-pairing card is not covered, and the box still meets the bottom', JSON.stringify(ask));
    // A1f: a TALLER header (a wrapped update notice, other fonts) must shrink the box, not push it
    // past the bottom. Control: a fixed-offset height would leave boxTop at the header but boxBottom
    // past innerHeight by the added 60px, and the page would scroll.
    await page.evaluate(() => { const h = document.querySelector('.apphead'); const x = document.createElement('div'); x.id = 'tf-tall-notice'; x.style.height = '60px'; h.appendChild(x); });
    await page.waitForTimeout(150);
    const taller = await measure(page);
    edges(taller, 'taller header');
    await page.evaluate(() => { const x = document.getElementById('tf-tall-notice'); if (x) x.remove(); });
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

    // --- Narrow width (<=56rem): the grid collapses to one column and the snav
    // wraps to a row above .dsecs. The talk fill must still hold WITHOUT ballooning
    // the snav row (the failure this arm guards: a single-column grid stretching both
    // rows equally). Measured at 500px wide, a phone-ish width below the 56rem breakpoint. ---
    await page.setViewportSize({ width: 500, height: 900 });
    await page.waitForTimeout(200);
    const narrow = await measure(page);
    const narrowNav = await page.evaluate(() => {
      const snav = document.querySelector('#panel-detail .snav');
      const box = document.getElementById('d-talk-box');
      const srect = snav ? snav.getBoundingClientRect() : null;
      // The nav lives in a .dleft flex-column (identity block + the snav, the snav last), which sits
      // in the `auto` row of the .dbody grid (#3385). Measure whether that row stays content-height by
      // the signed gap between the snav's bottom and its .dleft's bottom (minus .dleft's padding-bottom):
      //   ~0  -> flush, content-height (healthy)
      //   >0  -> empty space below the nav: the row was STRETCHED to fill a tall track
      //   <0  -> the nav OVERFLOWS .dleft: the row was shrunk (the actual #2569 regression)
      // Measured on box geometry, NOT scrollHeight: .dleft/.snav carry no overflow of their own, so
      // scrollHeight just echoes an externally-sized box; and a stretch balloons the .dleft ROW, not
      // #d-nav (a flex column always ends flush with its last item, so a #d-nav gap is vacuously 0).
      const dleft = snav ? snav.closest('.dleft') : null;
      const drect = dleft ? dleft.getBoundingClientRect() : null;
      const dPadB = dleft ? (parseFloat(getComputedStyle(dleft).paddingBottom) || 0) : 0;
      return {
        snavHeight: srect ? Math.round(srect.height) : null,
        navGapInDleft: (srect && drect) ? Math.round(drect.bottom - srect.bottom - dPadB) : null,
        boxHeight: box ? Math.round(box.getBoundingClientRect().height) : null,
      };
    });
    console.log('MEASURE narrow(500x900): ' + JSON.stringify(narrow) + ' nav=' + JSON.stringify(narrowNav));
    chk(narrow.boxBottom > narrow.innerHeight - TOL,
      'A2b narrow width: the Talk box still fills to near the viewport bottom',
      'boxBottom=' + narrow.boxBottom + ' innerHeight=' + narrow.innerHeight + ' gap=' + narrow.gapBelowBox);
    // #3547/#3500: the agent nav is now a vertical stack of icon+label boxes, so at narrow width it is
    // legitimately TALLER than the talk box (268 vs 209). The old `snavHeight < boxHeight` predated the
    // boxed redesign and false-failed. This arm now guards the nav's .dleft row staying content-height
    // (navGapInDleft ~ 0). Proven able to fail on the REAL regression: removing the .dbody
    // `grid-template-rows: auto minmax(0,1fr)` fix (index.html ~2569) shrinks the row so the nav
    // overflows .dleft and navGapInDleft goes to -128 (A2b and a #d-nav-only gap both stay green there,
    // which is why this measures the .dleft row, not #d-nav).
    chk(narrowNav.navGapInDleft !== null && Math.abs(narrowNav.navGapInDleft) <= 4,
      'A2c narrow width: the nav sits flush in its .dleft row (content-height, neither stretched nor overflowing)',
      'navGapInDleft=' + narrowNav.navGapInDleft + ' snavHeight=' + narrowNav.snavHeight + ' boxHeight=' + narrowNav.boxHeight);

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
    chk(model.identFromHead !== null && Math.abs(model.identFromHead - talkIdentFromHead) <= 1,
      'A1g the identity block sits at the same place on Talk as on Model (no jump when switching)',
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
