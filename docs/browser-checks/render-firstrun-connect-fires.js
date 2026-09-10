// Browser-check-surface: fr-llm-connect fr-pane-5
/**
 * The first-run "Connect Claude" button (#fr-llm-connect) must actually FIRE the
 * connect flow when clicked (Josh 0.6.39 test, item #3: "Connect Claude is dead --
 * tappable but unresponsive").
 *
 * 🛑 THE BUG THIS REDS ON. #fr-llm-connect lives in #fr-pane-5, but its click
 * handler used to be DELEGATED on #fr-pane-3 (`getElementById('fr-pane-3')
 * .addEventListener('click', e => e.target.closest('#fr-llm-connect') ...)`). A
 * click on a pane-5 button never bubbles to a pane-3 listener, so frConnectStart
 * was never invoked -- the button was tappable and inert. The fix binds a DIRECT
 * listener on the button. This check clicks the button and asserts the flow
 * fires; on the buggy delegated code it stays unfired and REDS.
 *
 * WHY NOT A SOURCE/UNIT TEST. The defect is a DOM event-delegation mismatch
 * between a listener's container and the button's actual ancestor -- invisible to
 * a source read (both the listener and the button exist and look correct) and to
 * the node unit suite (it never mounts the page or dispatches a real click). Only
 * dispatching a click against the real DOM and observing whether the handler runs
 * can tell a wired button from a dead one.
 *
 * frConnectStart is stubbed so the real confirm/download/POST flow does not run --
 * we assert only that the CLICK REACHES THE HANDLER, which is exactly what the bug
 * broke. It is a top-level `async function` (a classic-script global), so
 * reassigning window.frConnectStart replaces what the handler's unqualified call
 * resolves to.
 *
 * ⚠️ HERMETIC: loads web/index.html over file://, boots no server, dispatches
 * clicks and reads a flag. No /api, no board -- fits the browser-checks.sh loop.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-firstrun-connect-fires.js
 *   (HEADED by default; HEADED=0 on a console-less machine, as run_one sets it.)
 */
'use strict';

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-firstrun-connect-fires: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const ENGINES = ['chromium', 'webkit'];

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

    // Structural precondition: the button is inside pane-5 (not pane-3). If this
    // ever stops being true the bug's shape has changed and the click test below
    // would need re-aiming, so assert it explicitly.
    const where = await page.evaluate(() => {
      const b = document.getElementById('fr-llm-connect');
      if (!b) return { noButton: true };
      const pane = b.closest('.fr-pane');
      return { paneId: pane ? pane.id : null };
    });
    check(`${engine}: #fr-llm-connect exists inside a first-run pane`,
      where.paneId === 'fr-pane-5',
      `pane ${JSON.stringify(where.paneId)}`);

    // Click the button; assert the connect flow fires. __fired is 0 BEFORE the
    // click (so the increment is caused by the click, not ambient) and 1 after.
    const fired = await page.evaluate(() => {
      if (typeof frConnectStart !== 'function') return { noFn: true };
      window.__fired = 0;
      // Stub so the real confirm/download/POST does not run; we test wiring only.
      window.frConnectStart = () => { window.__fired += 1; return Promise.resolve(); };
      const box = document.getElementById('fr-claude-confirm');
      if (box) box.hidden = true; // ensure the handler takes the connect branch
      const before = window.__fired;
      const b = document.getElementById('fr-llm-connect');
      b.click();
      return { before, after: window.__fired };
    });
    check(`${engine}: clicking Connect Claude fires the connect flow`,
      !fired.noFn && fired.before === 0 && fired.after === 1,
      JSON.stringify(fired));

    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
