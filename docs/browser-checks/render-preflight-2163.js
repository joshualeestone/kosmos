'use strict';

/**
 * The pre-flight expectations interstitial (#2163, Josh 2026-09-04).
 *
 * Josh asked for a screen BEFORE the setup steps that says "you're going to get
 * warned by these sorts of things because you're setting your agent up to help
 * run the computer" -- so a new user is not alarmed by the macOS permission
 * gauntlet. It is an INTERSTITIAL, outside the numbered step count (like the
 * Success screen): the Success screen's "Set up Kosmos" button leads INTO it, and
 * its Continue leads into the numbered flow at Welcome.
 *
 * 🛑 DRIVEN THROUGH THE REAL FLOW, not deep-linked: the interstitial is only
 * reachable from the Success button, so the check clicks through Success -> the
 * interstitial -> Welcome and asserts the panes at each step. Each arm reds on the
 * pre-#2163 flow (Success -> Welcome directly, no interstitial).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-preflight-2163.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preflight-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preflight-' + t)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const srv = require('../../server.js');
const fleet = require('../../test-support/fleet');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'networkidle' });

    // Step 1: the Success screen, with "Set up Kosmos".
    await page.waitForSelector('#fr-pane-1:not([hidden])', { timeout: 8000 });
    chk(/Set up Kosmos/.test(await page.locator('#fr-next').textContent()), 'the Success screen offers "Set up Kosmos"');
    chk(await page.locator('#fr-pane-intro').isHidden(), 'the interstitial is hidden on the Success screen');

    // Click "Set up Kosmos" -> the pre-flight interstitial (NOT Welcome directly).
    await page.click('#fr-next');
    await page.waitForSelector('#fr-pane-intro:not([hidden])', { timeout: 8000 });
    chk(!(await page.locator('#fr-pane-intro').isHidden()), 'clicking Set up Kosmos shows the pre-flight interstitial BEFORE the setup steps');
    // WCAG 2.1 SC 4.1.3 (the project floor): entering the interstitial must move
    // focus to its title, exactly as frGo does on every numbered step, or a
    // screen-reader user is moved to a new screen with no announcement.
    chk(await page.evaluate(() => document.activeElement && document.activeElement.id === 'fr-title'),
      'entering the interstitial focuses #fr-title (a screen-reader announcement, like every other step)');
    chk(await page.locator('#fr-pane-1').isHidden(), 'the Success screen is hidden while the interstitial shows');
    chk(await page.locator('#fr-pane-2').isHidden(), 'Welcome is NOT shown yet -- the interstitial comes first');
    const introText = (await page.locator('#fr-pane-intro').textContent()).replace(/\s+/g, ' ').trim();
    chk(/macOS will ask your permission/.test(introText), 'the interstitial sets expectations for the macOS permission prompts', introText.slice(0, 90));
    chk(/setting up agents to work on this computer/.test(introText), 'it frames the prompts as normal given what agents do');
    chk((await page.locator('#fr-eyebrow').textContent()) === 'What to expect', 'the eyebrow reads "What to expect"');
    chk(!/Step \d+ of/.test(await page.locator('#fr-step').textContent()), 'the interstitial stands OUTSIDE the numbered step count (no "Step N of M")');
    chk(/Continue/.test(await page.locator('#fr-next').textContent()), 'its action is Continue');

    // Continue -> the numbered flow enters at Welcome (step 2), interstitial hidden.
    await page.click('#fr-next');
    await page.waitForSelector('#fr-pane-2:not([hidden])', { timeout: 8000 });
    chk(!(await page.locator('#fr-pane-2').isHidden()), 'Continue from the interstitial enters the numbered flow at Welcome');
    chk(await page.locator('#fr-pane-intro').isHidden(), 'the interstitial is hidden once the numbered flow begins');
    chk(/Step 1 of/.test(await page.locator('#fr-step').textContent()), 'Welcome is step 1 of the counted steps (the interstitial did not consume a number)');

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall pre-flight interstitial checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
