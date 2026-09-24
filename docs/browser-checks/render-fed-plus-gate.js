// Browser-check-surface: data-fed-ui pj-mode pj-add-ext-person pj-add-ext-agent pj-invite-panel pj-join-mode pj-plus-signup
'use strict';
/**
 * fed-plus-gate: the #3312 federation UI gates on the Kosmos+ launch mode (Josh, 2026-09-21).
 *
 * WHAT THIS EXISTS TO CATCH. Federation launches as a Kosmos+ feature: on a LIVE channel a
 * paying member sees the fed UI, everyone else sees a "sign up for Kosmos+" prompt, and before
 * the coordinated flip prod shows nothing. All three are COMPUTED by fedGateMode() and stamped
 * on <html> as data-fed-ui, which the CSS gate reads. A source grep cannot see whether a rule
 * loses to a more specific selector (leaving the not-ready/member-only fed UI on a non-member's
 * prod board while every markup assertion passed), so this drives the REAL fedGateStamp() with
 * fixture /api/status data and reads what a person sees.
 *
 * THE LEAK THIS MUST PREVENT: a non-member / unknown viewer on a live prod seeing federation.
 * That is arm 3 + arm 4 below, and it is the reason the check exists.
 *
 * ARMS (each calls the shipped fedGateStamp, then reads computed display):
 *   - prod + NOT flipped        -> fed hidden, sign-up hidden          (ready-to-flip)
 *   - prod + flipped + member   -> fed SHOWN, sign-up hidden
 *   - prod + flipped + none     -> fed hidden, sign-up SHOWN
 *   - prod + flipped + unknown  -> fed hidden, sign-up SHOWN           (FAIL-SAFE, no leak)
 *   - staging + unwired plus    -> fed SHOWN, sign-up hidden           (review continuity)
 *   - default (no stamp)        -> fed hidden, sign-up hidden          (no first-tick flash)
 *   - CONTROL #pj-add-agent (local agent add) is asserted SHOWN in arm 1, proving the gate
 *     hides only the federation surfaces and never the local (non-federation) controls.
 *
 * HERMETIC: loads web/index.html over file://, boots no server; boot fetches stubbed before load.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-fed-plus-gate.js
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-fed-plus-gate: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = 'file://' + nodePath.join(__dirname, '..', '..', 'web', 'index.html');
// #3495 (Angel): the Create/Join toggle and the Add-external buttons now ALWAYS show (grayed for a
// non-"show" viewer, which gates by MESSAGE via showPlusGate, not by hiding). Only the Plus-only
// CONTENT stays display-gated. So assertions split: ALWAYS shown in every arm, GATED hidden unless "show".
const ALWAYS = ['.pj-mode', '#pj-add-ext-person', '#pj-add-ext-agent'];
const GATED = ['#pj-invite-panel', '#pj-join-mode'];
const FED = ALWAYS.concat(GATED); // union, for the displays() queries below
const SIGNUP = '#pj-plus-signup';
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

// Drive the REAL shipped gate: stamp via fedGateStamp with fixture /api/status data,
// or clear the attribute for the default arm.
async function stamp(page, data) {
  await page.evaluate((d) => {
    if (d === null) document.documentElement.removeAttribute('data-fed-ui');
    else fedGateStamp(d);
  }, data);
}
const shown = (v) => v !== 'none' && v !== 'MISSING';

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-fed-plus-gate: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(initStub);
  const page = await ctx.newPage();
  await page.goto(PAGE);

  // Un-hide the ancestors of every gated node so the CSS gate is the only thing that can hide
  // them, and clear the two follow-on panels' own `hidden` attribute so THEIR display reflects
  // the gate too, not the attribute.
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
    for (const id of ['pj-invite-panel', 'pj-join-mode']) {
      const el = document.getElementById(id);
      if (el) el.removeAttribute('hidden');
    }
    return ok;
  }, ['pj-mode-create', 'pj-add-ext-person', 'pj-add-ext-agent', 'pj-invite-panel', 'pj-join-mode', 'pj-plus-signup-go', 'pj-add-agent']);
  if (!revealed) {
    check('fed-plus-gate: the federation entry points, the sign-up prompt, and the control are on the page', false,
      'one of pj-mode/pj-add-ext-*/pj-invite-panel/pj-join-mode/pj-plus-signup/pj-add-agent is gone');
    await browser.close();
    process.exit(1);
  }

  // ARM 1: prod, NOT flipped -> both fed UI and sign-up hidden; control shown (ready-to-flip).
  await stamp(page, { sourceChannel: 'prod', federationLive: false, kosmos_plus: true });
  let d = await displays(page, FED.concat([SIGNUP, CONTROL]));
  check('prod NOT flipped: the toggle + Add-external buttons still show (grayed, gate by message)', ALWAYS.every((s) => shown(d[s])), JSON.stringify(d));
  check('prod NOT flipped: the Plus-only content (invite panel + join form) is hidden', GATED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('prod NOT flipped: the sign-up prompt is hidden too', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);
  check('prod NOT flipped: the local "Add an agent" control is still shown', shown(d[CONTROL]), CONTROL + ' = ' + d[CONTROL]);

  // ARM 2: prod, flipped + member -> fed UI shown, sign-up hidden.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, kosmos_plus: true });
  d = await displays(page, FED.concat([SIGNUP]));
  check('prod flipped + MEMBER: the federation entry points are shown', FED.every((s) => shown(d[s])), JSON.stringify(d));
  check('prod flipped + MEMBER: the sign-up prompt is hidden', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 3: prod, flipped + non-member -> fed UI hidden, sign-up SHOWN.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, kosmos_plus: false });
  d = await displays(page, FED.concat([SIGNUP]));
  check('prod flipped + NON-MEMBER: the toggle + Add-external buttons still show (grayed, gate by message)', ALWAYS.every((s) => shown(d[s])), JSON.stringify(d));
  check('prod flipped + NON-MEMBER: the Plus-only content (invite panel + join form) is hidden', GATED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('prod flipped + NON-MEMBER: the sign-up prompt is shown instead', shown(d[SIGNUP]), SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 4 (THE LEAK CONTROL): prod, flipped + UNKNOWN entitlement -> fed hidden, sign-up shown.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, kosmos_plus: undefined });
  d = await displays(page, FED.concat([SIGNUP]));
  check('prod flipped + UNKNOWN: the Plus-only content stays hidden (FAIL-SAFE, no leak)', GATED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('prod flipped + UNKNOWN: the toggle + Add-external buttons still show (grayed)', ALWAYS.every((s) => shown(d[s])), JSON.stringify(d));
  check('prod flipped + UNKNOWN: the sign-up prompt is shown', shown(d[SIGNUP]), SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 5: staging, entitlement unwired -> fed UI shown (review continuity), sign-up hidden.
  await stamp(page, { sourceChannel: 'staging', federationLive: false, kosmos_plus: undefined });
  d = await displays(page, FED.concat([SIGNUP]));
  check('staging (entitlement unwired): the federation entry points are shown for review', FED.every((s) => shown(d[s])), JSON.stringify(d));
  check('staging: the sign-up prompt is hidden', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 6 (safe default): no data-fed-ui stamped yet -> both hidden (no first-tick flash).
  await stamp(page, null);
  d = await displays(page, FED.concat([SIGNUP]));
  check('default (no mode stamped): the Plus-only content is hidden (no first-tick flash)', GATED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('default (no mode stamped): the toggle + Add-external buttons still show (always-on)', ALWAYS.every((s) => shown(d[s])), JSON.stringify(d));
  check('default (no mode stamped): the sign-up prompt is hidden', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 7 (the prompt is an ACTUAL go-sign-up, not dead copy): clicking it routes into the
  // in-app Kosmos Plus section (Josh's spec). Verified by driving the real click handler and
  // reading that the Plus section becomes the shown settings section.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, kosmos_plus: false });
  const routed = await page.evaluate(() => {
    document.getElementById('pj-plus-signup-go').click();
    const plus = document.querySelector('#panel-settings .dsec[data-sec="plus"]');
    const settingsTabOn = !!document.querySelector('.tab[data-tab="settings"].on, .tab[data-tab="settings"][aria-selected="true"]');
    return { plusShown: !!plus && !plus.hidden, settingsSec: (typeof SETTINGS_SEC !== 'undefined' ? SETTINGS_SEC : null), settingsTabOn };
  });
  check('the sign-up button routes into the in-app Kosmos Plus section', routed.plusShown && routed.settingsSec === 'plus', JSON.stringify(routed));

  // ARM 8 (#3495 Angel, the message-gate behaviour): a non-"show" viewer who SELECTS Join, or
  // CLICKS a grayed Add-external button, gets the shared Plus-gate MODAL (Josh's "show a message"),
  // not the gated form / a minted invite. Drive the REAL handlers (fedShow reads data-fed-ui) and
  // read the modal open-state + its copy. This is the behaviour this half exists to add.
  await page.evaluate(() => document.documentElement.setAttribute('data-fed-ui', 'signup')); // live, non-member -> not "show"
  const gate = await page.evaluate(() => {
    const modal = document.getElementById('plus-gate-modal');
    const msg = document.getElementById('plus-gate-msg');
    const closeBtn = document.getElementById('plus-gate-close');
    const read = () => ({ open: !!modal && !modal.hidden, copy: (msg && msg.textContent) || '' });
    if (closeBtn) closeBtn.click();
    const joinR = document.getElementById('pj-mode-join');
    joinR.checked = true; joinR.dispatchEvent(new Event('change', { bubbles: true }));
    const join = read();
    const revertedToCreate = document.getElementById('pj-mode-create').checked === true;
    if (closeBtn) closeBtn.click();
    document.getElementById('pj-add-ext-person').click();
    const connect = read();
    if (closeBtn) closeBtn.click();
    return { join, revertedToCreate, connect };
  });
  check('#3495 non-member selecting Join opens the Plus-gate modal, not the join form', gate.join.open, JSON.stringify(gate.join));
  check('#3495 the Join gate shows the JOIN copy', /must be logged in to access it/.test(gate.join.copy), gate.join.copy.slice(0, 90));
  check('#3495 selecting Join snaps the toggle back to Create (gated form never shown)', gate.revertedToCreate, 'create checked=' + gate.revertedToCreate);
  check('#3495 clicking a grayed Add-external button opens the Plus-gate modal', gate.connect.open, JSON.stringify({ open: gate.connect.open }));
  check('#3495 the connect gate shows the CONNECT copy', /signed in as a Kosmos Plus user/.test(gate.connect.copy), gate.connect.copy.slice(0, 90));

  await browser.close();
  if (problems.length) {
    console.error('render-fed-plus-gate: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-fed-plus-gate: federation shows only to a Kosmos+ member on a live channel, a non-member/unknown gets the sign-up prompt, prod stays hidden until flipped, and the local agent add is never gated.');
})().catch((err) => { console.error('FAIL  render-fed-plus-gate: crashed: ' + (err && err.message ? err.message : err)); process.exit(1); });
