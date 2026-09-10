// Browser-check-surface: fr-cmd fr-note
/**
 * The Windows "install Claude Code yourself" note on the connect card (#570).
 *
 * 🛑 WHAT THIS EXISTS TO CATCH. On Windows `connect.download()` refuses before any
 * bytes move -- the binary it fetches is a macOS build -- and that refusal reaches
 * the card honestly. Then the card offered nothing: "Try again" repeats the same
 * doomed download and "Continue anyway" leads to a board that cannot make a
 * working agent. Nowhere in the product was a Windows user told how to GET Claude
 * Code. The note is the way out, and a command a person must copy is exactly the
 * kind of thing that can go on rendering while being unreadable or absent.
 *
 * 🔑 WHY A SOURCE TEST IS NOT ENOUGH, AND WHAT THE THIRD ARM IS FOR. Source arms
 * (server.connect.test.js) already pin that the painter EMITS the note. What they
 * cannot see is whether the command survives as something a person can read and
 * copy: `.fr-cmd` is styled `white-space: pre-wrap; overflow-wrap: anywhere`
 * precisely because a wrapped command is a WRONG command, and that is a computed
 * result. Arm 1 asserts it renders with real area and the exact text.
 *
 * ⚠️ ARMS 2 AND 3 ARE THE DISCRIMINATORS, and 3 is the one worth having. The
 * painter gates on BOTH `platform === 'win32'` AND `canInstallClaude === false`,
 * on the stated grounds that the day Kosmos publishes a Windows runner build the
 * note "retires itself" instead of going on naming a command nobody needs. That
 * claim is only true if the gate really reads both fields -- so arm 3 drives
 * win32 WITH `canInstallClaude: true` and requires the command to be gone. A gate
 * loosened to the platform alone passes arms 1 and 2 and reds here.
 * (`downloads.claude.ai` does publish win32 builds today, so this is a reachable
 * future, not a hypothetical one.)
 *
 * ⚠️ HERMETIC: loads web/index.html over file://, boots no server. It drives the
 * page's OWN painter (`frPaintConnect` reads its argument and the DOM, never the
 * network) and asserts rendered text and geometry, so no /api and no board is
 * needed -- which is what lets it sit in browser-checks.sh's file:// loop.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-connect-win32-install-570.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';
const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-connect-win32-install-570: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];
const COMMAND = 'irm https://claude.ai/install.ps1 | iex';
/* The sentence the engine really produces on win32, so this drives the painter
   with what it will actually be handed rather than a convenient stand-in. */
const REFUSAL = 'this platform (win32) is not supported; the Claude Code binary is a macOS build and was not downloaded';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

(async () => {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch({ headless: process.env.HEADED === '0' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto('file://' + PAGE);

    const pre = await page.evaluate(() => {
      const host = document.getElementById('fr-sub');
      if (!host) return { noHost: true };
      if (typeof frPaintConnect !== 'function') return { noConnFn: true };
      /* The first-run pane is hidden on a set-up board and an ancestor carries the
         `hidden` too. Unhide the chain; the area guards below need real layout, so
         an unhide that failed cannot pass as a rendering result. Ancestors only --
         never #fr-sub itself, whose own display is styled conditionally. */
      host.removeAttribute('hidden');
      for (let n = host.parentElement; n; n = n.parentElement) {
        n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
      return { ok: true };
    });
    if (!pre.ok) {
      check(`${engine}: the connect card is reachable`, false, JSON.stringify(pre));
      await browser.close();
      continue;
    }

    const paint = (st) => page.evaluate((s) => {
      frPaintConnect(s);
      const host = document.getElementById('fr-sub');
      const cmd = host.querySelector('.fr-cmd');
      const note = host.querySelector('.fr-note');
      const r = cmd ? cmd.getBoundingClientRect() : null;
      return {
        hasCmd: Boolean(cmd),
        cmdText: cmd ? cmd.textContent.trim() : '',
        w: r ? r.width : 0,
        h: r ? r.height : 0,
        whiteSpace: cmd ? getComputedStyle(cmd).whiteSpace : '',
        noteText: note ? note.textContent.trim() : '',
      };
    }, st);

    // 1. WINDOWS, no runner download -- the way out, readable and exact.
    const win = await paint({ phase: 'stuck', because: REFUSAL, platform: 'win32', canInstallClaude: false });
    check(`${engine}: a Windows card shows the install command, with real area`,
      win.hasCmd && win.cmdText === COMMAND && win.w > 80 && win.h > 10,
      `text ${JSON.stringify(win.cmdText)}, ${Math.round(win.w)}x${Math.round(win.h)}`);
    /* A wrapped command is a wrong command: `pre` alone would clip it out of
       sight in a narrow card, so the rule wraps rather than truncating. */
    check(`${engine}: the command wraps rather than being clipped`,
      /pre-wrap|pre-line|normal/.test(win.whiteSpace),
      `white-space ${win.whiteSpace}`);
    check(`${engine}: and it still says Try again is worth pressing after`,
      /Try again/i.test(win.noteText), JSON.stringify(win.noteText.slice(-60)));

    // 2. A MAC must be untouched -- it has no such command, and Kosmos installs
    //    Claude Code there itself.
    const mac = await paint({ phase: 'stuck', because: 'something else went wrong', platform: 'darwin', canInstallClaude: true });
    check(`${engine}: a Mac card carries no PowerShell command`,
      !mac.hasCmd && /carry on and connect later/i.test(mac.noteText),
      `hasCmd ${mac.hasCmd}, note ${JSON.stringify(mac.noteText.slice(0, 60))}`);

    // 3. THE DISCRIMINATOR: win32, but Kosmos CAN install the runner. The note
    //    must retire itself. A gate loosened to the platform alone reds here and
    //    nowhere else.
    const someday = await paint({ phase: 'stuck', because: REFUSAL, platform: 'win32', canInstallClaude: true });
    check(`${engine}: the note retires itself once Kosmos can install on Windows`,
      !someday.hasCmd,
      `hasCmd ${someday.hasCmd} (the gate must read canInstallClaude, not just the platform)`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
