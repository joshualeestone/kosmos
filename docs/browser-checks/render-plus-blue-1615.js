'use strict';

/**
 * kosmos#1615: the Kosmos Plus tab's whole-app blue skin applies when the tab is
 * on screen, mounts its two canvases, and — the half that a source read cannot
 * see — TEARS DOWN and un-blues the moment you leave, so neither the blue nor the
 * canvases leak onto another section or another tab.
 *
 * ⚠️ WHY A BROWSER. The skin is body.plus-active overriding the --k-* / --label
 * tokens by INHERITANCE, so whether the app actually turns blue is a COMPUTED
 * style, not a source fact — exactly the class of defect (a rule that loses the
 * cascade reads in the diff as if it worked) this directory exists to catch. And
 * the teardown is a live effect: only the running page knows whether body still
 * carries plus-active, and whether the mount flag cleared, after you navigate
 * away. Measured in BOTH schemes and once under reduced-motion.
 *
 * Reds on origin/main, where body.plus-active, #plus-stars/#plus-mark and
 * syncPlusChrome do not exist (the pane is warm, no canvases, no toggle).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-plus-blue-1615.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts computed DOM.
 */

const ENGINES = ['chromium'];
const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-plus-blue-1615: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const BLUE = 'rgb(7, 12, 22)';   /* #070c16, the first-step blue ground */

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-plus-blue-1615: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }

  const problems = [];
  const results = {};

  /* One case = one scheme + reduced-motion setting, in its own context so the
     colour-scheme / reduced-motion emulation is clean. */
  async function run(label, opts) {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      colorScheme: opts.scheme,
      reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
    });
    const page = await ctx.newPage();
    await page.goto('file://' + PAGE);

    const r = await page.evaluate(async () => {
      const raf = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const bg = () => getComputedStyle(document.body).backgroundColor;
      if (typeof showTab !== 'function' || typeof settingsGo !== 'function') {
        return { error: 'showTab/settingsGo not in scope' };
      }
      if (typeof syncPlusChrome !== 'function') return { error: 'syncPlusChrome not in scope (skin not wired)' };

      // 1. Enter Settings > Plus.
      showTab('settings');
      settingsGo('plus');
      await raf();
      const enterActive = document.body.classList.contains('plus-active');
      const enterBg = bg();
      const stars = document.getElementById('plus-stars');
      const mark = document.getElementById('plus-mark');
      const mounted = (typeof plusMounted !== 'undefined') && plusMounted;
      const starsSized = !!stars && stars.width > 0 && stars.height > 0;
      const markSized = !!mark && mark.width > 0 && mark.height > 0;

      // 2. Leave to another Settings section — must un-blue AND tear down.
      settingsGo('you');
      await raf();
      const leaveActive = document.body.classList.contains('plus-active');
      const leaveBg = bg();
      const leaveMounted = (typeof plusMounted !== 'undefined') && plusMounted;

      // 3. Re-enter Plus, then leave to the Agents TAB — must not leak off-tab.
      settingsGo('plus');
      await raf();
      const reEnterActive = document.body.classList.contains('plus-active');
      showTab('agents');
      await raf();
      const offTabActive = document.body.classList.contains('plus-active');
      const offTabBg = bg();

      return {
        enterActive, enterBg, mounted, starsSized, markSized,
        leaveActive, leaveBg, leaveMounted,
        reEnterActive, offTabActive, offTabBg,
        hasStars: !!stars, hasMark: !!mark,
      };
    });

    await ctx.close();
    results[label] = r;

    if (r.error) { problems.push(label + ': ' + r.error); return; }
    // Enter: blue on, canvases mounted and sized.
    if (!r.enterActive) problems.push(label + ': entering Plus did not add body.plus-active');
    if (r.enterBg !== BLUE) problems.push(label + ': body did not turn blue on Plus (got ' + r.enterBg + ', want ' + BLUE + ')');
    if (!r.hasStars || !r.hasMark) problems.push(label + ': the Plus canvases (#plus-stars / #plus-mark) are missing');
    if (!r.mounted) problems.push(label + ': the canvas engine did not mount (plusMounted false) on Plus');
    if (!r.starsSized) problems.push(label + ': #plus-stars has zero size (not laid out / not sized)');
    if (!r.markSized) problems.push(label + ': #plus-mark has zero size (not laid out / not sized)');
    // Leave a section: blue off, torn down.
    if (r.leaveActive) problems.push(label + ': plus-active LEAKED to another Settings section');
    if (r.leaveBg === BLUE) problems.push(label + ': the blue ground LEAKED to another Settings section (still ' + r.leaveBg + ')');
    if (r.leaveMounted) problems.push(label + ': the canvas engine did not tear down on leave (plusMounted still true) — it would burn CPU behind another screen');
    // Leave the tab: no off-tab leak.
    if (!r.reEnterActive) problems.push(label + ': re-entering Plus did not re-apply the skin');
    if (r.offTabActive) problems.push(label + ': plus-active LEAKED to the Agents tab');
    if (r.offTabBg === BLUE) problems.push(label + ': the blue ground LEAKED to the Agents tab (still ' + r.offTabBg + ')');
  }

  await run('light', { scheme: 'light', reduced: false });
  await run('dark', { scheme: 'dark', reduced: false });
  await run('reduced-motion', { scheme: 'light', reduced: true });

  await browser.close();

  console.log('  ' + JSON.stringify(results));
  if (problems.length) {
    console.error('render-plus-blue-1615: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-plus-blue-1615: Plus turns the app blue + mounts its canvases on enter, and un-blues + tears down on leave (both schemes + reduced-motion; no leak to another section or tab).');
})();
