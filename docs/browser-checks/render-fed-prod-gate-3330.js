// Browser-check-surface: data-source-channel pj-mode pj-add-ext-person pj-add-ext-agent pj-invite-panel pj-join-mode
'use strict';
/**
 * fed-prod-gate: the #3312 federation UI is gated to the STAGING channel (#3330).
 *
 * WHAT THIS EXISTS TO CATCH. Federation is a client-only MVP (no transport, no coordinator,
 * no /api/federation/* routes), so its external doors open onto nothing. #3330 hides it on
 * the prod channel and reveals it on staging with ONE CSS rule keyed on data-source-channel,
 * which the status tick stamps on <html> from /api/status. Both are COMPUTED results a source
 * grep cannot see: a rule that loses to a more specific selector would leave the not-ready
 * fed UI on a prod board while every markup assertion passed, and a rule that hid the entry
 * points in EVERY channel would break the staging review surface while a prod-only check
 * stayed green. So this stamps the channel the way the tick does and reads what a person sees.
 *
 * THREE ARMS + A CONTROL, and staging is the load-bearing control.
 *   - prod: the fed entry points (.pj-mode toggle, the two #pj-add-ext-* doors, #pj-invite-panel,
 *     #pj-join-mode) are display:none.
 *   - default (no channel stamped yet): SAME as prod -- hidden -- so a slow first /api/status
 *     never flashes the not-ready UI. This is the safe default the :not(=staging) form gives.
 *   - staging: those same entry points are visible. Without this arm the prod arm would pass on
 *     a rule that hid them from everybody, which would silently kill the staging review surface.
 *   - CONTROL element #pj-add-agent (the LOCAL agent add) stays visible in every channel, proving
 *     the gate hides only the federation surfaces and not the rest of Add-Project.
 *
 * HERMETIC: loads web/index.html over file://, boots no server; boot fetches are stubbed before
 * load. The fed nodes live inside the hidden #pj-add-view, so their ancestors are un-hidden and
 * the two follow-on panels' own `hidden` attribute is cleared, leaving the CSS channel gate as
 * the only thing that can hide them -- so computed display is a real rendering result.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-fed-prod-gate-3330.js
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-fed-prod-gate-3330: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
const FED = ['.pj-mode', '#pj-add-ext-person', '#pj-add-ext-agent', '#pj-invite-panel', '#pj-join-mode'];
const CONTROL = '#pj-add-agent';

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

function initStub() {
  const enc = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  window.fetch = async () => enc(200, { agents: [] });
}

const displays = (page, sels) => page.evaluate((sels) => {
  const out = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    out[s] = el ? getComputedStyle(el).display : 'MISSING';
  }
  return out;
}, sels);

async function setChannel(page, chan) {
  await page.evaluate((c) => {
    if (c === null) document.documentElement.removeAttribute('data-source-channel');
    else document.documentElement.setAttribute('data-source-channel', c);
  }, chan);
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-fed-prod-gate-3330: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(initStub);
  const page = await ctx.newPage();
  await page.goto(PAGE);

  // Un-hide the ancestors of every fed node (and the control) so the CSS channel gate is the
  // only thing that can hide them, and clear the two follow-on panels' own `hidden` attribute
  // so THEIR display reflects the gate too, not the attribute.
  const revealed = await page.evaluate((ids) => {
    let ok = true;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { ok = false; continue; }
      for (let n = el.parentElement; n; n = n.parentElement) {
        n.removeAttribute && n.removeAttribute('hidden');
        if (getComputedStyle(n).display === 'none') n.style.display = 'block';
      }
    }
    // The two panels carry their own `hidden` attr (shown by JS on interaction); clear it so
    // the check reads the CSS gate, not the attribute.
    for (const id of ['pj-invite-panel', 'pj-join-mode']) {
      const el = document.getElementById(id);
      if (el) el.removeAttribute('hidden');
    }
    return ok;
  }, ['pj-mode-create', 'pj-add-ext-person', 'pj-add-ext-agent', 'pj-invite-panel', 'pj-join-mode', 'pj-add-agent']);
  if (!revealed) {
    check('fed-prod-gate: the federation entry points and the control are on the page', false,
      'one of pj-mode/pj-add-ext-*/pj-invite-panel/pj-join-mode/pj-add-agent is gone');
    await browser.close();
    process.exit(1);
  }

  // ARM 1: prod -> every fed entry point hidden; control shown.
  await setChannel(page, 'prod');
  let d = await displays(page, FED.concat([CONTROL]));
  check('prod: the federation entry points are hidden',
    FED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('prod: the local "Add an agent" control is still shown',
    d[CONTROL] !== 'none' && d[CONTROL] !== 'MISSING', CONTROL + ' = ' + d[CONTROL]);

  // ARM 2 (safe default): no channel stamped -> same as prod, hidden (no flash before /api/status).
  await setChannel(page, null);
  d = await displays(page, FED);
  check('default (channel not yet known): the federation entry points are hidden',
    FED.every((s) => d[s] === 'none'), JSON.stringify(d));

  // ARM 3 (CONTROL that the gate is prod-specific, not hide-everywhere): staging -> shown.
  await setChannel(page, 'staging');
  d = await displays(page, FED.concat([CONTROL]));
  check('staging: the federation entry points are visible (the gate is prod-specific, not global)',
    FED.every((s) => d[s] !== 'none' && d[s] !== 'MISSING'), JSON.stringify(d));
  check('staging: the local "Add an agent" control is still shown',
    d[CONTROL] !== 'none' && d[CONTROL] !== 'MISSING', CONTROL + ' = ' + d[CONTROL]);

  await browser.close();
  if (problems.length) {
    console.error('render-fed-prod-gate-3330: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-fed-prod-gate-3330: the federation UI is hidden on prod and by default, shown on staging, and the local agent add is never gated.');
})().catch((err) => { console.error('FAIL  render-fed-prod-gate-3330: crashed: ' + (err && err.message ? err.message : err)); process.exit(1); });
