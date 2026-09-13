// Browser-check-surface: data-win-copy data-win-hide data-kosmos-platform fr-cmd-row fr-copy
/**
 * win32-board-copy: the board page on Windows, rendered, and the same page on a Mac.
 *
 * 🛑 WHAT THIS EXISTS TO CATCH. The platform copy layer hides Mac-only surfaces with one CSS
 * rule and swaps keyed text at load. Both are COMPUTED results a source test cannot see: a
 * rule that loses to a more specific selector leaves the macOS dialog on screen while every
 * markup assertion passes, and a swap that runs before the markup exists changes nothing.
 * So this stamps the served-platform meta the way server.js does, re-applies the layer, and
 * reads what a person would see.
 *
 * ⚠️ TWO PAGES, ONE PER PLATFORM, AND THE MAC ONE IS THE CONTROL. The Windows page must hide
 * the Energy/Accessibility mocks, the Dock drawing, the Accessibility button, the tmux box,
 * the auto-update switch and Open Terminal, and must show the Windows words. The Mac page,
 * loaded the same way with the meta left unstamped, must show every one of those surfaces
 * and none of the Windows words; without it the Windows arm could pass on a page that hides
 * them from everybody.
 *
 * ⚠️ HERMETIC: loads web/index.html over file://, boots no server. The hidden panes are
 * un-hidden (ancestors only) so computed display is a rendering result, as in
 * render-connect-win32-install-570.js.
 *
 * 🔑 THE PAGE'S OWN BOOT FETCHES ARE STUBBED BEFORE IT LOADS, the way render-autohello-2686.js
 * does it (its initStub, installed with addInitScript, answering a benign `{ agents: [] }`).
 * Over file:// the board's /api reads cannot succeed, and WebKit reports each one as a page
 * error ("... due to access control checks."), which reddened this check's no-errors arm in CI
 * (PR #2984) while Chromium stayed quiet. Stubbing fetch at the source means NOTHING has to be
 * filtered: every page error that still arrives is a real one, and the control arm below
 * proves the listener catches a real script error in each engine.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-win32-board-copy.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';
const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-win32-board-copy: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];

/* The Mac-only surfaces, found by identity, and the words each platform must show. */
const MAC_ONLY = {
  'S3 Energy mock': '.s3-mock:has(.s3-sw[data-sw-gate="sleep"])',
  'S3 Accessibility mock': '.s3-mock:has(.s3-sw[data-sw-gate="tmux"])',
  'S3 Accessibility gate row': '.s3-gate-row[data-gate="tmux"]',
  'S7 Dock drawing': '#fr-success',
  'Settings Accessibility button': '#set-a11y-open',
  'Settings tmux box': 'section.dbox[data-win-hide]',
  'Update Kosmos automatically': '#auto-row',
  'Open Terminal': '.field:has(> #d-open-terminal)',
};
const WORDS = {
  win32: {
    '#docs-finder': 'Open in File Explorer',
    '#set-reveal': 'Open the Kosmos folder',
    'button[data-go="term"]': 'Live output',
    '#fr-pane-7 p[data-win-copy="s7Body"]': 'To open Kosmos later, double-click Kosmos.exe in the folder you extracted it to.',
  },
  darwin: {
    '#docs-finder': 'Open this folder in Finder',
    '#set-reveal': 'Show me where it is',
    'button[data-go="term"]': 'Terminal',
    '#fr-pane-7 p[data-win-copy="s7Body"]': 'Kosmos is now in your applications folder, and you will see Kosmos in your dock.',
  },
};

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* The fetch stub, in render-autohello-2686.js's shape: installed before any page script runs,
   answering every request with a benign JSON body so the boot polls resolve instead of being
   refused by file://. Nothing this check asserts reads a fetched value. */
function stubPageFetches() {
  const enc = (o, status) => new Response(JSON.stringify(o), {
    status: status || 200, headers: { 'content-type': 'application/json' },
  });
  window.fetch = async () => enc({ agents: [] });
}

async function readPage(browser, platform) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(stubPageFetches);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + PAGE);
  const got = await page.evaluate(({ platform, macOnly, words }) => {
    if (typeof applyPlatformCopy !== 'function') return { noLayer: true };
    if (platform === 'win32') {
      document.querySelector('meta[name="kosmos-platform"]').setAttribute('content', 'win32');
      applyPlatformCopy(document);
    }
    const unhideAncestors = (el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
    };
    const hidden = {};
    for (const [name, sel] of Object.entries(macOnly)) {
      const el = document.querySelector(sel);
      if (!el) { hidden[name] = 'missing'; continue; }
      unhideAncestors(el);
      hidden[name] = getComputedStyle(el).display === 'none';
    }
    const text = {};
    for (const sel of Object.keys(words)) {
      const el = document.querySelector(sel);
      text[sel] = el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    }
    /* The not-signed-in panel and the wizard's walk, from the page's own functions. */
    const signin = boardSigninHtml();
    const steps = frStepSequence();
    const stamped = document.documentElement.getAttribute('data-kosmos-platform');
    return { hidden, text, signin, steps, stamped };
  }, { platform, macOnly: MAC_ONLY, words: WORDS[platform] });
  /* CONTROL for the no-errors arm: a real uncaught script error thrown on this same page must
     reach the listener, so "no errors" above means none happened, not that none were heard. */
  const before = errors.length;
  await page.evaluate(() => { setTimeout(() => { throw new Error('win32-board-copy listener probe'); }, 0); });
  await page.waitForTimeout(250);
  const probeHeard = errors.slice(before).some((m) => /win32-board-copy listener probe/.test(m));
  const pageErrors = errors.slice(0, before);
  await ctx.close();
  return { got, errors: pageErrors, probeHeard };
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });

    const win = await readPage(browser, 'win32');
    if (win.got.noLayer) {
      check(`${engine}: the platform copy layer is on the page`, false, 'applyPlatformCopy is not defined');
      await browser.close();
      continue;
    }
    check(`${engine}: win32 stamps <html data-kosmos-platform>`, win.got.stamped === 'win32', String(win.got.stamped));
    for (const [name, isHidden] of Object.entries(win.got.hidden)) {
      check(`${engine}: win32 hides ${name}`, isHidden === true, String(isHidden));
    }
    for (const [sel, want] of Object.entries(WORDS.win32)) {
      check(`${engine}: win32 ${sel} reads "${want}"`, win.got.text[sel] === want, JSON.stringify(win.got.text[sel]));
    }
    check(`${engine}: win32 not-signed-in panel points at Kosmos.exe, with no Mac path`,
      /Kosmos\.exe/.test(win.got.signin) && !/~\/\.local|fix itself/.test(win.got.signin), win.got.signin.slice(0, 120));
    check(`${engine}: win32 wizard skips S2 and S4`, JSON.stringify(win.got.steps) === '[1,3,5,6,7,8,9]', JSON.stringify(win.got.steps));
    check(`${engine}: win32 page raised no errors`, win.errors.length === 0, win.errors.join(' | '));
    check(`${engine}: CONTROL a real script error on the page reaches the listener`, win.probeHeard === true, String(win.probeHeard));

    const mac = await readPage(browser, 'darwin');
    check(`${engine}: CONTROL a Mac page is not stamped`, mac.got.stamped === null, String(mac.got.stamped));
    for (const [name, isHidden] of Object.entries(mac.got.hidden)) {
      check(`${engine}: CONTROL a Mac page still shows ${name}`, isHidden === false, String(isHidden));
    }
    for (const [sel, want] of Object.entries(WORDS.darwin)) {
      check(`${engine}: CONTROL Mac ${sel} still reads "${want}"`, mac.got.text[sel] === want, JSON.stringify(mac.got.text[sel]));
    }
    check(`${engine}: CONTROL Mac wizard walks all nine steps`, JSON.stringify(mac.got.steps) === '[1,2,3,4,5,6,7,8,9]', JSON.stringify(mac.got.steps));
    check(`${engine}: CONTROL Mac not-signed-in panel is unchanged`, /fix itself the next/.test(mac.got.signin), mac.got.signin.slice(0, 120));
    check(`${engine}: Mac page raised no errors`, mac.errors.length === 0, mac.errors.join(' | '));

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
