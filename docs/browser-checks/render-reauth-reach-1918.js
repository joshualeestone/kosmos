'use strict';

/**
 * kosmos#1918: the agent page's "Sign in again" button must actually REACH the
 * re-auth surface, not just call a function.
 *
 * ⚠️ WHY A BROWSER. `node --test` (and the jsdom-style unit test
 * web.reauth-reach-1918.test.js) can prove the click handler CALLS
 * showTab('settings') then settingsOpen('accounts'). It cannot prove the click
 * actually makes the settings PANEL visible, because the panels are mutually
 * exclusive real DOM and showTab is stubbed in that test. This is exactly the
 * gap that shipped a DEAD CONTROL in iteration 1: the button lived on the detail
 * panel and called only settingsGo('accounts'), which switches a section WITHIN
 * the settings panel and never reveals it, so the user saw nothing. Only a real
 * render can settle whether the panel flips. This check clicks the button and
 * asserts the settings panel becomes visible and the detail panel hides.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-reauth-reach-1918.js
 *
 * ⚠️ HEADED by default, matching the other checks here. HEADED=0 on a machine
 * with no console session; the verdicts are the same, this asserts computed
 * visibility rather than pixels.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-reauth-reach-1918: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-reauth-reach-1918: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(() => {
    const vis = (el) => {
      if (!el || el.hidden) return false;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    /* Put the page in the state the auth_failed presentation produces: the detail
       panel on screen, the re-auth button revealed (paintDetail flips #d-reauth
       hidden off when state === auth_failed; here we set it directly so the check
       does not depend on a live agent fetch). */
    document.getElementById('panel-detail').hidden = false;
    document.getElementById('panel-settings').hidden = true;
    const btn = document.getElementById('d-reauth');
    btn.hidden = false;

    const before = {
      buttonShown: vis(btn),
      buttonText: (btn.textContent || '').trim(),
      settingsShown: vis(document.getElementById('panel-settings')),
    };

    /* The real wired click. If the handler only opened a settings SECTION without
       showTab, #panel-settings would stay hidden and this is the dead control. */
    btn.click();

    const after = {
      settingsShown: vis(document.getElementById('panel-settings')),
      detailShown: vis(document.getElementById('panel-detail')),
      accountsSectionOn: (() => {
        const sec = document.querySelector('#panel-settings .dsec[data-sec="accounts"]');
        return !!sec && !sec.hidden;
      })(),
    };
    return { before, after };
  });

  await browser.close();

  const problems = [];
  if (!r.before.buttonShown) problems.push('the re-auth button did not render when revealed');
  if (r.before.buttonText !== 'Sign in again') {
    problems.push(`the button reads "${r.before.buttonText}", not "Sign in again"`);
  }
  if (r.before.settingsShown) problems.push('the settings panel was already visible before the click; the check proves nothing');
  if (!r.after.settingsShown) problems.push('after the click the settings panel is STILL hidden - the button is a dead control (the #1918 defect)');
  if (r.after.detailShown) problems.push('after the click the detail panel is still visible - the panel did not switch');
  if (!r.after.accountsSectionOn) problems.push('after the click the Accounts section is not the open one');

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error(`render-reauth-reach-1918: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-reauth-reach-1918: the Sign-in-again button reveals the Accounts settings surface (not a dead control).');
})();
