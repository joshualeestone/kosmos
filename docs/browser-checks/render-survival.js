'use strict';

/**
 * The restart-survival notice, as a person actually sees it (#277; a compact notice per agent since #6714).
 *
 * 🔑 IT ASSERTS THE RENDERED STATE. The unit tests read the markup this panel
 * writes; nothing in them has ever rendered a page, which is how a fully
 * transparent modal once survived 316 tests here. What matters about this
 * panel is that somebody LOOKS at their board and finds out, so the claims are
 * visibility, size (a compact notice, not a full-width card: #6714) and that each of its three actions works.
 *
 * Run against a sandboxed board, never the operator's real data. It also needs
 * AGENT_WORKFORCE_DRY_RUN=1: the button writes launchd jobs and starts
 * processes, and launchd has no sandbox root to point somewhere harmless.
 *
 *   SB=$(mktemp -d); mkdir -p "$SB/data/Kosmos/profiles" "$SB/workers/brigitte"
 *   echo '{"role":"helper"}' > "$SB/data/Kosmos/profiles/brigitte.json"
 *   echo '{"role":"helper"}' > "$SB/data/Kosmos/profiles/marilyn.json"; mkdir -p "$SB/workers/marilyn"
 *   echo '{"role":"helper"}' > "$SB/data/Kosmos/profiles/leftover.json"; mkdir -p "$SB/workers/leftover"
 *   mkdir -p "$SB/data/Kosmos/liveness"   # #6714: brigitte and marilyn have run; leftover never has
 *   for n in brigitte marilyn; do echo '{"at":"2026-10-20T00:00:00Z"}' > "$SB/data/Kosmos/liveness/$n.json"; done
 *   AGENT_WORKFORCE_DRY_RUN=1 AGENT_WORKFORCE_DATA="$SB/data" \
 *     AGENT_WORKFORCE_WORKERS="$SB/workers" AGENT_WORKFORCE_LAUNCH="$SB/launch" \
 *     PORT=17351 node server.js &
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" \
 *     KOSMOS_URL=http://127.0.0.1:17351 node docs/browser-checks/render-survival.js /tmp/survshots
 *
 * ⚠️ HEADED by default. Headless is SwiftShader software rendering and its
 * screenshots differ from the real compositor on every pixel, which reads as a
 * visual regression and is a GPU.
 */

const { chromium } = require('playwright');
const path = require('node:path');

const URL = process.env.KOSMOS_URL || 'http://127.0.0.1:17351';
const OUT = process.argv[2] || '/tmp/survshots';
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  const b = await chromium.launch({ headless: process.env.HEADED === '0' });
  /* Dark first, looking only: the light pass then presses the buttons, and a started agent leaves the board. */
  for (const theme of ['dark', 'light']) {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    await pg.goto(URL, { waitUntil: 'networkidle' });
    if (!(await pg.$('#firstrun[hidden]'))) { await pg.keyboard.press('Escape'); await pg.waitForTimeout(500); }
    await pg.waitForTimeout(1200);

    await pg.waitForSelector('#survival-slot .utoast.survival', { state: 'visible', timeout: 15000 });
    const notes = await pg.$$('#survival-slot .utoast.survival');
    chk(notes.length === 2, theme + ': one notice per agent that has run (brigitte, marilyn)', String(notes.length));
    const txt = await pg.innerText('#survival-slot');
    chk(/will not come back after a restart/.test(txt), theme + ': it says what is wrong');
    chk(/brigitte/.test(txt) && /marilyn/.test(txt), theme + ': it names each agent');
    chk(!/leftover/.test(txt), theme + ': a folder that never ran is not an agent (#6714)');
    const box = await notes[0].boundingBox();
    const vw = pg.viewportSize().width;
    chk(Boolean(box && box.width <= 470 && box.width < vw / 2), theme + ': a compact notice, not a full-width card (#6714)', JSON.stringify(box));
    for (const sel of ['[data-survival-fix="brigitte"]', '[data-survival-remove="brigitte"]', '[data-survival-hide="brigitte"]']) {
      chk(Boolean(await pg.$('#survival-slot ' + sel)), theme + ': brigitte has ' + sel);
    }
    await pg.screenshot({ path: path.join(OUT, 'survival-before-' + theme + '.png'), fullPage: false });
    if (theme === 'light') {
      // Remove opens the agent page's own dialog, about this agent; leaving it running changes nothing.
      await pg.click('[data-survival-remove="marilyn"]');
      await pg.waitForSelector('#rm-modal:not([hidden])', { timeout: 10000 });
      chk(/marilyn/i.test(await pg.innerText('#rm-go')), theme + ': Remove asks about marilyn');
      await pg.click('#rm-keep');
      // The x hides marilyn, and Settings > Computer lists her with Show again.
      await pg.click('[data-survival-hide="marilyn"]');
      await pg.waitForFunction(() => !document.querySelector('[data-survival-fix="marilyn"]'), null, { timeout: 10000 });
      chk(true, theme + ': the x took marilyn off the board');
      // The notice goes first and the list is read from the board after it, so wait for the list, not the notice.
      await pg.waitForFunction(() => /marilyn/.test(document.getElementById('survival-hidden-list').textContent), null, { timeout: 10000 }).catch(() => {});
      const hiddenRow = await pg.evaluate(() => document.getElementById('survival-hidden-list').textContent   /* the Settings screen is not open, so innerText is '' */);
      chk(/marilyn/.test(hiddenRow), theme + ': Settings lists marilyn as hidden', hiddenRow);
      await pg.evaluate(() => document.querySelector('[data-survival-show="marilyn"]').click());
      await pg.waitForSelector('[data-survival-fix="marilyn"]', { timeout: 10000 });
      chk(true, theme + ': Show again brings marilyn back');
      // Start at login for brigitte only.
      await pg.click('[data-survival-fix="brigitte"]');
      await pg.waitForSelector('#survival-report-slot .utoast.survival.done', { timeout: 15000 });
      const after = await pg.innerText('#survival-report-slot');
      chk(/brigitte/.test(after) && /login/.test(after), theme + ': the report names brigitte', after.slice(0, 80).replace(/\n/g, ' '));
      chk(Boolean(await pg.$('[data-survival-fix="marilyn"]')), theme + ': starting brigitte left marilyn alone');
      await pg.screenshot({ path: path.join(OUT, 'survival-' + theme + '.png'), fullPage: false });
    }
    chk(errs.length === 0, theme + ': no console errors', errs.join(' | '));
    await pg.close();
  }
  await b.close();
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
