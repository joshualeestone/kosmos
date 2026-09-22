'use strict';
// Browser-check-surface: llm-chip
// (#2518) the distinctive web/index.html token this check asserts: the first-run initial-letter
// mark class used for Grok (which has no vendor SVG). A change to it must update this check.
/* #3386 (Josh, feedback 2026-09-21): xAI Grok shown up front on the first-run model screen as a
 * "coming soon" tile, grouped with Gemini (the other connectable-but-not-yet cloud provider) before
 * the on-your-computer tier. xAI has no vendor SVG in this file, so it uses the same "X" initial-
 * letter chip the provider combobox falls back to, not a new brand asset. This drives the SHIPPED
 * first-run model pane (fr-pane-5) and asserts the tile's presence, mark, order and count.
 *
 * Run: NODE_PATH=$HOME/work/pw-runtime/node_modules node docs/browser-checks/render-firstrun-grok-3386.js
 *      (HEADED=0 on a machine with no console session)
 */
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme: theme });
    page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`));
    await page.addInitScript(() => { window.setInterval = () => 0; });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const x = m.text();
      if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
      problems.push(`[${theme}] console: ${x}`);
    });
    const t = `[${theme}]`;

    // Deep-link straight to the model pane (fr-pane-5), then belt-and-braces reveal it so the
    // chip is laid out even if a file:// fetch bailed firstrun's own nav. The DOM assertions do
    // not need layout; only the chip-visible assertion does, and it is gated on a fixture check.
    await page.goto(PAGE + '?first-run=1&fr-step=5');
    const res = await page.evaluate(() => {
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = false;
      const pane = document.getElementById('fr-pane-5'); if (pane) pane.hidden = false;
      const tiles = [...(pane ? pane.querySelectorAll('.llm.off') : [])];
      const nameOf = (tile) => { const b = tile.querySelector('.llm-w b'); return b ? b.textContent : null; };
      const grok = tiles.find((el) => nameOf(el) === 'Grok') || null;
      const kids = pane ? [...pane.querySelectorAll('.llm, .smore-t')] : [];
      const idxName = (nm) => kids.findIndex((k) => k.classList.contains('llm') && (k.querySelector('.llm-w b') || {}).textContent === nm);
      const dividerIdx = kids.findIndex((k) => k.classList.contains('smore-t'));
      const mark = grok ? grok.querySelector('.llm-chip') : null;
      return {
        paneFound: !!pane,
        offCount: tiles.length,
        hasGrok: !!grok,
        grokCompany: grok ? (grok.querySelector('.llm-w small') || {}).textContent : null,
        grokSoon: grok ? !!grok.querySelector('.soon') : false,
        markText: mark ? (mark.textContent || '').trim() : null,
        markHasSvg: mark ? !!mark.querySelector('svg') : null,
        markVisible: mark ? mark.offsetParent !== null : false,
        geminiIdx: idxName('Gemini'),
        grokIdx: idxName('Grok'),
        dividerIdx,
      };
    });

    ok(t + ' #3386 fr-pane-5 (the model step) is present', res.paneFound === true, JSON.stringify(res));
    ok(t + ' #3386 a Grok / xAI "coming soon" tile is in the model step', res.hasGrok === true && res.grokCompany === 'xAI' && res.grokSoon === true, JSON.stringify(res));
    ok(t + ' #3386 Grok uses the "X" initial-letter chip, not a (wrong-brand) SVG', res.markText === 'X' && res.markHasSvg === false, JSON.stringify(res));
    ok(t + ' #3386 Grok is grouped with Gemini before the "Runs on this computer" divider', res.geminiIdx >= 0 && res.grokIdx === res.geminiIdx + 1 && res.dividerIdx > res.grokIdx, JSON.stringify(res));
    ok(t + ' #3386 nine coming-soon tiles in the model step (Gemini + Grok + seven)', res.offCount === 9, JSON.stringify(res));
    // Visual: only meaningful if the pane actually laid out (file:// nav can bail). Fixture-sanity
    // first, so a not-laid-out pane is distinguishable from a real render failure.
    ok(t + ' #3386 fixture sanity: the Grok chip is laid out (else the render assertion is inconclusive)', res.markVisible === true, JSON.stringify(res));
    ok(t + ' #3386 the Grok chip renders (visible "X")', res.markVisible === true && res.markText === 'X', JSON.stringify(res));

    await page.close();
  }
  await browser.close();

  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
