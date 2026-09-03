'use strict';

/**
 * kosmos#2066: the board's build marker renders the version in the persistent
 * chrome, and carries the channel by WEIGHT -- a small dim version string on prod,
 * a loud coloured STAGING badge on staging -- so "which build, and staging or prod"
 * is answerable from a problem screenshot without asking.
 *
 * ⚠️ WHY A BROWSER. `web.build-marker-2066.test.js` asserts paintBuildMark's SOURCE
 * emits the right class/text per channel. It cannot prove the badge actually RENDERS
 * with the staging TREATMENT -- the #1720 gap (a guard green while the page breaks).
 * The load-bearing assertion is COMPUTED-STYLE, not a class name: the staging badge's
 * background must be a real fill (non-transparent) AND differ from prod's, and its
 * ink must differ from prod's. A phantom class or a missing --stag token reds this.
 * The default-channel case (undefined) must render as PROD, and no-version must hide,
 * so a corrupt or absent signal can never paint a loud STAGING badge on a prod board.
 *
 * Control: on origin/main neither `paintBuildMark` nor `#buildmark` exists, so the
 * first two problems fire and the check reds -- it cannot pass against pre-#2066 code.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-build-marker-2066.js
 *
 * ⚠️ HEADED by default, matching the other checks here. HEADED=0 on a machine with no
 * console session; the verdicts are the same -- this asserts computed DOM, not pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-build-marker-2066: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-build-marker-2066: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    if (typeof paintBuildMark !== 'function') return { error: 'paintBuildMark is not a function' };
    const el = document.getElementById('buildmark');
    if (!el) return { error: '#buildmark element is missing' };
    const read = () => {
      const cs = getComputedStyle(el);
      return {
        hidden: !!el.hidden,
        cls: el.className || '',
        text: (el.textContent || '').trim(),
        title: el.title || '',
        color: cs.color,
        bg: cs.backgroundColor,
        borderColor: cs.borderTopColor,
        hasVerSpan: !!el.querySelector('.bm-v'),
      };
    };
    paintBuildMark('0.6.26', 'prod');       const prod = read();
    paintBuildMark('0.6.27', 'staging');    const staging = read();
    paintBuildMark('0.6.26', undefined);    const dflt = read();
    paintBuildMark(null, 'staging');        const empty = read();
    return { prod, staging, dflt, empty };
  });

  await browser.close();

  const problems = [];
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';
  if (r.error) {
    problems.push(r.error);
  } else {
    const { prod, staging, dflt, empty } = r;

    // Prod: visible, dim version string, no staging treatment.
    if (prod.hidden) problems.push('prod: marker is hidden but should show the version');
    if (prod.cls.indexOf('staging') !== -1) problems.push('prod: has the staging class but should not');
    if (prod.text !== 'v0.6.26') problems.push('prod: text is "' + prod.text + '", expected "v0.6.26"');
    if (prod.bg !== TRANSPARENT) problems.push('prod: has a background fill (' + prod.bg + ') - prod must be quiet, not a badge');
    if (prod.title.indexOf('prod') === -1) problems.push('prod: hover title "' + prod.title + '" does not name the channel');

    // Staging: visible, loud badge, and the treatment is COMPUTED, not just a class.
    if (staging.hidden) problems.push('staging: marker is hidden but should show the badge');
    if (staging.cls.indexOf('staging') === -1) problems.push('staging: missing the staging class');
    if (staging.text.indexOf('STAGING') === -1) problems.push('staging: text "' + staging.text + '" does not say STAGING');
    if (staging.text.indexOf('v0.6.27') === -1) problems.push('staging: text "' + staging.text + '" does not carry the version');
    if (!staging.hasVerSpan) problems.push('staging: the version is not in a .bm-v span');
    if (staging.bg === TRANSPARENT) problems.push('staging: background is transparent - the loud badge fill did not render (a phantom class, or a missing --stag-bg token)');
    if (staging.bg === prod.bg) problems.push('staging: background (' + staging.bg + ') is identical to prod - the badge treatment is vacuous');
    if (staging.color === prod.color) problems.push('staging: ink (' + staging.color + ') is identical to prod - the staging colour did not apply');
    if (staging.borderColor === TRANSPARENT) problems.push('staging: border is transparent - the badge outline did not render');

    // Default channel (undefined) must be prod, never staging.
    if (dflt.cls.indexOf('staging') !== -1) problems.push('default channel (undefined) rendered STAGING - an absent/unknown channel must fall to prod');
    if (dflt.text !== 'v0.6.26') problems.push('default channel: text is "' + dflt.text + '", expected the prod "v0.6.26"');

    // No version -> hidden, never a flash of "unknown" or an empty badge.
    if (!empty.hidden) problems.push('no-version: marker is visible but should be hidden until a version exists (cls="' + empty.cls + '", text="' + empty.text + '")');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-build-marker-2066: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-build-marker-2066: prod paints a dim version, staging a loud computed badge; an absent channel falls to prod and no version hides.');
})();
