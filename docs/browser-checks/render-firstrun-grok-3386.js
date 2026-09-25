'use strict';
// Browser-check-surface: data-pmark="xai"
// (#2518) the distinctive web/index.html token this check asserts: Grok's first-run vendor mark
// (#3708, the real Grok mark; it was an "X" letter chip before). A change to it must update this check.
/* #3386 (Josh, feedback 2026-09-21): xAI Grok shown up front on the first-run model screen as a
 * "coming soon" tile, grouped with Gemini (the other connectable-but-not-yet cloud provider) before
 * the on-your-computer tier. #3708: it now wears the real Grok mark (grok.com's own header logo,
 * recorded in docs/provider-marks/manifest.md), which the Settings pickers clone too. This drives the SHIPPED
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
      /* #3658: Grok is a connectable (.llm.on) row now, so it is looked up among ALL rows. */
      const tiles = [...(pane ? pane.querySelectorAll('.llm.off') : [])];
      const rows = [...(pane ? pane.querySelectorAll('.llm') : [])];
      const nameOf = (tile) => { const b = tile.querySelector('.llm-w b'); return b ? b.textContent : null; };
      const grok = rows.find((el) => nameOf(el) === 'Grok') || null;
      const kids = pane ? [...pane.querySelectorAll('.llm, .smore-t')] : [];
      const idxName = (nm) => kids.findIndex((k) => k.classList.contains('llm') && (k.querySelector('.llm-w b') || {}).textContent === nm);
      const dividerIdx = kids.findIndex((k) => k.classList.contains('smore-t'));
      const mark = grok ? grok.querySelector('.llm-m') : null;
      const box = mark ? mark.getBoundingClientRect() : null;
      /* #3708: the Settings pickers clone this mark through providerMarkNode, keyed 'xai'. */
      const picked = typeof providerMarkNode === 'function' ? providerMarkNode('xai', 'xAI Grok') : null;
      return {
        paneFound: !!pane,
        offCount: tiles.length,
        hasGrok: !!grok,
        grokCompany: grok ? (grok.querySelector('.llm-w small') || {}).textContent : null,
        grokSoon: grok ? !!grok.querySelector('.soon') : false,
        grokOn: grok ? grok.classList.contains('on') : false,
        grokConnect: grok && grok.querySelector('.connect-b') ? grok.querySelector('.connect-b').id : null,
        markText: mark ? (mark.textContent || '').trim() : null,
        markPmark: mark ? mark.classList.contains('pmark') && mark.getAttribute('data-pmark') === 'xai' : false,
        markPaths: mark ? mark.querySelectorAll('svg path').length : 0,
        markChip: grok ? !!grok.querySelector('.llm-chip') : null,
        markVisible: mark ? mark.offsetParent !== null && box.width > 8 && box.height > 8 : false,
        pickerSvg: picked ? !!picked.querySelector('svg path') : null,
        pickerChip: picked ? picked.classList.contains('pcombo-chip') : null,
        geminiIdx: idxName('Gemini'),
        grokIdx: idxName('Grok'),
        dividerIdx,
      };
    });

    ok(t + ' #3386 fr-pane-5 (the model step) is present', res.paneFound === true, JSON.stringify(res));
    /* #3658 (superseding #3566's "After setup"): Grok connects on this step, with a gold Connect and no pill. */
    ok(t + ' #3386/#3658 a Grok / xAI row is in the model step and connects right here', res.hasGrok === true && /^xAI\b/.test(res.grokCompany || '') && res.grokOn === true && res.grokSoon === false && res.grokConnect === 'fr-grok-connect', JSON.stringify(res));
    ok(t + ' #3708 Grok wears its real vendor mark (an inlined SVG), not the old "X" letter chip', res.markPmark === true && res.markPaths === 2 && res.markChip === false && res.markText === '', JSON.stringify(res));
    ok(t + ' #3708 the Settings pickers get the same Grok mark, not a letter chip', res.pickerSvg === true && res.pickerChip === false, JSON.stringify(res));
    ok(t + ' #3708 Grok names how it connects (not "works today": its tool is not installed by Kosmos yet)', res.grokCompany === 'xAI \u00b7 subscription or API key today', JSON.stringify(res));
    ok(t + ' #3386/#3658 Grok sits right under Gemini, in one list with no tier divider', res.geminiIdx >= 0 && res.grokIdx === res.geminiIdx + 1 && res.dividerIdx === -1, JSON.stringify(res));
    ok(t + ' #3658 seven not-yet-available tiles in the model step', res.offCount === 7, JSON.stringify(res));
    // Visual: only meaningful if the pane actually laid out (file:// nav can bail). This is a flat
    // assertion harness with no real gating, so the two arms below are companion diagnostics, not a
    // gate: if the pane did not lay out BOTH fail, and the first tells you WHY (not laid out) vs the
    // second (laid out but wrong glyph). Kept because that split is worth having when one goes red.
    ok(t + ' #3708 the Grok mark is laid out at a real size (diagnostic: if this fails the pane did not render)', res.markVisible === true, JSON.stringify(res));

    await page.close();
  }
  await browser.close();

  if (problems.length) {
    // Each problem on its own `FAIL`-prefixed line so tools/browser-checks.sh's run_one can
    // grep the reason out of the captured log and name the failing assertion, instead of the
    // unquotable `problems:\n  ...` blob that surfaces only "(no FAIL or error line)".
    for (const p of problems) console.error('  FAIL  ' + p);
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
