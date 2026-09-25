// Browser-check-surface: d-busy
'use strict';
/**
 * #3421 (Josh, 0.6.88 live test): the "X is working..." busy line's three-dot
 * `.act` animation "plays four times and then hard-resets" with an abrupt pop.
 *
 * Root cause: paintBusy ran `el.innerHTML = busyRow(...)` UNCONDITIONALLY every
 * ~5s poll, recreating the `.act` dots' DOM nodes and restarting their CSS `work`
 * loop from 0% (1.1s x ~4.5 = ~5s -> "four times then reset"). The keyframes were
 * always seamless + infinite; the node was being rebuilt under them. The fix
 * guards the rewrite on a data-key so an unchanged working agent keeps ONE
 * continuous animation, and still rebuilds when the agent/state/name/avatar
 * changes.
 *
 * This drives the REAL paintBusy against a real fixture and asserts DOM-node
 * IDENTITY across repaints (node preserved = animation uninterrupted), plus a
 * control that a real change DOES rebuild (so the guard is not a frozen node).
 *
 *   node docs/browser-checks/render-busy-anim-3421.js            # headed
 *   HEADED=0 node docs/browser-checks/render-busy-anim-3421.js   # headless
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-busy-anim-3421.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ba-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ba-workers-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ba-config-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ba-launch-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ba-projects-'));
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

const { chromium } = require('playwright');
const fleet = require('../../test-support/fleet');
const create = require('../../engine/create');
const srv = require('../../server.js');

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'ba-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  fleet.install([
    fleet.agent('alexandra', { state: 'working', displayName: 'Alexandra', role: 'Analyst' }),
    fleet.agent('bruno', { state: 'idle', displayName: 'Bruno', role: 'Bookkeeper' }),
  ]);
  fs.writeFileSync(create.plistPath('alexandra'),
    create.plistFor('alexandra', '/bin/echo', '/opt/homebrew/bin/tmux', 'claude-sonnet-5'), 'utf8');

  const server = await srv.start(0);
  const URL = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    await page.waitForSelector('[data-agent="alexandra"]', { timeout: 8000 });

    // Open the working agent and render the busy line via the REAL paintBusy.
    const first = await page.evaluate(() => {
      openDetail('alexandra');
      paintBusy(CURRENT, CURRENT.name);
      const el = document.getElementById('d-busy');
      const act = el && el.querySelector('.act');
      if (act) act.dataset.probe = 'orig';   // tag THIS node so we can detect a rebuild
      return {
        shown: !!el && !el.hidden,
        hasAct: !!act,
        dots: act ? act.querySelectorAll('i').length : 0,
        busyKey: el ? (el.dataset.busyKey || '') : '',
      };
    });
    chk(first.shown && first.hasAct, 'a working agent shows the "is working" busy line with .act dots', JSON.stringify(first));
    chk(first.dots === 3, 'the working glyph has its three dots', String(first.dots));

    // Repaint several times with the SAME working agent (simulating polls). The
    // .act node must be PRESERVED (probe survives) = the CSS animation is never
    // restarted. Without the guard, innerHTML is rewritten and the probe is gone.
    const afterPolls = await page.evaluate(() => {
      for (let i = 0; i < 4; i++) paintBusy(CURRENT, CURRENT.name);
      const act = document.querySelector('#d-busy .act');
      return { probe: act ? (act.dataset.probe || '') : '(no .act)' };
    });
    chk(afterPolls.probe === 'orig',
      'repeated polls do NOT recreate the .act node (animation runs continuously)', JSON.stringify(afterPolls));

    // A WORKING agent's stateEvidence changes poll-to-poll (its screen text). The
    // key must IGNORE evidence while working, or the .act dots would rebuild every
    // poll again -- the exact reset this fix removes. Assert the node survives an
    // evidence change while working.
    const evWorking = await page.evaluate(() => {
      CURRENT.stateEvidence = 'some changing screen text ' + Date.now();
      paintBusy(CURRENT, CURRENT.name);
      const act = document.querySelector('#d-busy .act');
      return { probe: act ? (act.dataset.probe || '') : '(no .act)' };
    });
    chk(evWorking.probe === 'orig',
      'a WORKING agent ignores stateEvidence changes (animation not reset by screen churn)', JSON.stringify(evWorking));

    // Control: a real change (state -> auth_failed) MUST rebuild the line, so the
    // guard is a change-guard, not a frozen node.
    const changed = await page.evaluate(() => {
      CURRENT.state = 'auth_failed';
      CURRENT.stateEvidence = 'first evidence';
      paintBusy(CURRENT, CURRENT.name);
      const el = document.getElementById('d-busy');
      const act = el && el.querySelector('.act');
      return {
        rebuilt: !act || act.dataset.probe !== 'orig',   // node replaced (or .act gone for auth_failed)
        busyKeyChanged: el ? (el.dataset.busyKey || '') : '',
      };
    });
    chk(changed.rebuilt, 'CONTROL: a real state change rebuilds the line (guard is not a frozen node)', JSON.stringify(changed));

    // An auth_failed agent renders "last seen: <stateEvidence>". Unlike working,
    // that line MUST refresh when the evidence changes (it has no .act dots to
    // preserve), so the key includes stateEvidence ONLY for auth_failed. Assert a
    // second evidence value re-renders the line.
    const evAuth = await page.evaluate(() => {
      const before = (document.getElementById('d-busy').textContent || '');
      CURRENT.state = 'auth_failed';
      CURRENT.stateEvidence = 'second evidence CHANGED';
      paintBusy(CURRENT, CURRENT.name);
      const after = (document.getElementById('d-busy').textContent || '');
      return { before, after, refreshed: /second evidence CHANGED/.test(after) };
    });
    chk(evAuth.refreshed,
      'an auth_failed line refreshes when its "last seen" evidence changes', JSON.stringify(evAuth.after.slice(0, 80)));

    chk(errs.length === 0, 'no page errors', errs.join(' | '));
    await page.screenshot({ path: path.join(OUT, 'busy-anim.png'), clip: { x: 0, y: 0, width: 480, height: 200 } }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(fail.length ? '\nFAILED: ' + fail.join(', ') : '\nall good');
  process.exit(fail.length ? 1 : 0);
})();
