// Browser-check-surface: data-win-copy data-win-hide data-kosmos-platform fr-cmd-row fr-copy fr-hatch fr-note
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
  await ctx.close();
  return { got, errors };
}

/* win32-signin-web-copy: the stuck Claude card, painted by the page's own frPaintConnect with
   the state connect.js serves (the card's platform comes from that state, as it does live).
   Each arm's `because` differs from the arm before it, so the painter's repaint key (phase plus
   because) never skips one. */
const SIGNIN_UNAVAILABLE = 'Kosmos cannot run the Claude sign-in on Windows yet';
/* The line the engine records for Claude Code under a user name with a space and an
   apostrophe (engine/win32signin.js quotes it; the page shows it verbatim). */
const SIGNIN_LINE = "& 'C:\\Users\\Mary O''Brien\\.local\\bin\\claude.exe' auth login --claudeai";
const CONNECT_ARMS = {
  windowsHasClaude: { phase: 'stuck', because: SIGNIN_UNAVAILABLE, platform: 'win32', canInstallClaude: false, canRunClaude: true, claudeSigninCommand: SIGNIN_LINE },
  windowsNoLine: { phase: 'stuck', because: 'Kosmos could not start the Claude sign-in on this computer', platform: 'win32', canInstallClaude: false, canRunClaude: true, claudeSigninCommand: null },
  windowsNoClaude: { phase: 'stuck', because: 'Kosmos could not find Claude Code to run its sign-in', platform: 'win32', canInstallClaude: false, canRunClaude: false },
  macHasClaude: { phase: 'stuck', because: 'we could not open the window Claude signs in through', platform: 'darwin', canInstallClaude: true, canRunClaude: true },
};

async function readConnectCard(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(stubPageFetches);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + PAGE);
  const got = await page.evaluate((arms) => {
    const host = document.getElementById('fr-sub');
    if (!host || typeof frPaintConnect !== 'function') return { noCard: true };
    /* Ancestors only, as render-connect-win32-install-570.js does: #fr-sub's own display is
       styled conditionally, and the heights below need real layout. */
    host.removeAttribute('hidden');
    for (let n = host.parentElement; n; n = n.parentElement) {
      n.removeAttribute('hidden');
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    const out = {};
    for (const [name, st] of Object.entries(arms)) {
      frPaintConnect(st);
      const cmd = host.querySelector('.fr-cmd');
      const hatch = host.querySelector('details.fr-hatch');
      const summary = hatch && hatch.querySelector('summary');
      const row = cmd && cmd.closest('.fr-cmd-row');
      out[name] = {
        showsCommand: Boolean(cmd && cmd.getBoundingClientRect().height > 0),
        commandText: cmd ? cmd.textContent : '',
        commandInHatch: Boolean(cmd && cmd.closest('details.fr-hatch')),
        copyBeside: Boolean(row && row.querySelector('button.fr-copy[data-copy-command]')
          && row.querySelector('button.fr-copy[data-copy-command]').getBoundingClientRect().height > 0),
        hasHatch: Boolean(hatch),
        open: Boolean(hatch && hatch.open),
        summary: summary ? summary.textContent.trim() : '',
        /* How much of the hatch is on screen below its summary: the steps, when it is open. */
        stepsHeight: hatch && summary ? hatch.getBoundingClientRect().height - summary.getBoundingClientRect().height : 0,
        text: host.textContent.replace(/\s+/g, ' ').trim(),
      };
    }
    return out;
  }, CONNECT_ARMS);
  await ctx.close();
  return { got, errors };
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

    const card = await readConnectCard(browser);
    if (card.got.noCard) {
      check(`${engine}: the connect card is reachable`, false, 'no #fr-sub or no frPaintConnect');
    } else {
      const has = card.got.windowsHasClaude;
      check(`${engine}: a Windows PC that has Claude Code is not shown the install command`, !/install\.ps1/.test(has.text), JSON.stringify(has.text.slice(0, 160)));
      check(`${engine}: its card says the engine's reason once`, has.text.split(SIGNIN_UNAVAILABLE).length - 1 === 1, JSON.stringify(has.text.slice(0, 160)));
      check(`${engine}: its sign-in steps render open under "Sign in to Claude yourself"`,
        has.hasHatch && has.open && has.summary === 'Sign in to Claude yourself' && has.stepsHeight > 20,
        `hatch ${has.hasHatch}, open ${has.open}, summary ${JSON.stringify(has.summary)}, steps ${Math.round(has.stepsHeight)}px`);
      check(`${engine}: the engine's line is shown verbatim inside the hatch, with real area and a Copy button beside it`,
        has.showsCommand && has.commandText === SIGNIN_LINE && has.commandInHatch && has.copyBeside,
        `text ${JSON.stringify(has.commandText)}, in hatch ${has.commandInHatch}, copy ${has.copyBeside}`);
      check(`${engine}: and the steps end at Login successful and Try again`,
        /If PowerShell asks for a code, copy the code your browser shows and paste it into PowerShell\. When PowerShell says Login successful, come back here and click Try again\./.test(has.text) && !/type claude/i.test(has.text),
        JSON.stringify(has.text.slice(-160)));
      const noLine = card.got.windowsNoLine;
      check(`${engine}: a Windows PC the engine named no file for gets the install command and no hatch`,
        noLine.showsCommand && /install\.ps1/.test(noLine.commandText) && !noLine.hasHatch,
        `command ${JSON.stringify(noLine.commandText)}, hatch ${noLine.hasHatch}`);
      const none = card.got.windowsNoClaude;
      check(`${engine}: CONTROL a Windows PC without Claude Code still sees the install command and no sign-in hatch`,
        none.showsCommand && !none.hasHatch, `command ${none.showsCommand}, hatch ${none.hasHatch}`);
      const macCard = card.got.macHasClaude;
      check(`${engine}: CONTROL the Mac hatch is still closed under "Already use Terminal?"`,
        !macCard.showsCommand && macCard.hasHatch && !macCard.open && macCard.summary === 'Already use Terminal?' && macCard.stepsHeight < 5,
        `open ${macCard.open}, summary ${JSON.stringify(macCard.summary)}, steps ${Math.round(macCard.stepsHeight)}px`);
    }
    check(`${engine}: connect card page raised no errors`, card.errors.length === 0, card.errors.join(' | '));

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
