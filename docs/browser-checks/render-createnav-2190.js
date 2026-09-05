'use strict';
// #2190: Create advances to the PROGRESS ('made') screen instead of showing
// 'Making it…' inline on the create screen, and an error/refusal routes BACK to
// the create screen so the message lands beside the field.
//
// Hermetic: loads web/index.html over file://, boots no server. It drives the
// REAL create-go handler by stubbing fetch for /api/roles (so a role is picked
// and validation passes) and /api/agents (so we control the outcome), then
// asserts the SCREEN state after the click, the navigation, which is the card's
// core. The K-loader animation's visual quality is deliberately NOT asserted here
// (it is Josh's in-app review); we only assert the loader was started as state.
const nodePath = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-createnav-2190: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}
const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

// A minimal /api/roles payload: one menu role keyed 'pm' (pickMode('pm') selects
// it) plus an 'own' entry, which is all validation and roleByKey need.
const ROLES_PAYLOAD = {
  roles: [{ key: 'pm', label: 'Project manager', blurb: 'runs the work', instructions: 'do the work' }],
  models: [],
  own: { key: 'own', label: 'Your own', blurb: 'you say', instructions: '' },
};

// Drive the create flow to the point of a create-go click, with /api/agents
// stubbed to `agentsOutcome`. Returns the observable screen state afterwards.
async function driveCreate(page, agentsOutcome) {
  return page.evaluate(async ({ roles, outcome }) => {
    const realFetch = window.fetch;
    window.fetch = (u, opts) => {
      const s = String(u);
      if (s.indexOf('/api/roles') !== -1) return Promise.resolve({ ok: true, json: async () => roles });
      if (s.indexOf('/api/agents') !== -1) return Promise.resolve({ ok: outcome.ok !== false, json: async () => outcome.body });
      // Everything else (the boot fetches, the post-success watch poll) resolves
      // to a benign empty body so nothing throws; the assertion is the screen.
      return Promise.resolve({ ok: true, json: async () => ({}) });
    };
    if (typeof loadRoles !== 'function' || typeof cstep !== 'function') return { error: 'page functions missing' };
    await loadRoles();                       // sets ROLES/OWN_ROLE and pickMode('pm') -> PICKED
    document.getElementById('create-name').value = 'tester';   // the agent name (made-head reads this)
    document.getElementById('create-label').value = 'does things'; // what it does (validation reads this)
    const shown = (id) => { const e = document.getElementById(id); return e && !e.hidden; };
    document.getElementById('create-go').click();
    // The click handler runs synchronously up to its first `await fetch(...)`, so
    // right here the nav block has executed but the POST has NOT resolved. This is
    // the DURING-POST state and the actual #2190 discriminator: the new code has
    // already advanced to the progress screen, whereas the old code was still on
    // the create screen showing 'Making it…' inline. Capturing it makes this a
    // control against the old behavior (a full revert fails duringPostMadeShown),
    // not only a surgical perturbation.
    const duringPostMadeShown = shown('cstep-made');
    const duringPostNameShown = shown('cstep-name');
    // #2190 review: also pin the K-loader lifecycle, the regression-prone part
    // (a prior round caught a RAF left running on the hidden canvas). MADE_MARK is
    // a top-level `let`, reachable here as a bare identifier like loadRoles/cstep:
    // the click block sets it (startKLoader) so it is non-null during-post; the
    // route-back (dropMyLoader) finishes it and nulls it.
    const loaderSet = () => (typeof MADE_MARK !== 'undefined' && MADE_MARK !== null);
    const duringPostLoaderSet = loaderSet();
    // Then let the fetch resolve and the handler reach its FINAL screen.
    await new Promise((r) => setTimeout(r, 500));
    window.fetch = realFetch;
    return {
      duringPostMadeShown, duringPostNameShown, duringPostLoaderSet,
      madeShown: shown('cstep-made'),
      nameShown: shown('cstep-name'),
      finalLoaderSet: loaderSet(),
      createMsg: (document.getElementById('create-msg').textContent || '').trim(),
      madeHead: (document.getElementById('made-head').textContent || '').trim(),
    };
  }, { roles: ROLES_PAYLOAD, outcome: agentsOutcome });
}

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-createnav-2190: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const problems = [];

  // Scenario 1: a created outcome ADVANCES to the progress screen.
  const p1 = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await p1.goto('file://' + PAGE);
  const created = await driveCreate(p1, { ok: true, body: { outcome: 'created', name: 'does things', steps: [] } });
  await p1.close();
  if (created.error) problems.push('scenario-created: ' + created.error);
  else {
    if (!created.duringPostMadeShown) problems.push('created: the progress screen was NOT shown immediately on click (advanced only after the POST resolved, or shows inline "Making it" instead) - the #2190 behavior is missing');
    if (created.duringPostNameShown) problems.push('created: still on the create screen immediately after click (did not advance on click)');
    if (!created.madeShown) problems.push('created: the progress (made) screen was not shown after Create');
    if (created.nameShown) problems.push('created: the create screen is still shown (did not advance)');
    if (!/tester/.test(created.madeHead)) problems.push('created: made-head does not name the agent: "' + created.madeHead + '"');
    if (/Making it/.test(created.createMsg)) problems.push('created: the inline "Making it…" is still on the create screen: "' + created.createMsg + '"');
    if (!created.duringPostLoaderSet) problems.push('created: the K-loader (MADE_MARK) was not started on click - the progress animation must be running while the POST is in flight');
  }

  // Scenario 2: a refused outcome ROUTES BACK to the create screen with the message.
  const p2 = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await p2.goto('file://' + PAGE);
  const refused = await driveCreate(p2, { ok: true, body: { outcome: 'refused', because: 'that name will not work' } });
  await p2.close();
  if (refused.error) problems.push('scenario-refused: ' + refused.error);
  else {
    if (!refused.duringPostMadeShown) problems.push('refused: the progress screen was NOT shown immediately on click - the #2190 advance-on-click behavior is missing');
    if (!refused.nameShown) problems.push('refused: did not route back to the create screen');
    if (refused.madeShown) problems.push('refused: still on the progress screen (should have routed back)');
    if (!/that name will not work/.test(refused.createMsg)) problems.push('refused: the message is not beside the field: "' + refused.createMsg + '"');
    if (!refused.duringPostLoaderSet) problems.push('refused: the K-loader (MADE_MARK) was not started on click - it must start on nav, then be dropped on route-back');
    if (refused.finalLoaderSet) problems.push('refused: the K-loader (MADE_MARK) was NOT dropped on route-back - dropMyLoader must finish it and null MADE_MARK so no RAF is left running on the hidden canvas');
  }

  await browser.close();
  if (problems.length) {
    console.error(`render-createnav-2190: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-createnav-2190: Create advances to the progress screen; an error routes back to the create screen with the message.');
})();
