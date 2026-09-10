'use strict';

/**
 * kosmos#2350 (Josh, 2026-09-06): the multi-Kosmos switcher control on the header icon
 * row is the SAME HEIGHT as the light/dark switcher (.themepick), so the two read as a
 * matched set. Before the fix the switcher button was content-height-driven (~25px) while
 * the theme control renders 32px -- a visible ~7px mismatch on the row.
 *
 * This measures both controls' RENDERED heights in a real DOM and asserts they are equal.
 * Keying on the actual rendered height (not the CSS text) is what makes it a real match:
 * both controls carry the same 0.5px border + radius-control, so equality of the rendered
 * boxes is exactly "same height on the row". Because it compares the two live values rather
 * than a hardcoded pixel count, a future change to EITHER control re-surfaces here instead
 * of drifting silently.
 *
 * CONTROL: on the pre-fix page (no explicit height on .worldsw-btn) the switcher measures
 * ~25px against the theme control's 32px, so the equality assertion reds.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-worldsw-height-2350.js
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-worldsw-height-2350: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-worldsw-height-2350: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }

  const problems = [];
  // Measure at both device pixel ratios: the 0.5px control border rounds to a device pixel,
  // so a match must hold at DPR 1 AND on a retina (DPR 2) Mac, which is what Josh sees.
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    await page.goto('file://' + PAGE);
    const r = await page.evaluate(() => {
      // The switcher is hidden until the person has multiple worlds; reveal it and give it a
      // name so it lays out exactly as it does in the header.
      const sw = document.getElementById('worldsw'); if (sw) sw.hidden = false;
      const nm = document.getElementById('worldsw-name'); if (nm) nm.textContent = 'Client work';
      const themepick = document.querySelector('.themepick');
      const worldswBtn = document.getElementById('worldsw-btn');
      if (!themepick) return { error: 'no .themepick (light/dark switcher) on the page' };
      if (!worldswBtn) return { error: 'no #worldsw-btn (multi-Kosmos switcher) on the page' };
      const h = (e) => +e.getBoundingClientRect().height.toFixed(2);
      return { themepick: h(themepick), worldswBtn: h(worldswBtn) };
    });
    await page.close();
    if (r.error) { problems.push(r.error); continue; }
    console.log('  DPR ' + dpr + ' -> ' + JSON.stringify(r));
    if (r.worldswBtn !== r.themepick) {
      problems.push('DPR ' + dpr + ': the multi-Kosmos switcher (' + r.worldswBtn + 'px) is a different height from the light/dark switcher (' + r.themepick + 'px) -- Josh #2350 wants them matched on the header row');
    }
  }

  await browser.close();

  if (problems.length) {
    console.error('render-worldsw-height-2350: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-worldsw-height-2350: the multi-Kosmos switcher control is the same rendered height as the light/dark switcher on the header row (DPR 1 + 2).');
})();
