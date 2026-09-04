'use strict';

/**
 * The first-run Accessibility Continue-GATE (#2125 slice 3, Josh 2026-09-04).
 *
 * Josh ruled: block Continue until Accessibility is actually enabled, verified.
 * The engine cannot read TCC, so the native app writes an AXIsProcessTrusted
 * reading (attributed to tmux) to a11y-status.json; the engine surfaces it at
 * /api/a11y-status; the first-run poll (frPollA11y) gates #fr-next on it.
 *
 * 🛑 THE GATE IS FAIL-SAFE AND POSITIVE-ONLY, and this check pins exactly that
 * with a control that returns the dangerous answer:
 *   - checkable:false (no native reading -- a browser, or not written yet) -> Continue ENABLED
 *   - checkable:true, trusted:false                                          -> Continue DISABLED  (the gate)
 *   - checkable:true, trusted:true                                           -> Continue ENABLED
 * The DISABLED arm is the feature; the two ENABLED arms are the controls that
 * prove the gate never strands a browser tester or a user whose reading we cannot
 * take. Driven in a REAL render against the live /api/a11y-status route.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-a11y-gate-2125.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-a11yg-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-a11yg-' + t)); ROOTS.push(d); return d; };
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
const a11ystatus = require('../../engine/a11ystatus');
const { stepForAnchor } = require('./lib-firstrun-steps.js');

const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// Write (or clear) the native reading the engine route reads.
function setReading(obj) {
  fs.mkdirSync(path.dirname(a11ystatus.FILE), { recursive: true });
  if (obj === null) { try { fs.rmSync(a11ystatus.FILE, { force: true }); } catch { /* */ } return; }
  fs.writeFileSync(a11ystatus.FILE, JSON.stringify(obj));
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
    // Discover the Accessibility step from its anchor, then deep-link to it.
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '#fr-a11y-open');

    // Load the pane with a given reading on file, wait for a poll tick, read the
    // gate state. Re-navigating restarts the poll against the current file.
    async function gateStateWith(reading) {
      setReading(reading);
      await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`#fr-pane-${step}:not([hidden])`, { timeout: 8000 });
      // The poll runs immediately on entry and then every 1.5s; wait past one tick.
      await page.waitForTimeout(1800);
      return page.evaluate(() => document.getElementById('fr-next').disabled);
    }

    // Sanity: the route matches the file (the engine read side is already unit-tested;
    // this confirms the browser is talking to the same store the check writes).
    setReading({ trusted: false, at: new Date().toISOString() });
    const routeSays = await page.evaluate(async (base) => (await (await fetch(base + '/api/a11y-status')).json()), BASE);
    chk(routeSays && routeSays.checkable === true && routeSays.trusted === false,
      'the /api/a11y-status route reflects the written reading', JSON.stringify(routeSays));

    // THE GATE: a positive not-trusted reading DISABLES Continue.
    chk((await gateStateWith({ trusted: false, at: new Date().toISOString() })) === true,
      'checkable:true + trusted:false -> Continue is DISABLED (the gate engages)');

    // CONTROL 1: a trusted reading ENABLES Continue.
    chk((await gateStateWith({ trusted: true, at: new Date().toISOString() })) === false,
      'checkable:true + trusted:true -> Continue is ENABLED');

    // CONTROL 2 (the fail-safe): no reading at all (a browser) leaves Continue ENABLED.
    chk((await gateStateWith(null)) === false,
      'no native reading (checkable:false) -> Continue stays ENABLED (fail-safe, never strands a browser)');

    // CONTROL 3: a stale reading is uncheckable -> also fail-safe ENABLED.
    chk((await gateStateWith({ trusted: false, at: new Date(Date.now() - (a11ystatus.STALE_AFTER_MS + 5000)).toISOString() })) === false,
      'a stale not-trusted reading is uncheckable -> Continue ENABLED (a days-old reading must not gate)');

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall fr-pane-5 accessibility-gate checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
