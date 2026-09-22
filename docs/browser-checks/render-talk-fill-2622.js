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
    // A1b tightens A1: the box bottom should sit ~64px above the window bottom (the body's
    // bottom padding), directly validating the 157px offset. A1's TOL=130 is deliberately
    // loose so it discriminates the pre-change hundreds-of-px gap; this arm catches a chrome
    // or offset drift of tens of px that would slip under that slack.
    chk(tall.gapBelowBox >= 45 && tall.gapBelowBox <= 85,
      'A1b the box bottom sits ~64px above the window bottom (validates the 157px offset directly)',
      'gap=' + tall.gapBelowBox);
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
      return {
        snavHeight: snav ? Math.round(snav.getBoundingClientRect().height) : null,
        boxHeight: box ? Math.round(box.getBoundingClientRect().height) : null,
      };
    });
    console.log('MEASURE narrow(500x900): ' + JSON.stringify(narrow) + ' nav=' + JSON.stringify(narrowNav));
    chk(narrow.boxBottom > narrow.innerHeight - TOL,
      'A2b narrow width: the Talk box still fills to near the viewport bottom',
      'boxBottom=' + narrow.boxBottom + ' innerHeight=' + narrow.innerHeight + ' gap=' + narrow.gapBelowBox);
    chk(narrowNav.snavHeight !== null && narrowNav.boxHeight !== null && narrowNav.snavHeight < narrowNav.boxHeight,
      'A2c narrow width: the wrapped snav row stays content-height (not ballooned to rival the talk box)',
      'snavHeight=' + narrowNav.snavHeight + ' boxHeight=' + narrowNav.boxHeight);

    // --- Live-question (#d-qask) in a SHORT window: the answer options + composer must stay
    // reachable. This guards a failure mode the FILL ITSELF introduces, NOT a pre-change
    // control (pre-change #d-talk-box had no constrained height, so it never overflowed and
    // the page scrolled): the fixed panel height can clip the non-thread children once the
    // thread has shrunk to 0, so the box's overflow-y:auto fallback must let them be scrolled
    // to. A9a first asserts the overflow was genuinely created (so A9b is not vacuous), then
    // A9b asserts the box scrolls and the composer is reachable; toggling overflow-y off would
    // red A9b, which is the within-fix control. ---
    await page.setViewportSize({ width: 1400, height: 440 });
    await page.evaluate(() => {
      const q = document.getElementById('d-qask');
      if (q) {
        q.hidden = false;
        const lab = document.getElementById('d-qask-lab');
        if (lab) lab.textContent = 'The agent is asking you something';
        const txt = document.getElementById('d-qask-text');
        // #3385: the talk box now fills the full height (the header moved to the left column), so
        // it is much taller -- inject enough to still overflow it, or A9a's control goes vacuous.
        if (txt) { txt.hidden = false; txt.textContent = Array.from({ length: 60 }, (_, i) => 'command line ' + i).join('\n'); }
        const opts = document.getElementById('d-qopts');
        if (opts) { opts.hidden = false; opts.innerHTML = Array.from({ length: 24 }, (_, i) => '<button class="btn">Option ' + i + '</button>').join(''); }
      }
    });
    await page.waitForTimeout(150);
    const qask = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const box = document.getElementById('d-talk-box');
      const composer = document.querySelector('#d-talk-box .dmbar.composerbox');
      const overflows = box.scrollHeight > box.clientHeight + 4;
      box.scrollTop = box.scrollHeight;               // scroll the box to its foot
      const br = box.getBoundingClientRect();
      const cr = composer.getBoundingClientRect();
      return { overflows, overflowY: getComputedStyle(box).overflowY, composerWithinBox: cr.bottom <= br.bottom + 4 };
    });
    console.log('MEASURE qask-short(1400x440): ' + JSON.stringify(qask));
    chk(qask.overflows === true,
      'A9a the injected live question genuinely overflows the fixed-height box (so A9b is not vacuous)',
      'overflows=' + qask.overflows + ' (box scrollHeight > clientHeight)');
    chk(qask.overflowY === 'auto' && qask.composerWithinBox,
      'A9b the box scrolls so the composer stays reachable when a live question overflows',
      'overflowY=' + qask.overflowY + ' composerWithinBox=' + qask.composerWithinBox);

    // Clear the injected question so the scoping guard below sees a normal talk section.
    await page.evaluate(() => { const q = document.getElementById('d-qask'); if (q) q.hidden = true; });

    // --- Scoping guard: a non-Talk section (Model) is NOT forced tall ---
    await page.setViewportSize({ width: 1400, height: 1100 });
    await page.click('#panel-detail .snav button[data-go="model"]');
    await page.waitForSelector('#d-sec-model:not([hidden])');
    await page.waitForTimeout(200);
    const model = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const sec = document.getElementById('d-sec-model');
      const r = sec.getBoundingClientRect();
      return { innerHeight: window.innerHeight, secBottom: Math.round(r.bottom), secHeight: Math.round(r.height) };
    });
    console.log('MEASURE model section: ' + JSON.stringify(model));
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
