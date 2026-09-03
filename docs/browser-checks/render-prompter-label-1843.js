'use strict';
/**
 * The Automation section's second control reads "Prompter", on a screen (#1843).
 *
 * 🔑 A RENAME IS EXACTLY THE CHANGE A SOURCE GREP CANNOT VOUCH FOR. The visible
 * name lives in an h3 that is painted, not templated, and the section is behind
 * a settings nav pill that has to be clicked before the box has any height.
 * "index.html says Prompter" is true of a box nobody can see; only the ELEMENT,
 * after the click, says the person reads Prompter.
 *
 * What this pins, and why each line can fail:
 *  - the automation nav pill puts #s-sec-automation on screen (height > 0),
 *  - the section's two control headings read exactly ["Auto-save", "Prompter"]
 *    in order -- so a future edit that drops the rename, or renames the wrong
 *    box, goes red,
 *  - no visible text inside the section still reads "Heartbeat" (the old name),
 *  - the save button's accessible name is "Save prompter settings" (a screen
 *    reader says the new name too, not just a sighted reader).
 *
 * SURFACE-ONLY by design (see the box comment in web/index.html): the ids stay
 * hb-*, the route stays /api/heartbeat-setting. This check asserts the SURFACE,
 * so it must never assert on those internal names -- doing so would re-couple
 * the check to the thing the rename deliberately left alone.
 *
 * Not part of `npm test` -- it needs a browser, and this repo has no
 * dependencies. See README.md in this directory for the sandboxed recipe.
 *
 *   node docs/browser-checks/render-prompter-label-1843.js            # headed
 *   HEADED=0 node docs/browser-checks/render-prompter-label-1843.js   # headless
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandboxed whole or the board refuses to start (#634): the four dirs and an inert tmux.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prompter-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prompter-workers-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prompter-projects-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prompter-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prompter-config-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const srv = require('../../server.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('april', { state: 'idle', displayName: 'April', role: 'a researcher' })]);
  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    // Both themes, because a rename that only lands in one token system would be
    // a light-only pass -- the pattern render-fields.js exists to defeat.
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, colorScheme: theme });
      await page.goto(URL, { waitUntil: 'networkidle' });
      if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
      await page.click('.tab[data-tab="settings"]');
      await page.waitForSelector('#panel-settings:not([hidden])');
      await page.waitForTimeout(800);
      await page.click('#s-nav button[data-go="automation"]');
      // Wait for the click to actually put the section on screen, rather than a
      // fixed sleep -- a height still 0 after this is a real failure, not a race.
      await page.waitForFunction(
        () => document.getElementById('s-sec-automation').getBoundingClientRect().height > 0,
        null, { timeout: 8000 },
      ).catch(() => {});

      const sec = await page.evaluate(() => {
        const el = document.getElementById('s-sec-automation');
        const vis = (n) => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);
        const headings = [...el.querySelectorAll('h3.dlab')].map((h) => h.textContent.trim());
        const promHeading = [...el.querySelectorAll('h3.dlab')].find((h) => h.textContent.trim() === 'Prompter');
        // #2054: the Prompter is now a .toggle slider (no Save button).
        const tog = el.querySelector('#hb-toggle');
        // Walk visible text nodes so a comment reading "heartbeat" cannot count.
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let heartbeatSeen = false; let n;
        while ((n = walker.nextNode())) {
          if (n.parentElement && vis(n.parentElement) && /heartbeat/i.test(n.nodeValue)) heartbeatSeen = true;
        }
        return {
          height: el.getBoundingClientRect().height,
          promVisible: !!(promHeading && vis(promHeading)),
          headings,
          promToggle: !!(tog && vis(tog)),
          promToggleAria: tog ? tog.getAttribute('aria-label') : null,
          heartbeatSeen,
        };
      });

      chk(sec.height > 0, `[${theme}] automation section is on screen after the pill click`, String(sec.height));
      // Visible, not merely present in the DOM -- this is what makes the
      // heartbeatSeen check below non-vacuous (a height-0 section would let a
      // "no visible Heartbeat" pass mean nothing).
      chk(sec.promVisible, `[${theme}] the Prompter heading is actually visible on screen`, String(sec.promVisible));
      // #2054: three blocks now -- Auto-save, Prompter, and the moved "Agents talking
      // to each other" limit. Daily report (#2037) is not built yet.
      chk(JSON.stringify(sec.headings) === JSON.stringify(['Auto-save', 'Prompter', 'Agents talking to each other']),
        `[${theme}] the Automation headings read Auto-save, Prompter, Agents talking`, JSON.stringify(sec.headings));
      // #2054: the Prompter is a .toggle slider on screen with the visible-word aria.
      chk(sec.promToggle === true && sec.promToggleAria === 'Ask me to check on any agent that has stopped',
        `[${theme}] the Prompter is a slider on screen with its accessible name`, JSON.stringify({ t: sec.promToggle, a: sec.promToggleAria }));
      chk(sec.heartbeatSeen === false,
        `[${theme}] no visible text in the section still reads Heartbeat`, String(sec.heartbeatSeen));
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fail.length ? `\nFAIL: ${fail.length}` : '\nAll checks passed');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
