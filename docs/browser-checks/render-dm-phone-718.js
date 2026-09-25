// Browser-check-surface: d-dmthread msg-b msg-bd msg-av att-name att-pic mdtablewrap mdtable
'use strict';

/**
 * #718 (Josh, 2026-09-24: "pay close attention to make sure the designs fit well on mobile").
 * The single-agent DM at real phone widths, on the REAL rendered thread:
 *   - no bubble starts off the left edge or ends past the right edge of its row. Before this,
 *     a message carrying attachment cards sat 112px off the left of an iPhone SE: the file
 *     name is one line, the person's bubble is sized to its content, so the name set the
 *     bubble's width. It happens in any row narrower than the bubble's 78ch cap plus gutters,
 *     so the same arm runs at 900 (red on origin/main) and 1280 (green there too: the 78ch
 *     cap already binds) with a 120-character file name. The fix under test is the cap on the
 *     person's bubble (removing only that cap fails this arm);
 *   - every attachment card sits inside its own bubble, pictures included (a companion invariant:
 *     on the old code the bubble grew with the card, so it is the row assertion above that catches
 *     the defect), and its file name stays on one line;
 *   - no table cell is narrower than its longest word (the thread's `overflow-wrap: anywhere`
 *     crushed them to a letter per line), and the table's scroll box stays inside its bubble. The
 *     "ID" column's body words are wider than its header, so the cell check fails on the
 *     overflow-wrap rule alone; with short body words the headers' nowrap would mask its removal;
 *   - neither the page nor the thread's own scroll box scrolls sideways;
 *   - on a phone the gutter opposite each avatar equals the avatar plus its gap (#3340), measured;
 *   - the bubble tail's ground mask never reaches the avatar (it paints the thread ground over it);
 *   - a wide table on the PERSON's own row stays inside its bubble too (their bubble is sized to
 *     its content in a right-aligned column, the same shape that sent attachments off screen);
 *   - at 1280 the person's short-named attachment bubble still fits its content, not the whole row
 *     (the rejected alternative stretched that bubble).
 * Viewport widths, not mobile emulation (no isMobile/touch); scrollbars are shown so the wide
 * arms are not optimistic about the thread's width.
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
    { from: 'april', at: at(1), text: 'Results by size:\n\n| Device | Width | Height | Composer visible | ID |\n|---|---|---|---|---|\n| iPhone SE | 375 | 667 | yes | STAGINGBUILD20260924A |\n| Pro Max | 430 | 932 | yes | RELEASEBUILD20260924B |' },
    { at: at(2), text: 'here are the screenshots', delivery: { state: 'placed' }, attachments: [
      { url: '/api/f/1', name: 'IMG_2041.png', kind: 'image', type: 'image/png', size: 845000, preview: '/api/f/1/preview' },
      { url: '/api/f/2', name: 'quarterly-board-report-final-v3-really-final.pdf', kind: 'pdf', type: 'application/pdf', size: 2300000, preview: '/api/f/2/preview' } ] },
    { at: at(6), text: 'and one more', delivery: { state: 'placed' }, attachments: [
      { url: '/api/f/5', name: 'notes.txt', kind: 'text', type: 'text/plain', size: 900 } ] },
    { from: 'april', at: at(3), text: 'got them', attachments: [
      { url: '/api/f/3', name: 'annotated.png', kind: 'image', type: 'image/png', size: 120000 } ] },
    { at: at(4), text: 'and the export', delivery: { state: 'placed' }, attachments: [
      { url: '/api/f/4', name: 'board-export-' + 'x'.repeat(103) + '.csv', kind: 'other', type: 'text/csv', size: 4096 } ] },
    { at: at(5), text: 'my numbers:\n\n| Device | Width | Height | Engine | Theme | Composer | Keyboard |\n|---|---|---|---|---|---|---|\n| iPhone SE | 375 | 667 | WebKit | dark | visible | covered |', delivery: { state: 'placed' } },
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
    for (const word of c.textContent.split(/\s+/).filter(Boolean)) {
      probe.textContent = word; widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    probe.textContent = '';
    c.removeChild(probe);
    const inner = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (inner + 1 < widest) crushed.push(`"${c.textContent.trim()}" ${Math.round(inner)}<${Math.round(widest)}`);
  });
  /* Josh's #3340 rule on the narrowed phone gutters: the space reserved OPPOSITE the avatar
     equals the near side (avatar + gap), measured, so editing one literal without the other reds. */
  const gutterMismatch = [...document.querySelectorAll('#d-dmthread .msg')].filter((row) => {
    const b = row.querySelector('.msg-b');
    if (!b) return true; // a row with no body is a shape this check does not understand: fail loudly
    const r = R(row); const rb = R(b); const cs = getComputedStyle(b);
    const near = row.classList.contains('you') ? r.right - rb.right : rb.left - r.left;
    const far = parseFloat(row.classList.contains('you') ? cs.marginLeft : cs.marginRight);
    return Math.abs(near - far) > 0.5;
  }).length;
  /* The bubble tail's ground mask (.msg-bd::after) sits beside the bubble on the avatar side and
     is painted in the thread's ground colour; if it reaches the avatar it paints over it. */
  const maskOverAvatar = [...document.querySelectorAll('#d-dmthread .msg')].filter((row) => {
    const av = row.querySelector('.msg-av'); const bd = row.querySelector('.msg-bd');
    if (!av || !bd) return false;
    const mask = parseFloat(getComputedStyle(bd, '::after').width) || 0;
    const gap = row.classList.contains('you') ? R(av).left - R(bd).right : R(bd).left - R(av).right;
    return gap + 0.5 < mask;
  }).length;
  /* A file name reads as one line (ellipsized when it does not fit). Containment alone would
     stay green if a later change let the name wrap to many lines, so the line count is its own
     assertion. */
  const namesOverOneLine = [...document.querySelectorAll('#d-dmthread .att-name')].filter((n) =>
    R(n).height > parseFloat(getComputedStyle(n).fontSize) * 1.5).length;
  const wraps = [...document.querySelectorAll('#d-dmthread .mdtablewrap')];
  /* The person's own short-named card: their bubble is the one this branch caps, so it is the one
     that must still fit its content rather than stretch to the row. */
  const short = [...document.querySelectorAll('#d-dmthread .msg.you .att')].find((a) => /notes\.txt/.test(a.textContent));
  return {
    bubbles: bubbles.length, offscreen, cards: cards.length, escaped,
    pics: [...document.querySelectorAll('#d-dmthread .att .att-pic')].filter((e) => { const r = R(e); const c = R(e.closest('.att')); return r.width > 0 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5; }).length, // height follows the image, which cannot load over file://
    cells: cellsList.length, crushed,
    tableInBubble: wraps.length === 2 && wraps.every((tw) => {
      const b = R(tw.closest('.msg-bd')); return R(tw).left >= b.left - 0.5 && R(tw).right <= b.right + 0.5; }),
    pageHScroll: document.documentElement.scrollWidth > vw,
    threadHScroll: (() => { const t = document.getElementById('d-dmthread'); return t.scrollWidth > t.clientWidth + 1; })(),
    tablesOnYou: document.querySelectorAll('#d-dmthread .msg.you .mdtablewrap').length,
    gutterMismatch, maskOverAvatar, namesOverOneLine,
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
  await page.waitForSelector('#d-dmthread .msg');
  return { page, errs };
}

(async () => {
  for (const eng of (process.env.ENGINES || 'chromium').split(',')) {
    const browser = await pw[eng].launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: eng === 'chromium' ? ['--hide-scrollbars'] : [] });
    try {
      for (const [w, h] of SIZES) for (const theme of ['light', 'dark']) {
        const { page, errs } = await open(browser, w, h, theme);
        const m = await page.evaluate(measure);
        const t = `[${eng} ${w}x${h} ${theme}]`;
        chk(m.bubbles >= 7 && m.offscreen === 0, `${t} every bubble stays inside its row`, `bubbles=${m.bubbles} offscreen=${m.offscreen}`);
        chk(m.cards === 5 && m.escaped === 0, `${t} every attachment card sits inside its bubble`, `cards=${m.cards} escaped=${m.escaped}`);
        chk(m.namesOverOneLine === 0, `${t} every file name stays on one line`, `over=${m.namesOverOneLine}`);
        chk(m.pics === 2, `${t} the preview slots have width inside their cards (the images themselves cannot load over file://, so an image slot has no height)`, `pics=${m.pics}`);
        chk(m.cells > 0 && m.crushed.length === 0, `${t} no table cell is narrower than its longest word`, m.crushed.join(' | '));
        chk(m.tablesOnYou === 1 && m.tableInBubble, `${t} both tables' scroll boxes (the agent's and the person's own) stay inside their bubbles`);
        chk(!m.pageHScroll && !m.threadHScroll, `${t} neither the page nor the thread scrolls sideways`, `page=${m.pageHScroll} thread=${m.threadHScroll}`);
        chk(m.gutterMismatch === 0, `${t} the gutter opposite the avatar equals avatar + gap (#3340)`, `mismatched rows=${m.gutterMismatch}`);
        chk(m.maskOverAvatar === 0, `${t} the bubble tail's ground mask does not reach the avatar`, `rows=${m.maskOverAvatar}`);
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
        chk(m.bubbles >= 7 && m.cards === 5 && m.offscreen === 0 && m.escaped === 0, `${t} every bubble and card stays inside its row`, `bubbles=${m.bubbles} cards=${m.cards} offscreen=${m.offscreen} escaped=${m.escaped}`);
        chk(m.namesOverOneLine === 0, `${t} every file name stays on one line`, `over=${m.namesOverOneLine}`);
        chk(m.shortCardBubble !== null && m.shortCardBubble < m.row * 0.8, `${t} the person's short-named attachment bubble fits its content, not the whole row`, `bubble=${m.shortCardBubble} row=${m.row}`);
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
