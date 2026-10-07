// Browser-check-surface: fr-note fr-hatch
/**
 * The Linux "way out" on the stuck connect card (#5449).
 *
 * 🛑 WHAT THIS EXISTS TO CATCH. On a headless Linux server reached from a browser
 * there is no Terminal app to open, yet the stuck card's escape hatch said "open
 * Terminal, type claude" -- the Mac arm caught Linux because the branch was binary
 * (Windows PowerShell, else Mac). The Linux way in is a shell on the server itself
 * (over SSH), then `claude`. The hatch is the only self-serve route past a stuck
 * connect, so a Mac-shaped one is a wall with a sign on it for exactly the person
 * who needs it.
 *
 * 🔑 WHY A SOURCE TEST IS NOT ENOUGH. server.connect.test.js already pins that the
 * painter EMITS the Linux copy. What it cannot see is whether the disclosure renders
 * as a real, closed `<details>` with a clickable summary of real area -- a hatch that
 * renders already-open, or with a zero-area summary, is a different thing from the one
 * the card intends. Arm 1 asserts the rendered shape.
 *
 * ⚠️ ARMS 2 AND 3 ARE THE DISCRIMINATORS. Arm 2 drives a Mac with the same phase and
 * requires the Mac "open Terminal" hatch and NOT the Linux copy, so neither arm leaks
 * into the other. Arm 3 drives Linux with `canRunClaude: false` and requires the hatch
 * to be gone: three of the five stuck causes mean Claude was never installed, so the
 * command would answer `command not found` (#205). A gate loosened to the platform
 * alone passes arm 1 and reds here.
 *
 * ⚠️ HERMETIC: loads web/index.html over file://, boots no server. It drives the
 * page's OWN painter (`frPaintConnect` reads its argument and the DOM, never the
 * network) and asserts rendered text and geometry, so it sits in browser-checks.sh's
 * file:// loop.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-connect-linux-stuck-5449.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';
const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-connect-linux-stuck-5449: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];
/* The sentence the engine really produces on Linux when there is no tmux, so this
   drives the painter with what it will actually be handed rather than a stand-in. */
const REFUSAL = 'tmux is not installed, so no agent session could be started';

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
         `hidden` too. Unhide the chain; the area guard below needs real layout, so an
         unhide that failed cannot pass as a rendering result. Ancestors only -- never
         #fr-sub itself, whose own display is styled conditionally. */
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
      const note = host.querySelector('.fr-note');
      const hatch = host.querySelector('.fr-hatch');
      const summary = hatch ? hatch.querySelector('summary') : null;
      const r = summary ? summary.getBoundingClientRect() : null;
      return {
        noteText: note ? note.textContent.trim() : '',
        hasHatch: Boolean(hatch),
        hatchOpen: hatch ? hatch.hasAttribute('open') : false,
        summaryText: summary ? summary.textContent.trim() : '',
        w: r ? r.width : 0,
        h: r ? r.height : 0,
      };
    }, st);

    // 1. LINUX, Claude is runnable -- the way out is a server shell, rendered as a
    //    real, closed disclosure, and it must NOT tell a headless box to open a Terminal.
    const linux = await paint({ phase: 'stuck', because: REFUSAL, platform: 'linux', canRunClaude: true });
    check(`${engine}: a Linux card shows the server-shell way out, with real area`,
      linux.hasHatch && /Have a shell on the server/.test(linux.summaryText)
        && /connect over SSH/.test(linux.noteText) && /claude/.test(linux.noteText)
        && linux.w > 40 && linux.h > 10,
      `summary ${JSON.stringify(linux.summaryText)}, ${Math.round(linux.w)}x${Math.round(linux.h)}`);
    check(`${engine}: the Linux hatch is closed, not already open`,
      linux.hasHatch && !linux.hatchOpen, `open ${linux.hatchOpen}`);
    check(`${engine}: a headless Linux box is not told to open a Terminal app`,
      !/open Terminal/i.test(linux.noteText), JSON.stringify(linux.noteText.slice(0, 90)));

    // 2. CONTROL: a Mac keeps its own "open Terminal" hatch and shows none of the Linux copy.
    const mac = await paint({ phase: 'stuck', because: 'something else went wrong', platform: 'darwin', canRunClaude: true });
    check(`${engine}: a Mac card keeps open-Terminal and carries no Linux copy`,
      /open Terminal, type/.test(mac.noteText)
        && !/Have a shell on the server|connect over SSH/.test(mac.noteText),
      `note ${JSON.stringify(mac.noteText.slice(0, 80))}`);

    // 3. THE DISCRIMINATOR: Linux, but Claude is not runnable. The hatch must be gone,
    //    so the card does not name a command that answers `command not found`.
    const noRun = await paint({ phase: 'stuck', because: REFUSAL, platform: 'linux', canRunClaude: false });
    check(`${engine}: the Linux hatch is gone when there is nothing to run`,
      !/connect over SSH/.test(noRun.noteText) && /carry on and connect later/i.test(noRun.noteText),
      `note ${JSON.stringify(noRun.noteText.slice(0, 80))}`);

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
