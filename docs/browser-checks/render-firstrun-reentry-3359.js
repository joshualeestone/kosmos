'use strict';
// Browser-check-surface: set-rerun-setup
// (#2518) the distinctive web/index.html token this check asserts: the Settings > This
// computer button that reopens the guided setup. A change to it must update this check.
/*
 * kosmos#3359 (0.6.84 new-user QA): in the first-run wizard, pressing Escape marks setup
 * seen (POST /api/first-run/complete) and the wizard never returns on its own, with no
 * VISIBLE warning -- one reflexive keystroke permanently removes onboarding. The fix does
 * NOT touch the Escape path (it is carefully edge-cased); it makes the loss RECOVERABLE:
 * a "Guided setup" box in Settings > This computer whose button reopens the same wizard.
 *
 * WHY A BROWSER. The reopen is #set-rerun-setup calling firstRunBoot(true, 1) -- the forced
 * variant that opens the overlay EVEN THOUGH the seen flag is set. A source grep can see the
 * handler text but not that clicking it, against a board where first run is already done,
 * actually paints the welcome screen with a working Continue. Only a driven click tells you.
 *
 * THE CONTROL IS THE SEEN FLAG. /api/first-run is stubbed done:true, so at boot the wizard
 * stays hidden (a returning user is not nagged) -- exactly the state a person is in after
 * Escape. If the reopen fired on its own the boot assertion reds; it must take the click.
 * On origin/main #set-rerun-setup does not exist, so btnExists reds -- this check fails there.
 *
 * ALSO GUARDS the honest warning copy: the screen-reader line no longer claims the wizard is
 * gone for good; it names the Settings re-entry. And it asserts a leftover disabled Continue
 * (which a prior Escape completion leaves behind) is re-enabled on reopen by frActions.
 *
 * HERMETIC: loads web/index.html over file://, stubs fetch. No server, no sandbox.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-reentry-3359.js
 * HEADED by default; HEADED=0 on a console-less machine (the runner sets HEADED=0).
 */

const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-firstrun-reentry-3359: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');

const problems = [];
let pass = 0;
function ok(name, cond, detail) { if (cond) pass += 1; else problems.push(name + (detail ? ' -- ' + detail : '')); }

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const x = m.text();
    if (/ERR_FILE_NOT_FOUND|URL scheme "file"|Failed to (fetch|load)/.test(x)) return;
    problems.push(`console: ${x}`);
  });

  // Stub fetch BEFORE the page's own script runs, so firstRunBoot at boot reads a
  // returning user (done:true). Order matters: /complete contains /first-run as a
  // substring, so it is matched first.
  await page.addInitScript(() => {
    window.setInterval = () => 0;
    // Stub ONLY the first-run endpoints; everything else falls through to the real
    // fetch, which rejects on file:// and is caught by its callers -- the same clean
    // boot the other hermetic checks get. Stubbing the board's data endpoints with
    // the wrong shape is what makes the tick throw. Order matters: /complete contains
    // /first-run as a substring, so it is matched first.
    const orig = window.fetch.bind(window);
    const reply = (obj) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(obj), text: () => Promise.resolve(JSON.stringify(obj)),
    });
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes('/api/first-run/complete')) return reply({ ok: true });
      if (u.includes('/api/first-run')) return reply({ done: true });   // returning user
      return orig(url, opts);
    };
  });

  await page.goto(PAGE);
  // Let boot settle (firstRunBoot is async); the wizard must NOT auto-open.
  await page.waitForTimeout(150);

  const before = await page.evaluate(() => {
    const res = {};
    const fr = document.getElementById('firstrun');
    res.hiddenAtBoot = !!fr && fr.hidden === true;                 // CONTROL: seen -> not nagged
    const btn = document.getElementById('set-rerun-setup');
    res.btnExists = !!btn;
    const mac = document.getElementById('s-sec-mac');
    res.btnInThisComputer = !!(btn && mac && mac.contains(btn));   // in Settings > This computer
    // The honest warning copy (guards the screen-reader line edit).
    const warn = Array.from(document.querySelectorAll('#firstrun p.vh')).map((p) => p.textContent).join(' ');
    res.warnNamesReentry = /open the guided setup from Settings/i.test(warn);
    // Reach it through the shipped Settings navigation, then simulate the leftover-disabled
    // Continue that a prior Escape completion leaves behind, and click to reopen.
    try {
      showTab('settings');
      settingsOpen('mac');
      res.macSectionVisible = document.getElementById('s-sec-mac').hidden === false;
      res.btnReachable = !!(btn && btn.getClientRects().length);   // actually laid out / clickable
      document.getElementById('fr-next').disabled = true;          // as Escape completion leaves it
      if (btn) btn.click();                                        // fires firstRunBoot(true, 1)
      res.err = null;
    } catch (e) { res.err = String((e && e.message) || e); }
    return res;
  });

  ok('#3359 CONTROL: with the seen flag set, the wizard does not auto-open at boot', before.hiddenAtBoot === true, JSON.stringify(before));
  ok('#3359 the re-entry button exists (reds on origin/main, where it does not)', before.btnExists === true, JSON.stringify(before));
  ok('#3359 the re-entry button lives in Settings > This computer', before.btnInThisComputer === true, JSON.stringify(before));
  ok('#3359 the screen-reader warning names the Settings re-entry (not "gone for good")', before.warnNamesReentry === true, JSON.stringify(before));
  ok('#3359 the button is reachable in the This computer section', before.err === null && before.macSectionVisible === true && before.btnReachable === true, JSON.stringify(before));

  // The click runs firstRunBoot(true, 1) asynchronously; wait for the reopen.
  let reopened = true;
  try {
    await page.waitForFunction(() => document.getElementById('firstrun').hidden === false, { timeout: 4000 });
  } catch { reopened = false; }
  ok('#3359 clicking "Show the guided setup" reopens the wizard', reopened === true, 'wizard #firstrun did not become visible after the click');

  const after = await page.evaluate(() => {
    const res = {};
    res.wizardVisible = document.getElementById('firstrun').hidden === false;
    res.onWelcomePane = document.getElementById('fr-pane-1').hidden === false;   // re-enters at step 1
    const next = document.getElementById('fr-next');
    res.continueEnabled = next.disabled === false;                              // frActions re-enabled it
    res.continueLabel = (next.textContent || '').trim();
    return res;
  });

  ok('#3359 the reopened wizard is on the welcome screen', after.wizardVisible === true && after.onWelcomePane === true, JSON.stringify(after));
  ok('#3359 a Continue left disabled by a prior Escape is re-enabled on reopen', after.continueEnabled === true, JSON.stringify(after));
  ok('#3359 the welcome primary action is "Get Started"', after.continueLabel === 'Get Started', JSON.stringify(after));

  await page.close();
  await browser.close();
  if (problems.length) {
    console.log('problems:\n  ' + problems.join('\n  '));
    console.log('\n' + pass + ' passed, ' + problems.length + ' FAILED');
    process.exit(1);
  }
  console.log(pass + ' passed, problems: none');
})().catch((e) => { console.error(e); process.exit(1); });
