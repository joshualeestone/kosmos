'use strict';

/**
 * The first-run name/identity step (frPaintYou -> #fr-you), #1994 live fixes.
 *
 * Josh's live test, Mona Lisa's build (2026-09-04); tz REMOVAL by Angel (#3338, 2026-09-21):
 *   1. The time zone picker is REMOVED from this step (#3338, Josh 0.6.84: asking
 *      for a city/ZIP read as invasive data collection). The machine zone is
 *      captured SILENTLY on Continue instead, so an agent still knows the
 *      operator's local time.
 *   2. The name input is width-capped so it is not full-width; "What do you do?"
 *      (a sentence) keeps the full width.
 *   3. The "Continue saves this into every agent already set up on this
 *      computer..." copy line is GONE.
 * Ref: Josh #admin msg 1545459091105652736.
 *
 * 🛑 ASSERTED IN A REAL RENDER, not by grepping the file. The width cap is a
 * COMPUTED-style comparison (a class/rule that no longer matches would pass a
 * source grep and fail on screen), the tz picker's ABSENCE is read off the
 * rendered pane, and the SILENT save is verified by CATCHING the real POST
 * /api/settings the Continue fires -- so the check proves the wiring, not just the
 * markup. Each arm is written so it would FAIL on the wrong markup (tz select
 * PRESENT, name box full-width, reach copy present, Continue not saving a
 * timezone), so the check discriminates.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-firstrun-namestep-1994wiz.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-namestep-'));
const ROOTS = [SANDBOX];
const mkroot = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-namestep-' + t)); ROOTS.push(d); return d; };
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

const OUT = process.env.SHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'namestep-shots-'));
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
}

(async () => {
  // A fixture fleet so the server's tmux reads answer from the fixture, never a
  // live fleet (AGENT_WORKFORCE_TMUX_BIN is /bin/echo; the same guard the sibling
  // checks satisfy -- a /bin/echo check with no fleet.install is caught).
  fleet.install([fleet.agent('beatrix', { state: 'idle', displayName: 'Beatrix' })]);
  const server = await srv.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 820 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // Discover the name step from its own field anchor (#1214/#1801 renumbered the
    // panes; a hard-coded number would rot), then deep-link straight to it.
    // #fr-you is the static pane container; the name/does/tz fields are painted
    // into it by frPaintYou once the step is shown, so discover on the container.
    await page.goto(`${BASE}/?first-run=1`, { waitUntil: 'domcontentloaded' });
    const step = await stepForAnchor(page, '#fr-you');
    await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`#fr-pane-${step}:not([hidden])`, { timeout: 8000 });
    await page.waitForSelector('#fr-you-name', { timeout: 8000 });
    const m = await page.evaluate((paneStep) => {
      const pane = document.getElementById('fr-pane-' + paneStep);
      const you = document.getElementById('fr-you');
      const nameEl = document.getElementById('fr-you-name');
      const doEl = document.getElementById('fr-you-do');
      // Absence assertion: the removed fr-you-reach copy must be gone. Written as
      // a `=== null` test (not a bare lookup) so the #758 selector guard reads it
      // as an absence check rather than a live id reference.
      const reachGone = document.getElementById('fr-you-reach') === null;
      // #3338 removal: the time-zone picker is gone from this step. `=== null` so
      // the #758 selector guard reads it as an absence check, not a live id ref.
      const tzGone = document.getElementById('fr-you-tz') === null
        && document.getElementById('fr-you-tz-search') === null;
      const nameCs = nameEl ? getComputedStyle(nameEl) : null;
      const doCs = doEl ? getComputedStyle(doEl) : null;
      // Count LABELLED fields inside the you-block (a <label for=…> with a control
      // that exists) -- the #1345 "exactly two" claim this deliberately reverses.
      const labelled = you
        ? Array.from(you.querySelectorAll('label.fieldlab[for]'))
            .map((l) => l.getAttribute('for'))
            .filter((id) => document.getElementById(id))
        : [];
      return {
        paneText: (pane ? pane.textContent : '').replace(/\s+/g, ' ').trim(),
        reachGone,
        tzGone,
        nameExists: !!nameEl,
        doExists: !!doEl,
        nameMaxWidth: nameCs ? nameCs.maxWidth : '',
        nameWidthPx: nameEl ? nameEl.getBoundingClientRect().width : 0,
        doMaxWidth: doCs ? doCs.maxWidth : '',
        doWidthPx: doEl ? doEl.getBoundingClientRect().width : 0,
        labelledFor: labelled,
      };
    }, step);

    // (3) the reach copy is gone -- element AND its sentence.
    chk(m.reachGone, 'the fr-you-reach copy element is gone (removed)');
    chk(!/Continue saves this into every agent already set up on this computer/.test(m.paneText),
      'the "Continue saves this into every agent..." copy line is gone', m.paneText.slice(0, 70));

    // (1) #3338 removal (Josh, 0.6.84): the time-zone picker is GONE from this
    // step -- asking for a city/ZIP read as invasive data collection. The machine
    // zone is captured SILENTLY on Continue instead (proven in the save arm below).
    chk(m.tzGone, 'the time-zone picker (fr-you-tz) and its city/ZIP search are removed from the step');

    // (5) two labelled fields (name, does) -- the tz field is gone again.
    chk(m.labelledFor.length === 2
        && m.labelledFor.includes('fr-you-name')
        && m.labelledFor.includes('fr-you-do'),
      'two labelled fields: name, does (the tz field was removed, #3338)',
      'labels=' + m.labelledFor.join(','));

    // (2) the name box is width-capped; "What do you do?" is NOT (full width).
    // COMPUTED, so a phantom rule that no longer matches would red here. The
    // contrast (name capped, does uncapped) is the discriminator, and the
    // rendered widths corroborate the computed max-width.
    const nameCapped = /px$/.test(m.nameMaxWidth) && isFinite(parseFloat(m.nameMaxWidth)) && parseFloat(m.nameMaxWidth) < 500;
    chk(nameCapped, 'the name input has a capped max-width (not full-width)', 'name max-width=' + m.nameMaxWidth);
    chk(m.doMaxWidth === 'none', 'the "What do you do?" input keeps full width (max-width none)', 'does max-width=' + m.doMaxWidth);
    chk(nameCapped && m.doWidthPx > m.nameWidthPx + 10,
      'the name box renders narrower than the "does" box (cap is specific, not global)',
      'name=' + Math.round(m.nameWidthPx) + 'px does=' + Math.round(m.doWidthPx) + 'px');

    // (1b) the save wiring: filling name + does and pressing Continue POSTs the
    // timezone to /api/settings. Catch the REAL request, so this proves the
    // Continue actually saves the zone (pre-#1994 there was no tz to save).
    await page.fill('#fr-you-name', 'Alex');
    await page.fill('#fr-you-do', 'I run a company');

    // Screenshot and the page-error arm are scoped to the NAME STEP, before the
    // Continue click advances the wizard: the shot must show the filled name step
    // (not the step it advances to), and a pageerror from the NEXT step's paint
    // must not red an arm that is about this step.
    await page.screenshot({ path: path.join(OUT, `fr-pane-${step}-namestep.png`) });
    console.log('screenshot: ' + path.join(OUT, `fr-pane-${step}-namestep.png`));
    chk(errs.length === 0, 'no page errors rendering the name step', errs.join(' | '));

    // #3338 removal: Continue captures the machine zone SILENTLY (never asked), so
    // an agent still knows the operator's local time.
    const machineZone = await page.evaluate(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } });
    const settingsPost = page.waitForRequest(
      (r) => r.url().includes('/api/settings') && r.method() === 'POST',
      { timeout: 8000 });
    await page.click('#fr-next');
    let postBody = null;
    try { postBody = JSON.parse((await settingsPost).postData() || 'null'); }
    catch { postBody = null; }
    chk(!!postBody && typeof postBody.timezone === 'string' && postBody.timezone !== '',
      'Continue silently POSTs /api/settings with a timezone (never asked)', 'body=' + JSON.stringify(postBody));
    chk(!!postBody && postBody.timezone === machineZone,
      'the POSTed timezone is this computer\'s zone (silent auto-detect, not a picked value)', 'posted=' + (postBody && postBody.timezone) + ' machine=' + machineZone);
  } finally {
    await browser.close();
    server.close();
    fleet.restore();
    for (const d of ROOTS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall first-run name-step (#1994) checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
