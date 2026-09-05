'use strict';

/**
 * #2131: the terminal/agent screen is gated on Engineering (Advanced) mode.
 *
 * Josh, live test v0.6.28: the terminal showed on the Projects screen and the
 * conversation tab even with Engineering mode OFF; it should be gated on it. That
 * leak does NOT reproduce on current main (the eng-mode gating was hardened by
 * #370/#965/#2047 since), so this ships as a REGRESSION GUARD: it pins the invariant
 * so the leak cannot silently return.
 *
 * 🛑 THE CONTROL IS THE POINT. Asserting "hidden in Off" proves nothing if the
 * terminal is never shown at all. So each hidden-in-Off arm is paired with an ON arm
 * that makes the SAME element VISIBLE - the dangerous state - so the OFF assertion
 * means something. And the SAFETY arm pins the exemption the fix must never break: an
 * agent WAITING on an answer keeps its question terminal visible even in Off (it is
 * how the answer gets typed - safety, not chrome).
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-engmode-gate-2131.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-engmode-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-engmode-' + t)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = mkroot('workers-');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = mkroot('config-');
process.env.AGENT_WORKFORCE_LAUNCH = mkroot('launch-');
process.env.AGENT_WORKFORCE_PROJECTS = mkroot('projects-');
process.env.AGENT_WORKFORCE_TMUX_BIN = '/bin/echo';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.log('render-engmode-gate-2131: playwright not on NODE_PATH - SKIPPED, not passed.'); process.exit(0); }

const srv = require('../../server.js');
const fleet = require('../../test-support/fleet');

const fail = [];
let ran = 0;
function chk(ok, label, extra) {
  ran += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

// Computed visibility of an element by id (absent -> 'absent').
const VIS = `(id) => { const el = document.getElementById(id); if (!el) return 'absent'; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return (!el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0) ? 'VISIBLE' : 'hidden'; }`;
const firstViewportVis = `() => { const e = document.querySelector('.pj-viewport'); if (!e) return 'absent'; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return (!e.hidden && cs.display !== 'none' && r.height > 0) ? 'VISIBLE' : 'hidden'; }`;

(async () => {
  // Acquire INSIDE the try so the finally cleans up even if install/start/launch throws
  // (otherwise a throw there leaks the mkdtemp roots and the fleet seam mutation).
  let server, browser;
  try {
    fleet.install([
      fleet.agent('worky', { state: 'working', displayName: 'Worky' }),
      fleet.agent('asky', { state: 'needs_you', displayName: 'Asky' }),
    ]);
    server = await srv.start(0);
    const BASE = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: process.env.HEADED === '0' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (await page.$('#firstrun:not([hidden])')) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

    const setEng = async (on) => {
      await page.evaluate(async (v) => {
        await fetch('/api/engmode', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: v }) });
        if (typeof refreshEngMode === 'function') await refreshEngMode();
      }, on);
      await page.waitForTimeout(500);
    };
    const engNow = () => page.evaluate(() => (typeof ENG_ON !== 'undefined') ? ENG_ON : 'undef');
    const visId = (id) => page.evaluate(new Function('id', 'return (' + VIS + ')(id)'), id);
    const viewportVis = () => page.evaluate(new Function('return (' + firstViewportVis + ')()'));

    // A project with a composer agent (the "Projects screen"), then open it.
    await page.evaluate(async () => {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gate Test' }) });
      if (!r.ok) throw new Error('project create failed: ' + r.status);
      const body = await r.json();
      await fetch('/api/project/' + body.project.id + '/agent/composer', { method: 'POST', headers: { 'content-type': 'application/json' } });
    });
    await page.click('[data-tab="projects"]');
    await page.locator('#pj-list').getByText('Gate Test').first().click();
    await page.waitForSelector('#pj-room', { state: 'visible' }).catch(() => {});
    await page.waitForTimeout(400);

    // --- ARM 1: the project terminal is HIDDEN in Off (the feature / the fix) -------
    await setEng(false);
    chk((await engNow()) === false, 'precondition: Engineering mode is OFF', String(await engNow()));
    chk((await viewportVis()) === 'hidden', 'PROJECT: the raw terminal (.pj-viewport) is HIDDEN with Engineering mode OFF');
    chk((await visId('pj-thread')) === 'hidden', 'PROJECT: the one-to-one terminal box (#pj-thread) is HIDDEN with Engineering mode OFF');

    // --- ARM 2: the CONTROL - the same terminal is VISIBLE in On -------------------
    // Without this, "hidden in Off" could be a terminal that never renders at all.
    await setEng(true);
    chk((await engNow()) === true, 'control: Engineering mode toggled ON', String(await engNow()));
    chk((await viewportVis()) === 'VISIBLE', 'CONTROL: the raw terminal (.pj-viewport) IS VISIBLE with Engineering mode ON (so the OFF arm means something)');
    chk((await visId('pj-thread')) === 'VISIBLE', 'CONTROL: the one-to-one terminal box (#pj-thread) IS VISIBLE with Engineering mode ON');

    // Back to Off for the safety arm. (A DETAIL-view #d-window arm is deliberately
    // omitted: it needs a LIVE captured pane screen to ever render, which this
    // fleet-only harness does not provide, so a "hidden in Off" assertion on it would
    // pass whether or not the gate works - vacuous. The gate is PAGE-WIDE (ENG_ON), so
    // the project arms above with a real ON control prove the mechanism the detail view
    // shares, and the safety arm below is a real detail-view assertion.)
    await setEng(false);

    // --- ARM 3: SAFETY - an ASKING agent keeps its question terminal visible in Off -
    // The fix must NEVER hide this: it is how a waiting agent gets answered.
    // openDetail directly (the card can resolve to two nodes and sit under the open
    // detail panel; the real navigation entry point is openDetail either way).
    await page.evaluate(() => { if (typeof openDetail === 'function') openDetail('asky'); });
    await page.waitForSelector('#panel-detail:not([hidden])');
    await page.waitForTimeout(700);
    const qaskVis = await visId('d-qask');
    chk(qaskVis === 'VISIBLE', 'SAFETY: an asking agent keeps its question panel (#d-qask) VISIBLE even with Engineering mode OFF (never gated away - it is how the answer is typed)', qaskVis);

    chk(errs.length === 0, 'no page errors', errs.join(' | '));

    // Population floor: a gutted run that asserts nothing must not read green.
    if (ran < 8) { console.log('\nrender-engmode-gate-2131: only ' + ran + ' checks ran, so this proved nothing'); process.exit(1); }
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
    fleet.restore();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nrender-engmode-gate-2131: all ' + ran + ' checks passed (terminal gated on Engineering mode; question panel exempt)');
})().catch((e) => { console.error(e); process.exit(1); });
