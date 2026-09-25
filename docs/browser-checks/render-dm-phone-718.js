// Browser-check-surface: d-dmthread msg msg-b msg-bd att mdtablewrap mdtable
'use strict';

/**
 * #718 (Josh, 2026-09-24: "pay close attention to make sure the designs fit well on mobile").
 * The single-agent DM at real phone widths, on the REAL rendered thread:
 *   - no bubble starts off the left edge or ends past the right edge of its row. Before this,
 *     a message carrying attachment cards sat 112px off the left of an iPhone SE: the file
 *     name is one unbreakable line, so it set the bubble's minimum width. The same arm runs at
 *     900 and 1280 with a 120-character file name, because the cause does not depend on width;
 *   - every attachment card sits inside its own bubble, pictures included;
 *   - no table cell is narrower than its longest word (the thread's `overflow-wrap: anywhere`
 *     crushed them to a letter per line), and the table's scroll box stays inside its bubble;
 *   - the page itself never scrolls sideways;
 *   - at 1280 a short-named attachment bubble still fits its content, not the whole row.
 *
 * Harness posture mirrors render-agentdm-3414.js: file://, the thread poll answered from a
 * fixture, CURRENT set through openDetail. No board and no real conversation are involved.
 * Chromium, plus WebKit when ENGINES includes it. WebKit here is an ENGINE approximation, not
 * Safari.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-dm-phone-718.js
 *   ENGINES=chromium,webkit ... for both engines. The gate (tools/browser-checks.sh) runs it
 *   without ENGINES, so the gate covers Chromium only; WebKit is a by-hand run.
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
      { url: '/api/f/1', name: 'IMG_2041.png', kind: 'image', type: 'image/png', size: 845000, preview: '/api/f/1/preview' },
      { url: '/api/f/2', name: 'quarterly-board-report-final-v3-really-final.pdf', kind: 'pdf', type: 'application/pdf', size: 2300000, preview: '/api/f/2/preview' } ] },
    { from: 'april', at: at(3), text: 'got them', attachments: [
      { url: '/api/f/3', name: 'annotated.png', kind: 'image', type: 'image/png', size: 120000 } ] },
    { at: at(4), text: 'and the export', delivery: { state: 'placed' }, attachments: [
      { url: '/api/f/4', name: 'board-export-' + 'x'.repeat(100) + '.csv', kind: 'other', type: 'text/csv', size: 4096 } ] },
  ],
  olderCount: 0, historyBecause: null, historyUnfilable: false,
  presence: 'on', presenceBecause: null, asking: false, question: null, questionBecause: null, options: null,
};
const SIZES = [[375, 667], [393, 852], [412, 915], [430, 932]];
const WIDE = [[900, 900], [1280, 900]];

/* Runs in the page. Geometry only: what a person would see, not the CSS that produced it. */
function measure() {
  const vw = document.documentElement.clientWidth;
  const R = (e) => e.getBoundingClientRect();
  const bubbles = [...document.querySelectorAll('#d-dmthread .msg-bd')];
  const offscreen = bubbles.filter((b) => {
    const row = R(b.closest('.msg')); const r = R(b);
    return r.left < Math.max(0, row.left) - 0.5 || r.right > Math.min(vw, row.right) + 0.5;
  }).length;
  const cards = [...document.querySelectorAll('#d-dmthread .att')];
  const escaped = cards.filter((a) => {
    const b = R(a.closest('.msg-bd')); const r = R(a);
    return r.left < b.left - 0.5 || r.right > b.right + 0.5;
  }).length;
  /* A cell is crushed when its content box is narrower than the widest single word it holds. */
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
  const crushed = [];
  const cellsList = [...document.querySelectorAll('#d-dmthread .mdtable th, #d-dmthread .mdtable td')];
  cellsList.forEach((c) => {
    const cs = getComputedStyle(c);
    probe.style.font = cs.font;
    c.appendChild(probe);
    let widest = 0;
    for (const word of c.textContent.replace(probe.textContent, '').split(/\s+/).filter(Boolean)) {
      probe.textContent = word; widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    probe.textContent = '';
    c.removeChild(probe);
    const inner = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (inner + 1 < widest) crushed.push(`"${c.textContent.trim()}" ${Math.round(inner)}<${Math.round(widest)}`);
  });
  const tw = document.querySelector('#d-dmthread .mdtablewrap');
  const twb = tw && R(tw.closest('.msg-bd'));
  const short = document.querySelector('#d-dmthread .msg:not(.you) .att');
  return {
    bubbles: bubbles.length, offscreen, cards: cards.length, escaped,
    pics: document.querySelectorAll('#d-dmthread .att .att-pic').length,
    cells: cellsList.length, crushed,
    tableInBubble: !!tw && R(tw).left >= twb.left - 0.5 && R(tw).right <= twb.right + 0.5,
    pageHScroll: document.documentElement.scrollWidth > vw,
    shortCardBubble: short ? Math.round(R(short.closest('.msg-bd')).width) : null,
    row: short ? Math.round(R(short.closest('.msg')).width) : null,
  };
}

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
        const m = await page.evaluate(measure);
        const t = `[${eng} ${w}x${h} ${theme}]`;
        chk(m.bubbles >= 5 && m.offscreen === 0, `${t} every bubble stays inside its row`, `bubbles=${m.bubbles} offscreen=${m.offscreen}`);
        chk(m.cards === 4 && m.escaped === 0, `${t} every attachment card sits inside its bubble`, `cards=${m.cards} escaped=${m.escaped}`);
        chk(m.pics === 2, `${t} the picture previews render as cards`, `pics=${m.pics}`);
        chk(m.cells > 0 && m.crushed.length === 0, `${t} no table cell is narrower than its longest word`, m.crushed.join(' | '));
        chk(m.tableInBubble, `${t} the table's scroll box stays inside its bubble`);
        chk(!m.pageHScroll, `${t} the page does not scroll sideways`);
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
      // Wider windows: the cause (a file name that cannot break) does not depend on width, so the
      // 120-character name must stay inside its row here too, and a short-named card's bubble still
      // fits its content rather than the whole row.
      for (const [w, h] of WIDE) {
        const { page, errs } = await open(browser, w, h, 'light');
        const m = await page.evaluate(measure);
        const t = `[${eng} ${w}x${h}]`;
        chk(m.offscreen === 0 && m.escaped === 0, `${t} every bubble and card stays inside its row`, `offscreen=${m.offscreen} escaped=${m.escaped}`);
        chk(m.shortCardBubble < m.row * 0.8, `${t} a short-named attachment bubble fits its content, not the whole row`, `bubble=${m.shortCardBubble} row=${m.row}`);
        chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
  if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(1); });
