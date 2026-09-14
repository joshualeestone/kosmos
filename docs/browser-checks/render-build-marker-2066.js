// Browser-check-surface: buildmark
'use strict';

/**
 * kosmos#2066 + kosmos#2658: the board's build marker (paintBuildMark) in web/index.html.
 *
 * #2066 shipped a loud coloured STAGING badge so "which build, staging or prod" was
 * answerable from a screenshot. #2658 (option a, Baron's call) SUPERSEDED that with
 * ONE uniform visible marker -- "beta build v<version>" -- for every channel, moving the
 * staging safety tell to the hover title (and /api/accounts channel metadata, #2036).
 * Rationale: staging is opt-in and prod is always promoted+verified, so no
 * constantly-visible staging indicator is needed; the title tell is enough to catch an
 * unpromoted build.
 *
 * ⚠️ WHY A BROWSER. web.build-marker-2066.test.js asserts paintBuildMark's SOURCE emits
 * the right text/title per channel. It cannot prove the marker actually RENDERS uniform
 * -- the #1720 gap (a guard green while the page breaks). The load-bearing assertions
 * here are COMPUTED-STYLE: staging's background and ink must be IDENTICAL to prod's (no
 * leftover loud badge), and the safety tell must survive in the hover title (staging's
 * title names 'staging', prod's names 'prod', and they differ). The default channel
 * (undefined) must render as prod, and no-version must hide.
 *
 * Control: if paintBuildMark or #buildmark is missing, r.error fires and the check reds
 * -- it cannot pass against code that lacks the marker.
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

    // #2658 option (a): ONE uniform visible marker for every channel --
    // "beta build v<version>", no loud STAGING badge.
    if (prod.hidden) problems.push('prod: marker is hidden but should show the version');
    if (prod.text !== 'beta build v0.6.26') problems.push('prod: text is "' + prod.text + '", expected "beta build v0.6.26"');
    if (staging.hidden) problems.push('staging: marker is hidden but should show the version');
    if (staging.text !== 'beta build v0.6.27') problems.push('staging: text is "' + staging.text + '", expected the SAME uniform "beta build v0.6.27" (#2658 dropped the loud STAGING badge)');
    if (staging.text.indexOf('STAGING') !== -1) problems.push('staging: text still says STAGING - the loud badge should be gone (#2658)');
    if (prod.hasVerSpan || staging.hasVerSpan) problems.push('the marker still uses a .bm-v span - #2658 is plain text');

    // Uniform TREATMENT, asserted by computed style: staging must look identical to prod.
    // Reds if the #2066 loud badge (a coloured fill, a different ink, or the class) is left in.
    if (staging.cls.indexOf('staging') !== -1) problems.push('staging: still has the staging class - #2658 makes the visible marker uniform');
    if (prod.bg !== TRANSPARENT) problems.push('prod: has a background fill (' + prod.bg + ') - the marker must be quiet chrome, not a badge');
    if (staging.bg !== prod.bg) problems.push('staging background (' + staging.bg + ') differs from prod (' + prod.bg + ') - the visible marker must be uniform, not a loud badge');
    if (staging.color !== prod.color) problems.push('staging ink (' + staging.color + ') differs from prod (' + prod.color + ') - the visible marker must be uniform');

    // The staging SAFETY tell is not lost - it moved to the hover title (#2066 intent, Baron
    // option a). The title names the channel, and prod vs staging must DIFFER, so an
    // unpromoted staging build is still tellable on hover.
    if (prod.title.indexOf('prod') === -1) problems.push('prod: hover title "' + prod.title + '" does not name the channel');
    if (staging.title.indexOf('staging') === -1) problems.push('staging: hover title "' + staging.title + '" does not name the channel - the safety tell must survive in the title');
    if (staging.title === prod.title) problems.push('staging/prod hover titles are identical - the channel tell is vacuous');

    // Default channel (undefined) must be prod: uniform text, a prod title, never staging.
    if (dflt.text !== 'beta build v0.6.26') problems.push('default channel: text is "' + dflt.text + '", expected the uniform "beta build v0.6.26"');
    if (dflt.title.indexOf('prod') === -1) problems.push('default channel: hover title does not fall to prod');
    if (dflt.title.indexOf('staging') !== -1) problems.push('default channel (undefined) says staging in the title - an absent channel must fall to prod');

    // No version -> hidden, never a flash of an empty marker.
    if (!empty.hidden) problems.push('no-version: marker is visible but should be hidden until a version exists (cls="' + empty.cls + '", text="' + empty.text + '")');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-build-marker-2066: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-build-marker-2066: prod and staging paint the SAME uniform "beta build v<version>" marker; the channel tell survives in the hover title (staging vs prod differ); an absent channel falls to prod and no version hides.');
})();
