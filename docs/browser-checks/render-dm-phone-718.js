// Browser-check-surface: d-dmthread msg msg-b msg-bd att mdtablewrap mdtable
'use strict';

/**
 * #718 (Josh, 2026-09-24: "pay close attention to make sure the designs fit well on mobile").
 * The single-agent DM at real phone widths, on the REAL rendered thread:
 *   - no bubble starts off the left edge or ends past the right edge of the screen. Before this,
 *     a message carrying attachment cards sat 112px off the left of an iPhone SE: the card is
 *     `width: min(100%, 34rem)` and 100% resolved against a caption-wide bubble;
 *   - every attachment card sits INSIDE its own bubble;
 *   - a markdown table keeps word-wrapped cells (its min-content is not one character, which
 *     is what the thread's `overflow-wrap: anywhere` did) and scrolls inside .mdtablewrap;
 *   - the page itself never scrolls sideways;
 *   - and at 1280 the attachment bubble keeps its desktop width (the fix is narrow-only).
 *
 * Harness posture mirrors render-agentdm-3414.js: file://, the thread poll answered from a
 * fixture, CURRENT set through openDetail. No board and no real conversation are involved.
 * Chromium, plus WebKit when ENGINES includes it. WebKit here is an ENGINE approximation, not
 * Safari.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-phone-718.js
 *   ENGINES=chromium,webkit ... for both engines.
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const fail = [];
const chk = (ok, label, extra) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

const at = (i) => new Date(Date.now() - (60 - i) * 60e3).toISOString();
const FX = {
  messages: [
    { from: 'april', at: at(0), text: 'ready when you are.' },
    { from: 'april', at: at(1), text: 'Results by size:\n\n| Device | Width | Height | Composer visible |\n|---|---|---|---|\n| iPhone SE | 375 | 667 | yes |\n| Pro Max | 430 | 932 | yes |' },
    { at: at(2), text: 'here are the screenshots', delivery: { state: 'placed' }, attachments: [
      { url: '/api/f/1', name: 'IMG_2041.png', kind: 'image', type: 'image/png', size: 845000 },
      { url: '/api/f/2', name: 'quarterly-board-report-final-v3-really-final.pdf', kind: 'pdf', type: 'application/pdf', size: 2300000 } ] },
    { from: 'april', at: at(3), text: 'got them', attachments: [
      { url: '/api/f/3', name: 'annotated.png', kind: 'image', type: 'image/png', size: 120000 } ] },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};
const SIZES = [[375, 667], [393, 852], [412, 915], [430, 932]];

async function open(browser, w, h, theme) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url) => (String(url).includes('/thread') ? enc(window.__fx) : enc({}));
  });
  await page.goto(PAGE);
  await page.evaluate((f) => {
    window.__fx = f;
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    LAST = [{ sessionName: 'april', name: 'April' }];
    openDetail('april', 'talk');
  }, FX);
  await page.evaluate(() => paintTalk('april', 'April'));
  await page.waitForTimeout(200);
  return { page, errs };
}

(async () => {
  for (const eng of (process.env.ENGINES || 'chromium').split(',')) {
    const browser = await pw[eng].launch({ headless: process.env.HEADED === '0' });
    try {
      for (const [w, h] of SIZES) for (const theme of ['light', 'dark']) {
        const { page, errs } = await open(browser, w, h, theme);
        const m = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const R = (e) => e.getBoundingClientRect();
          const bubbles = [...document.querySelectorAll('#d-dmthread .msg-bd')];
          const offscreen = bubbles.filter((b) => R(b).left < 0 || R(b).right > vw + 0.5).length;
          const cards = [...document.querySelectorAll('#d-dmthread .att')];
          const escaped = cards.filter((a) => {
            const b = R(a.closest('.msg-bd')); const r = R(a);
            return r.left < b.left - 0.5 || r.right > b.right + 0.5;
          }).length;
          const tw = document.querySelector('#d-dmthread .mdtablewrap');
          const td = tw && tw.querySelector('td');
          return {
            bubbles: bubbles.length, offscreen, cards: cards.length, escaped,
            tableScrolls: !!tw && tw.scrollWidth > tw.clientWidth && getComputedStyle(tw).overflowX === 'auto',
            cellMinChars: td ? getComputedStyle(td).overflowWrap : null,
            thNowrap: tw ? getComputedStyle(tw.querySelector('th')).whiteSpace : null,
            pageHScroll: document.documentElement.scrollWidth > vw,
          };
        });
        const t = `[${eng} ${w}x${h} ${theme}]`;
        chk(m.bubbles >= 4 && m.offscreen === 0, `${t} every bubble is on screen`, `bubbles=${m.bubbles} offscreen=${m.offscreen}`);
        chk(m.cards === 3 && m.escaped === 0, `${t} every attachment card sits inside its bubble`, `cards=${m.cards} escaped=${m.escaped}`);
        chk(m.cellMinChars !== 'anywhere', `${t} table cells wrap at words, not per character`, `overflow-wrap=${m.cellMinChars}`);
        chk(m.thNowrap === 'nowrap', `${t} table headers stay on one line`);
        chk(m.tableScrolls, `${t} the wide table scrolls inside its wrapper`);
        chk(!m.pageHScroll, `${t} the page does not scroll sideways`);
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
      // Desktop: the narrow-only fix must not widen the attachment bubble.
      const { page } = await open(browser, 1280, 900, 'light');
      const d = await page.evaluate(() => {
        const a = document.querySelector('#d-dmthread .msg.you .att');
        const b = a.closest('.msg-bd').getBoundingClientRect();
        const row = a.closest('.msg-b').parentElement.getBoundingClientRect();
        return { bubble: Math.round(b.width), row: Math.round(row.width) };
      });
      chk(d.bubble < d.row * 0.6, `[${eng} 1280] the attachment bubble keeps its desktop width, not the whole row`, JSON.stringify(d));
      await page.close();
    } finally {
      await browser.close();
    }
  }
  if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
