// Browser-check-surface: fr-choice frc-title frc-btn frc-buttons frc-logo firstrun
'use strict';

/**
 * #4356: the first screen asks whether this computer runs agents or connects to agents on another
 * computer. Josh's copy rule (on the card, 2026-09-28): the Kosmos logo, the heading "How would you
 * like to set up Kosmos on this computer?" and the buttons, nothing else on the screen. Three since
 * Josh's 10:31 ruling: "Run agents on this computer", "Connect to agents on another computer" and
 * "Run agents here and connect to other computers".
 *
 * web.firstrun-choice-4356.test.js pins the markup and runs the page's functions. This renders the
 * real page and reads what a person sees: the rendered text, the logo actually loaded, the three
 * buttons side by side (and stacked on a phone-width window), nothing of the wizard or the board
 * showing around the screen, and what each button hands the Mac app.
 *
 * Harness: the real board on a sandbox data root. The Mac app's message handler
 * (window.webkit.messageHandlers.kosmosMode) is stood in for by an init script that records what the
 * page posts; a page without it is the CONTROL (a browser never shows the screen). The app puts
 * ?mode=unset or ?mode=unreadable on the address; this passes them the same way.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-firstrun-choice-4356.js [shots-dir]
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts

const ROOTS = [];
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-frc-' + tag)); ROOTS.push(d); return d; };
const SANDBOX = mkroot('');
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const store = require('../../engine/store');
const srv = require('../../server.js');

const HEADING = 'How would you like to set up Kosmos on this computer?';
const RUN = 'Run agents on this computer';
const CONNECT = 'Connect to agents on another computer';
const BOTH = 'Run agents here and connect to other computers';
const LINES = JSON.stringify([HEADING, RUN, CONNECT, BOTH]);

const SHOTS = process.argv[2] || null;
const fail = [];
let pass = 0;
function chk(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  ' + extra : '')); }
  else { fail.push(label); console.log('FAIL  ' + label + (extra ? '  --  ' + extra : '')); }
}

// The Mac app's handler, stood in for: every post lands in window.__posted.
const BRIDGE = () => {
  window.__posted = [];
  window.webkit = { messageHandlers: { kosmosMode: { postMessage: (m) => { window.__posted.push(m); } } } };
};

const look = (page) => page.evaluate(() => {
  const el = document.getElementById('fr-choice');
  const shown = !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  const logo = el && el.querySelector('img.frc-logo');
  const title = el && el.querySelector('#frc-title');
  const btns = el ? [...el.querySelectorAll('.frc-btn')] : [];
  const r = (x) => x.getBoundingClientRect();
  // What covers the window: every sampled point is inside the screen, never the board or wizard.
  const pts = [[5, 5], [innerWidth - 5, 5], [5, innerHeight - 5], [innerWidth - 5, innerHeight - 5], [innerWidth / 2, innerHeight / 2]];
  return {
    shown,
    lines: shown ? el.innerText.split('\n').map((s) => s.trim()).filter(Boolean) : [],
    logo: logo ? { loaded: logo.complete && logo.naturalWidth > 0, top: r(logo).top, visible: r(logo).height > 0 } : null,
    titleTop: title ? r(title).top : null,
    btns: btns.map((b) => ({ text: b.innerText.trim(), name: b.getAttribute('aria-label'), top: r(b).top, left: r(b).left, h: r(b).height, disabled: b.disabled })),
    covered: shown && pts.every(([x, y]) => el.contains(document.elementFromPoint(x, y))),
    // The tab layout's scrollbar gutter must not show beside the screen on a Mac with classic scrollbars (#4489 CI).
    gutter: (() => { const cs = getComputedStyle(document.documentElement); return { gutter: cs.scrollbarGutter, overflow: cs.overflowY }; })(),
    // What sits at each sampled point, so a red here names what shows around the screen (#4489 CI).
    hits: pts.map(([x, y]) => { const h = document.elementFromPoint(x, y); if (h && el.contains(h)) return null; return [Math.round(x), Math.round(y), h ? h.tagName.toLowerCase() + (h.id ? '#' + h.id : '') + (h.className && typeof h.className === 'string' ? '.' + h.className.trim().split(/\s+/).join('.') : '') : '(nothing: outside the page, e.g. a scrollbar)']; }).filter(Boolean),
    focused: document.activeElement && document.activeElement.classList.contains('frc-btn') ? document.activeElement.innerText.trim() : null,
    wizard: (() => { const w = document.getElementById('firstrun'); return !!w && !w.hidden; })(),
    search: location.search,
    posted: window.__posted || null,
  };
});

(async () => {
  fleet.install([]);
  const server = await srv.start(0);
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port + '/';
  const browser = await chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });   // real scrollbars: the tab layout's gutter is what CI (a Mac with classic scrollbars) saw
  try {
    const errs = [];
    const open = async (url, { bridge = true, width = 1280 } = {}) => {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      if (bridge) await ctx.addInitScript(BRIDGE);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      return page;
    };

    // C1: a fresh Mac, first run not done, no choice stored.
    let page = await open(base + '?mode=unset');
    let s = await look(page);
    chk(s.shown, 'C1 a fresh Mac in the app shows the first screen');
    chk(JSON.stringify(s.lines) === LINES, 'C1 THE RENDERED TEXT IS EXACTLY the heading and the three labels', JSON.stringify(s.lines));
    chk(s.logo && s.logo.loaded && s.logo.visible, 'C1 the Kosmos logo loaded and shows', JSON.stringify(s.logo));
    chk(s.logo && s.titleTop !== null && s.logo.top < s.titleTop, 'C1 the logo is at the top, above the heading');
    chk(s.btns.length === 3 && s.btns.every((b) => b.name === null), 'C1 three buttons, each named by its own label');
    chk(s.btns.length === 3 && s.btns.every((b) => Math.abs(b.top - s.btns[0].top) < 1) && s.btns[0].left < s.btns[1].left && s.btns[1].left < s.btns[2].left,
      'C1 the buttons sit side by side in order, Run on the left', JSON.stringify(s.btns));
    chk(s.btns.length === 3 && s.btns.every((b) => b.h >= 150), 'C1 the buttons are large');
    chk(s.covered, 'C1 nothing of the board or the wizard shows around the screen', JSON.stringify(s.hits));
    chk(s.gutter.gutter === 'auto' && s.gutter.overflow === 'hidden', 'C1 the page reserves no scrollbar gutter beside the screen and does not scroll under it', JSON.stringify(s.gutter));
    chk(s.focused === null, 'C1 no button shows focus on load, as in the approved mockup', String(s.focused));
    await page.keyboard.press('Tab');
    chk((await look(page)).focused === RUN, 'C1 and Tab reaches Run agents first');
    await page.keyboard.press('Shift+Tab');
    chk(await page.evaluate(() => !document.activeElement || document.activeElement === document.body || !!document.activeElement.closest('#fr-choice')),
      'C1 Shift+Tab does not reach the board under the screen');
    await page.waitForTimeout(4500);   // past the 3 s boot timer that starts the tips and the setup assistant
    chk(await page.evaluate(() => !TIP_OPEN && !document.getElementById('cmnotice')), 'C1 no tip or notice opens under the screen');
    chk(await page.evaluate(() => [...document.querySelectorAll('body > *:not(#fr-choice)')].every((n) => n.inert)), 'C1 the rest of the page is inert');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'firstrun-choice-4356.png') });

    // C2: Run agents hands the app "run", hides the screen, first run carries on, and the address forgets ?mode=.
    await page.click('text=' + RUN);
    await page.waitForTimeout(400);
    s = await look(page);
    chk(JSON.stringify(s.posted) === '["run"]', 'C2 Run agents tells the app "run"', JSON.stringify(s.posted));
    chk(!s.shown && s.wizard, 'C2 the screen goes and first run opens');
    // #4494: the wizard is a full-window layer too, so while it is up the page still reserves no gutter and does not
    // scroll. That this screen's own hold lets go is asserted in C6, where the screen goes and nothing replaces it.
    chk(s.gutter.gutter === 'auto' && s.gutter.overflow === 'hidden', 'C2 and the wizard, a full-window layer too, keeps the page from showing a gutter beside it (#4494)', JSON.stringify(s.gutter));
    chk(!/[?&]mode=/.test(s.search), 'C2 the address no longer asks, so a Reload does not show the screen again', s.search);
    await page.context().close();

    // C3: Connect hands the app "connect" and leaves the screen up, buttons off, while the app switches.
    page = await open(base + '?mode=unset');
    await page.click('text=' + CONNECT);
    await page.waitForTimeout(300);
    s = await look(page);
    chk(JSON.stringify(s.posted) === '["connect"]', 'C3 Connect tells the app "connect"', JSON.stringify(s.posted));
    chk(s.shown && s.btns.every((b) => b.disabled) && !s.wizard, 'C3 the screen stays, buttons off, no wizard behind a Mac that is switching away');
    await page.context().close();

    // C3b: Run agents here and connect hands the app "both", first run opens, and ?mode=both stays for its end.
    page = await open(base + '?mode=unset');
    await page.click('text=' + BOTH);
    await page.waitForTimeout(400);
    s = await look(page);
    chk(JSON.stringify(s.posted) === '["both"]', 'C3b Run agents here and connect tells the app "both"', JSON.stringify(s.posted));
    chk(!s.shown && s.wizard && /[?&]mode=both\b/.test(s.search), 'C3b first run opens, and the address keeps mode=both for its last step', s.search);
    chk(await page.evaluate(() => frPlusLast()), 'C3b the end of first run knows to go to Kosmos Plus sign-in');
    await page.context().close();

    // C4: a phone-width window stacks the buttons and still shows only the heading and labels.
    page = await open(base + '?mode=unset', { width: 390 });
    s = await look(page);
    chk(s.btns.length === 3 && s.btns[1].top > s.btns[0].top && s.btns[2].top > s.btns[1].top, 'C4 on a narrow window the buttons stack');
    chk(JSON.stringify(s.lines) === LINES, 'C4 and the text is still exactly the heading and the three labels');
    chk(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'C4 nothing runs off the side');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'firstrun-choice-4356-narrow.png') });
    await page.context().close();

    // C5 CONTROL: a browser (no app handler) never shows the screen; first run opens as it always has.
    page = await open(base + '?mode=unset', { bridge: false });
    s = await look(page);
    chk(!s.shown && s.wizard, 'C5 CONTROL: in a browser there is no first screen, only first run');
    await page.context().close();

    // C6: first run already done. No stored choice: never asked (every Mac before #4356). An unreadable one: asked,
    // and Run agents goes straight to the board.
    fs.writeFileSync(path.join(store.ROOT, 'first-run.json'), JSON.stringify({ completedAt: new Date().toISOString() }));
    page = await open(base + '?mode=unset');
    s = await look(page);
    chk(!s.shown && !s.wizard, 'C6 a Mac that finished first run before #4356 is not asked');
    await page.context().close();
    page = await open(base + '?mode=unreadable');
    s = await look(page);
    chk(s.shown, 'C6 an unreadable choice asks again, even after first run');
    await page.click('text=' + RUN);
    await page.waitForTimeout(400);
    s = await look(page);
    chk(!s.shown && !s.wizard && JSON.stringify(s.posted) === '["run"]', 'C6 and Run agents lands on the board, not first run');
    chk(s.gutter.gutter === 'stable' && s.gutter.overflow !== 'hidden', 'C6 and the page scrolls and keeps its gutter again once the screen goes', JSON.stringify(s.gutter));
    await page.context().close();

    // C9: the approved dark version: the screen's own dark tokens, not the page's or the wizard's.
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
      await ctx.addInitScript(BRIDGE);
      const dp = await ctx.newPage();
      dp.on('pageerror', (e) => errs.push(e.message));
      await dp.goto(base + '?mode=unset', { waitUntil: 'networkidle' });
      await dp.waitForTimeout(300);
      const dark = await dp.evaluate(() => {
        const cs = (el) => getComputedStyle(el);
        const e = document.getElementById('fr-choice');
        return { bg: cs(e).backgroundColor, card: cs(e.querySelector('.frc-btn')).backgroundColor, ink: cs(e.querySelector('.frc-title')).color };
      });
      chk(dark.bg === 'rgb(12, 13, 15)' && dark.card === 'rgb(23, 25, 28)' && dark.ink === 'rgb(245, 245, 244)', 'C9 dark: the mockup\'s ground, card and ink', JSON.stringify(dark));
      if (SHOTS) await dp.screenshot({ path: path.join(SHOTS, 'firstrun-choice-4356-dark.png') });
      await ctx.close();
    }

    // C8: a run-and-connect computer's last step is the Settings Kosmos Plus sign-in that already exists.
    page = await open(base + '?mode=both');
    await page.evaluate(() => frPlusSignIn());
    await page.waitForTimeout(400);
    chk(await page.evaluate(() => {
      const panel = document.getElementById('panel-settings'), email = document.getElementById('plus-signin-email');
      const box = email && email.getBoundingClientRect();
      return !!panel && !panel.hidden && SETTINGS_SEC === 'plus' && !!box && box.height > 0 && document.activeElement === email;
    }), 'C8 the last step opens Settings, Kosmos Plus, at its own email sign-in, focused');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'firstrun-choice-4356-plus-step.png') });
    await page.context().close();

    // C10: end to end, not a direct call: a both computer whose first run is not done yet; leaving first
    // run (Escape, which completes it through frFinish, as every ending does) lands on the Kosmos Plus sign-in.
    fs.rmSync(path.join(store.ROOT, 'first-run.json'), { force: true });
    page = await open(base + '?mode=both');
    chk(await page.evaluate(() => { const w = document.getElementById('firstrun'); return !!w && !w.hidden && document.getElementById('fr-choice').hidden; }),
      'C10 precondition: a both computer opens straight into first run, with no first screen');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    chk(await page.evaluate(() => {
      const email = document.getElementById('plus-signin-email'), b = email && email.getBoundingClientRect();
      return document.getElementById('firstrun').hidden && SETTINGS_SEC === 'plus' && !!b && b.height > 0;
    }), 'C10 first run ends at the Kosmos Plus sign-in on a both computer');
    await page.context().close();

    chk(errs.length === 0, 'C7 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); for (const f of fail) console.error('  FAIL  ' + f); process.exit(1); }
  console.log('\nall first-screen checks passed (' + pass + ')');
})().catch((e) => { console.error(e); process.exit(1); });
