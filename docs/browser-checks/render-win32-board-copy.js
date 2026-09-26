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
  // The Accessibility mock holds the single Kosmos switch row (matched via the Kosmos switch),
  // which covers the panel's Windows-hiding. 2026-09-19 (Josh, 0.6.81 QA): the bundled-tmux
  // own-grant switch row and its 'S3 tmux Accessibility gate row' status row were removed from
  // onboarding, so only the app (Kosmos) mock + gate row remain.
  'S3 Accessibility mock (Kosmos row)': '.s3-mock:has(.s3-sw[data-sw-gate="tmux"])',
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
    // #3614: the agent page Files block's folder button.
    '#d-files-finder': 'Open in File Explorer',
    '#set-reveal': 'Open the Kosmos folder',
    'button[data-go="term"]': 'Live output',
    '#fr-pane-7 p[data-win-copy="s7Body"]': 'Kosmos is running now, and its icon is on the taskbar at the bottom of your screen.',
    /* win32-update-arm (S4): the Update confirm dialog body. The win32 updater downloads first, THEN
       stops the board to swap in place, which the Mac's does not, so the win32 copy names both steps. */
    '#uc-small[data-win-copy="updateConfirmBody"]': 'Kosmos downloads the update, then closes for a few seconds while it swaps it in. Your agents keep working the whole time.',
    /* #3436: the OpenAI subscription sign-in is device code on Windows (its browser pop opened
       behind Kosmos), so both sign-in steps explain the link and the code. */
    '#acct-openai-sub-step [data-win-copy="openaiSubHow"]': 'Kosmos opens OpenAI\u2019s sign-in page in your browser and shows you a short code to type there. Kosmos never sees your password. Your agents then run on your own subscription, on this computer.',
    /* 0.6.96: Kosmos opens the page itself now, so the explainer says so and the link reads "again". */
    '#acct-openai-sub-open[data-win-copy="openaiSubOpen"]': 'Open the sign-in page again',
    '#fr-openai-sub-open[data-win-copy="openaiSubOpen"]': 'Open the sign-in page again',
    '#fr-openai-sub-t [data-win-copy="openaiSubHow"]': 'Kosmos opens OpenAI\u2019s sign-in page in your browser and shows you a short code to type there. Kosmos never sees your password. Your agents then run on your own subscription, on this computer.',
  },
  darwin: {
    '#docs-finder': 'Open this folder in Finder',
    '#d-files-finder': 'Open in Finder',
    '#set-reveal': 'Show me where it is',
    // #2916 renamed the Mac nav pill Terminal -> Advanced; Windows keeps "Live output" (above).
    'button[data-go="term"]': 'Advanced',
    '#fr-pane-7 p[data-win-copy="s7Body"]': 'Kosmos is now in your applications folder, and you will see Kosmos in your dock.',
    '#uc-small[data-win-copy="updateConfirmBody"]': 'Kosmos closes for a few seconds while it updates. Your agents keep working the whole time.',
    '#acct-openai-sub-step [data-win-copy="openaiSubHow"]': "Kosmos opens OpenAI's sign-in in your browser and never sees your password. Your agents then run on your own subscription, on this computer.",
    '#acct-openai-sub-open[data-win-copy="openaiSubOpen"]': 'Open the sign-in page',
    '#fr-openai-sub-open[data-win-copy="openaiSubOpen"]': 'Open the sign-in page',
    '#fr-openai-sub-t [data-win-copy="openaiSubHow"]': "Kosmos opens OpenAI's sign-in in your browser and never sees your password. Your agents then run on your own subscription, on this computer.",
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
    check(`${engine}: win32 wizard skips S2 and S4`, JSON.stringify(win.got.steps) === '[1,5,3,6,7,8,9]', JSON.stringify(win.got.steps));
    check(`${engine}: win32 page raised no errors`, win.errors.length === 0, win.errors.join(' | '));

    const mac = await readPage(browser, 'darwin');
    check(`${engine}: CONTROL a Mac page is not stamped`, mac.got.stamped === null, String(mac.got.stamped));
    for (const [name, isHidden] of Object.entries(mac.got.hidden)) {
      check(`${engine}: CONTROL a Mac page still shows ${name}`, isHidden === false, String(isHidden));
    }
    for (const [sel, want] of Object.entries(WORDS.darwin)) {
      check(`${engine}: CONTROL Mac ${sel} still reads "${want}"`, mac.got.text[sel] === want, JSON.stringify(mac.got.text[sel]));
    }
    check(`${engine}: CONTROL Mac wizard walks all nine steps`, JSON.stringify(mac.got.steps) === '[1,5,2,3,4,6,7,8,9]', JSON.stringify(mac.got.steps));
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

  /* #3443: the win32 scrollbar restyle, measured rather than asserted from source. A scrollable
     element's (offsetWidth - clientWidth) is the width the scrollbar takes in layout. Under win32
     the explicit ::-webkit-scrollbar width:10px rule forces a custom classic bar at exactly 10px,
     in any Chromium on any OS (robust). Unstamped, the width is the RUNNER's native default, which
     is an environment value not a code one (0 for a macOS overlay bar, ~15 for a classic bar on a
     Linux CI runner or a Mac set to "always show") - so the control asserts only that it DIFFERS
     from the win32 10px, never a specific number, or it would false-red on CI. This needs the real
     scrollbar rendered, so it launches its OWN chromium with --hide-scrollbars OFF (the default
     headless flag hides every bar and reads 0 for both arms, a vacuous pass). If the win32 rule
     were removed, the win32 arm would drop to the same native default (!= 10) and fail. */
  {
    const sbBrowser = await playwright.chromium.launch({ headless: process.env.HEADED === '0', ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      const measure = async (stampWin32) => {
        const page = await sbBrowser.newPage({ viewport: { width: 800, height: 600 } });
        await page.addInitScript(stubPageFetches);
        await page.goto('file://' + PAGE);
        const sw = await page.evaluate((doStamp) => {
          if (doStamp) document.documentElement.setAttribute('data-kosmos-platform', 'win32');
          const d = document.createElement('div');
          d.style.cssText = 'width:200px;height:100px;overflow-y:scroll;position:absolute;left:-9999px;top:0;';
          const inner = document.createElement('div'); inner.style.height = '400px'; d.appendChild(inner);
          document.body.appendChild(d);
          const w = d.offsetWidth - d.clientWidth;
          d.remove();
          return w;
        }, stampWin32);
        await page.close();
        return sw;
      };
      const winSb = await measure(true);
      const macSb = await measure(false);
      check('win32 scrollable panes get the thin 10px bar (#3443)', winSb === 10, `win32 scrollbar = ${winSb}px`);
      check('CONTROL an unstamped page uses the runner native width, distinct from the win32 10px, so the bar is win32-only (#3443)', macSb !== 10, `unstamped scrollbar = ${macSb}px (win32 = ${winSb}px)`);
    } finally {
      await sbBrowser.close();
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
