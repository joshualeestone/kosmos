'use strict';

/**
 * #2186: Enter/Return activates Continue on an install-wizard step when the step
 * is valid -- the keyboard equivalent of clicking Continue, wizard-wide.
 *
 * 🛑 DRIVEN IN A REAL BROWSER, through the real frEnterSubmit handler, not
 * grepped. The unit suite (web.firstrun-enter-2186.test.js) runs the handler's
 * decision against stub events; this proves the LIVE wiring: a real keydown on a
 * real focused field, dispatched by the browser, reaches the listener on
 * #firstrun and advances the wizard exactly as a Continue click would.
 *
 * The arms use the About-you step, whose Continue is GATED (disabled until the
 * name + does fields are filled), so the same screen gives both:
 *   - invalid step (fields empty, Continue disabled): Enter does NOT advance;
 *   - valid step (fields filled, Continue enabled): Enter DOES advance.
 * The contrast is the discriminator -- a handler that always fired, or never
 * fired, reds one arm. (Held-Enter/e.repeat and the textarea/IME carve-outs are
 * covered by the unit test; the browser cannot cheaply simulate key auto-repeat.)
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-firstrun-enter-2186.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-enter-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-enter-' + t)); ROOTS.push(d); return d; };
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
const { stepForAnchor } = require('./lib-firstrun-steps.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'enter-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// The id of the single visible numbered pane, or '' if none. "Advanced" means
// this changed away from the About-you pane.
async function visiblePane(page) {
  return page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.fr-pane'))
      .filter((el) => /^fr-pane-\d+$/.test(el.id || '') && !el.hidden);
    return p.length === 1 ? p[0].id : (p.length ? 'MULTIPLE:' + p.map((x) => x.id).join(',') : '');
  });
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

    // Discover + deep-link to the About-you step (key on identity, not index).
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '#fr-you');
    await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`#fr-pane-${step}:not([hidden])`, { timeout: 8000 });
    await page.waitForSelector('#fr-you-name', { timeout: 8000 });

    const aboutPane = `fr-pane-${step}`;

    // Sanity: we are on About-you and its Continue starts disabled (fields empty).
    chk((await visiblePane(page)) === aboutPane, 'landed on the About-you step', 'pane=' + aboutPane);
    const disabledAtStart = await page.evaluate(() => {
      const n = document.getElementById('fr-next');
      return !!n && (n.disabled || n.getAttribute('aria-disabled') === 'true');
    });
    chk(disabledAtStart, 'Continue starts disabled on the empty About-you step (the gate this arm needs)');

    // ARM 1 (invalid step): Enter with empty fields must NOT advance.
    await page.focus('#fr-you-name');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    chk((await visiblePane(page)) === aboutPane,
      'Enter on an INVALID step does nothing (still on About-you)', 'pane=' + (await visiblePane(page)));

    // ARM 2 (valid step): fill the fields, then Enter must advance -- exactly as
    // a Continue click would. Catch the real PUT /api/you the Continue fires so
    // this proves the handler triggered Continue's action, not just a repaint.
    await page.fill('#fr-you-name', 'Alex');
    await page.fill('#fr-you-do', 'I run a company');
    await page.waitForFunction(() => {
      const n = document.getElementById('fr-next');
      return !!n && !n.disabled && n.getAttribute('aria-disabled') !== 'true';
    }, { timeout: 8000 });
    await page.screenshot({ path: path.join(OUT, `fr-enter-${step}-filled.png`) });
    console.log('screenshot: ' + path.join(OUT, `fr-enter-${step}-filled.png`));

    const youPost = page.waitForRequest(
      (r) => r.url().includes('/api/you') && r.method() === 'PUT', { timeout: 8000 });
    await page.focus('#fr-you-name');
    await page.keyboard.press('Enter');
    let sawPost = true;
    try { await youPost; } catch { sawPost = false; }
    chk(sawPost, 'Enter on a VALID step fires Continue\'s action (PUT /api/you observed)');

    // And the wizard actually advanced off About-you.
    await page.waitForFunction((pane) => {
      const el = document.getElementById(pane);
      return el && el.hidden;
    }, aboutPane, { timeout: 8000 }).catch(() => { /* asserted next */ });
    const after = await visiblePane(page);
    chk(after !== aboutPane && after !== '' && !after.startsWith('MULTIPLE'),
      'Enter on a VALID step advanced the wizard (equivalent to clicking Continue)',
      'from=' + aboutPane + ' to=' + after);

    chk(errs.length === 0, 'no page errors across the Enter arms', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall first-run Enter->Continue (#2186) checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
