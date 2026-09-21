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
 *   - CONTROL #pj-add-agent (local agent add) stays shown in every arm.
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
const FED = ['.pj-mode', '#pj-add-ext-person', '#pj-add-ext-agent', '#pj-invite-panel', '#pj-join-mode'];
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
  await stamp(page, { sourceChannel: 'prod', federationLive: false, plusEntitled: 'member' });
  let d = await displays(page, FED.concat([SIGNUP, CONTROL]));
  check('prod NOT flipped: the federation entry points are hidden', FED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('prod NOT flipped: the sign-up prompt is hidden too', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);
  check('prod NOT flipped: the local "Add an agent" control is still shown', shown(d[CONTROL]), CONTROL + ' = ' + d[CONTROL]);

  // ARM 2: prod, flipped + member -> fed UI shown, sign-up hidden.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, plusEntitled: 'member' });
  d = await displays(page, FED.concat([SIGNUP]));
  check('prod flipped + MEMBER: the federation entry points are shown', FED.every((s) => shown(d[s])), JSON.stringify(d));
  check('prod flipped + MEMBER: the sign-up prompt is hidden', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 3: prod, flipped + non-member -> fed UI hidden, sign-up SHOWN.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, plusEntitled: 'none' });
  d = await displays(page, FED.concat([SIGNUP]));
  check('prod flipped + NON-MEMBER: the federation entry points are hidden', FED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('prod flipped + NON-MEMBER: the sign-up prompt is shown instead', shown(d[SIGNUP]), SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 4 (THE LEAK CONTROL): prod, flipped + UNKNOWN entitlement -> fed hidden, sign-up shown.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, plusEntitled: undefined });
  d = await displays(page, FED.concat([SIGNUP]));
  check('prod flipped + UNKNOWN: the federation entry points stay hidden (FAIL-SAFE, no leak)', FED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('prod flipped + UNKNOWN: the sign-up prompt is shown', shown(d[SIGNUP]), SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 5: staging, entitlement unwired -> fed UI shown (review continuity), sign-up hidden.
  await stamp(page, { sourceChannel: 'staging', federationLive: false, plusEntitled: undefined });
  d = await displays(page, FED.concat([SIGNUP]));
  check('staging (entitlement unwired): the federation entry points are shown for review', FED.every((s) => shown(d[s])), JSON.stringify(d));
  check('staging: the sign-up prompt is hidden', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 6 (safe default): no data-fed-ui stamped yet -> both hidden (no first-tick flash).
  await stamp(page, null);
  d = await displays(page, FED.concat([SIGNUP]));
  check('default (no mode stamped): the federation entry points are hidden', FED.every((s) => d[s] === 'none'), JSON.stringify(d));
  check('default (no mode stamped): the sign-up prompt is hidden', d[SIGNUP] === 'none', SIGNUP + ' = ' + d[SIGNUP]);

  // ARM 7 (the prompt is an ACTUAL go-sign-up, not dead copy): clicking it routes into the
  // in-app Kosmos Plus section (Josh's spec). Verified by driving the real click handler and
  // reading that the Plus section becomes the shown settings section.
  await stamp(page, { sourceChannel: 'prod', federationLive: true, plusEntitled: 'none' });
  const routed = await page.evaluate(() => {
    document.getElementById('pj-plus-signup-go').click();
    const plus = document.querySelector('#panel-settings .dsec[data-sec="plus"]');
    const settingsTabOn = !!document.querySelector('.tab[data-tab="settings"].on, .tab[data-tab="settings"][aria-selected="true"]');
    return { plusShown: !!plus && !plus.hidden, settingsSec: (typeof SETTINGS_SEC !== 'undefined' ? SETTINGS_SEC : null), settingsTabOn };
  });
  check('the sign-up button routes into the in-app Kosmos Plus section', routed.plusShown && routed.settingsSec === 'plus', JSON.stringify(routed));

  await browser.close();
  if (problems.length) {
    console.error('render-fed-plus-gate: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-fed-plus-gate: federation shows only to a Kosmos+ member on a live channel, a non-member/unknown gets the sign-up prompt, prod stays hidden until flipped, and the local agent add is never gated.');
})().catch((err) => { console.error('FAIL  render-fed-plus-gate: crashed: ' + (err && err.message ? err.message : err)); process.exit(1); });
