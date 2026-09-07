'use strict';
/**
 * kosmos#2433 (the UI slice of #2420; Josh's #2338 "follow suit on Claude too"):
 * the Settings > Accounts add-a-provider modal now offers Claude the SAME
 * subscription-vs-API-key choice OpenAI already has. Picking Claude meets
 * #acct-claude-pick first; "Use an API key" reveals #acct-claude-key-step (a
 * password field for an ANTHROPIC_API_KEY + Add), "Sign in with your subscription"
 * reveals the existing #acct-claude-sub-step (the browser-OAuth flow). A reauth
 * skips the picker and lands on the subscription step directly.
 *
 * 🔑 WHAT SOURCE CANNOT SEE. A grep confirms the ids exist and that acctClaudeChoose
 * flips a `.hidden`; only a browser confirms the picker actually PAINTS, that
 * choosing a flow HIDES the picker and SHOWS exactly one step (computed visibility,
 * not just the attribute), that the key field is a real password input drawn on
 * screen, and that a pasted-key add paints the same gold connected box the OpenAI
 * and first-run flows use.
 *
 * 🛑 IT ALSO PINS THE #2420 ORDERING CONSTRAINT ON THE ROW. Pete's removal engine
 * (forget/remove for an api-key account) is a later #2420 slice; until it lands a
 * live Disconnect / Sign-in-again / Delete-and-remove on an api-key row only errors.
 * So this drives the REAL paintAccounts() over a stubbed list carrying an api-key
 * row and a subscription row, and asserts the api-key row renders NONE of those three
 * live controls (a disabled, focusable Disconnect stating removal is coming instead),
 * while the subscription row keeps all three. That suppression is a browser-visible
 * property of the rendered list, so it is pinned where a source read would miss a
 * regression that re-enabled the broken controls.
 *
 * CONTROL: the subscription row is the discriminator -- it proves the suppression is
 * specific to api-key rows, not a blanket removal of every Claude row's actions.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-claude-connect-choice-2433.js
 *   (HEADED by default; HEADED=0 on a console-less machine.)
 */

const nodePath = require('node:path');

let playwright;
try { playwright = require('playwright'); }
catch {
  console.log('render-claude-connect-choice-2433: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

const problems = [];
function check(name, pass, detail) {
  if (!pass) problems.push(name + (detail ? '  ' + detail : ''));
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
}

(async () => {
  let browser;
  try { browser = await playwright.chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-claude-connect-choice-2433: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    for (const fn of ['openAcctAdd', 'acctPick', 'acctClaudeChoose', 'acctClaudeStep',
      'closeAcctAdd', 'openAcctReauth', 'paintAccounts']) {
      if (typeof window[fn] !== 'function') return { error: fn + ' is not on the page' };
    }
    for (const id of ['acct-claude-pick', 'acct-claude-pick-sub', 'acct-claude-pick-key',
      'acct-claude-sub-step', 'acct-claude-key-step', 'acct-claude-key', 'acct-claude-go']) {
      if (!document.getElementById(id)) return { error: '#' + id + ' is not in the markup' };
    }

    // Stub the two routes this flow touches. The list carries an api-key Claude row
    // (no email, apiKey:true) and a subscription Claude row (the control).
    const realFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/api/accounts/claude/apikey') !== -1 && opts && opts.method === 'POST') {
        return { ok: true, json: async () => ({ account: { label: 'work-key', connection: { state: 'connected' } } }) };
      }
      if (u.indexOf('/api/accounts') !== -1) {
        return { ok: true, json: async () => ({ accounts: [
          { dir: '/h/.claude-work1', label: 'work1', isDefault: false, apiKey: true, email: null,
            connection: { state: 'connected', badge: 'working', because: 'ok' } },
          { dir: '/h/.claude-sub', label: 'sub', isDefault: false, apiKey: false, email: 'sub@example.com',
            connection: { state: 'connected', badge: 'working', because: 'ok' } },
        ] }) };
      }
      if (u.indexOf('/api/first-run') !== -1) return { ok: true, json: async () => ({ connect: { willInstall: false } }) };
      return realFetch(url, opts);
    };
    const vis = (el) => { if (!el) return false; for (let n = el; n; n = n.parentElement) { if (n.hidden) return false; const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
    const sized = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };

    // 1. A fresh add lands on the PICKER, not a flow.
    openAcctAdd();
    acctPick('claude', { focus: false });
    const pickSub = document.getElementById('acct-claude-pick-sub');
    const pickKey = document.getElementById('acct-claude-pick-key');
    const picker = {
      pickVisible: vis(document.getElementById('acct-claude-pick')),
      subHidden: !vis(document.getElementById('acct-claude-sub-step')),
      keyHidden: !vis(document.getElementById('acct-claude-key-step')),
      bothButtonsSized: sized(pickSub) && sized(pickKey),
      subBtnText: (pickSub.textContent || '').trim(),
      keyBtnText: (pickKey.textContent || '').trim(),
    };

    // 2. Choose "Use an API key": key step shows, picker + sub hide.
    pickKey.click();
    const keyField = document.getElementById('acct-claude-key');
    const addBtn = document.getElementById('acct-claude-go');
    const keyStep = {
      keyStepVisible: vis(document.getElementById('acct-claude-key-step')),
      pickHidden: !vis(document.getElementById('acct-claude-pick')),
      subHidden: !vis(document.getElementById('acct-claude-sub-step')),
      keyIsPassword: keyField.type === 'password',
      keyFieldSized: sized(keyField),
      addIsPrimary: /\buprime\b/.test(addBtn.className),
    };

    // 3. Choose the subscription flow: sub step shows, picker + key hide.
    acctClaudeStep();
    document.getElementById('acct-claude-pick-sub').click();
    const subStep = {
      subVisible: vis(document.getElementById('acct-claude-sub-step')),
      pickHidden: !vis(document.getElementById('acct-claude-pick')),
      keyHidden: !vis(document.getElementById('acct-claude-key-step')),
      startBtnVisible: vis(document.getElementById('acct-add')),
      warnVisible: vis(document.getElementById('acct-claude-warn')),
    };

    // 4. Add via the pasted key: paints the same gold connected box.
    acctClaudeStep();
    document.getElementById('acct-claude-pick-key').click();
    document.getElementById('acct-claude-key').value = 'sk-ant-api03-fake-testkey';
    document.getElementById('acct-claude-go').click();
    await new Promise((res) => setTimeout(res, 500));
    const successBox = document.getElementById('acct-success-box');
    const goldRow = successBox && successBox.querySelector('.fr-check.ok');
    const added = {
      boxVisible: vis(successBox),
      hasRow: Boolean(goldRow),
      rowText: goldRow ? (goldRow.innerText || goldRow.textContent || '') : '',
      // The pasted key must not linger on screen after it is stored.
      keyCleared: document.getElementById('acct-claude-key').value === '',
    };

    // 5. A reauth SKIPS the picker and lands on the subscription step directly.
    if (typeof closeAcctAdd === 'function') closeAcctAdd();
    openAcctReauth('/h/.claude-sub', 'sub@example.com');
    const reauth = {
      pickHidden: !vis(document.getElementById('acct-claude-pick')),
      subVisible: vis(document.getElementById('acct-claude-sub-step')),
    };
    if (typeof closeAcctAdd === 'function') closeAcctAdd();

    // 6. The #2420 ordering constraint on the rendered rows: drive the REAL list.
    await paintAccounts();
    // The accounts list lives in the Settings tab, hidden on load; unhide its
    // ancestors so a paint/visibility read reflects the ROW's own drawing rather than
    // the closed panel (same technique as render-openai-key-step.js).
    const setBox = document.getElementById('set-accounts');
    for (let n = setBox; n; n = n.parentElement) {
      if (n.removeAttribute) n.removeAttribute('hidden');
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    const boxes = Array.from(document.querySelectorAll('#set-accounts .acct-box'));
    const info = (box) => ({
      hasReauth: Boolean(box.querySelector('[data-reauth]')),
      hasForget: Boolean(box.querySelector('[data-forget]')),
      hasRemove: Boolean(box.querySelector('[data-remove]')),
      disabledDisc: (() => {
        const d = box.querySelector('.acct-disconnect[aria-disabled="true"]');
        if (!d) return null;
        return {
          visible: vis(d), sized: sized(d),
          nativeDisabled: d.hasAttribute('disabled'),
          label: d.getAttribute('aria-label') || '',
          title: d.getAttribute('title') || '',
        };
      })(),
    });
    const apiBox = boxes.find((b) => {
      const d = b.querySelector('.acct-disconnect[aria-disabled="true"]');
      return d && /not ready|coming soon/i.test((d.getAttribute('title') || '') + (d.getAttribute('aria-label') || ''));
    });
    const subBox = boxes.find((b) => b.querySelector('[data-forget="/h/.claude-sub"]'));
    const rows = {
      boxCount: boxes.length,
      api: apiBox ? info(apiBox) : null,
      sub: subBox ? info(subBox) : null,
    };

    // Pressing the api-key row's disabled Disconnect must NOT speak "Sign in again
    // above": that remedy is suppressed on this row (#2433 made the handler's clause
    // conditional on the row actually having a reauth control), so pointing at it
    // would name a button that is not there.
    let apiPressSay = null;
    if (apiBox) {
      const d = apiBox.querySelector('.acct-disconnect[aria-disabled="true"]');
      const sayEl = document.getElementById('set-accounts-msg');
      if (d && sayEl) {
        d.click();
        await new Promise((res) => setTimeout(res, 120));
        apiPressSay = sayEl.textContent || '';
      }
    }

    return { picker, keyStep, subStep, added, reauth, rows, apiPressSay };
  });

  if (r.error) { console.error('render-claude-connect-choice-2433: ' + r.error); await browser.close(); process.exit(1); }
  if (pageErrors.length) { console.error('render-claude-connect-choice-2433: page error(s): ' + pageErrors.join(' | ')); await browser.close(); process.exit(1); }

  // 1. picker
  check('a fresh Claude add lands on the subscription-vs-API-key picker, both flows hidden',
    r.picker.pickVisible && r.picker.subHidden && r.picker.keyHidden && r.picker.bothButtonsSized,
    'pickVisible ' + r.picker.pickVisible + ', subHidden ' + r.picker.subHidden + ', keyHidden ' + r.picker.keyHidden + ', buttonsSized ' + r.picker.bothButtonsSized);
  check('the picker offers a subscription choice and an API-key choice',
    /subscription/i.test(r.picker.subBtnText) && /api key/i.test(r.picker.keyBtnText),
    JSON.stringify([r.picker.subBtnText, r.picker.keyBtnText]));
  // 2. key step
  check('"Use an API key" reveals a password key field and a primary Add, hiding the picker and sub step',
    r.keyStep.keyStepVisible && r.keyStep.pickHidden && r.keyStep.subHidden
      && r.keyStep.keyIsPassword && r.keyStep.keyFieldSized && r.keyStep.addIsPrimary,
    JSON.stringify(r.keyStep));
  // 3. sub step
  check('"Sign in with your subscription" reveals the browser-OAuth step, hiding the picker and key step',
    r.subStep.subVisible && r.subStep.pickHidden && r.subStep.keyHidden
      && r.subStep.startBtnVisible && r.subStep.warnVisible,
    JSON.stringify(r.subStep));
  // 4. add success
  check('adding a pasted ANTHROPIC_API_KEY paints the gold connected box ("Claude is connected") and clears the key field',
    r.added.boxVisible && r.added.hasRow && /Claude is connected/.test(r.added.rowText) && /API key/i.test(r.added.rowText) && r.added.keyCleared,
    'text ' + JSON.stringify(r.added.rowText.slice(0, 80)) + ', keyCleared ' + r.added.keyCleared);
  // 5. reauth bypass
  check('a reauth skips the picker and lands on the subscription step directly',
    r.reauth.pickHidden && r.reauth.subVisible, JSON.stringify(r.reauth));
  // 6. rows: #2420 ordering
  check('the account list rendered both rows (so the row asserts are not vacuous)',
    r.rows.boxCount === 2, 'boxCount ' + r.rows.boxCount);
  if (r.rows.api) {
    check('the api-key row carries NO live Sign-in-again, Disconnect or Delete-and-remove (removal engine not landed)',
      !r.rows.api.hasReauth && !r.rows.api.hasForget && !r.rows.api.hasRemove,
      'reauth ' + r.rows.api.hasReauth + ', forget ' + r.rows.api.hasForget + ', remove ' + r.rows.api.hasRemove);
    check('the api-key row shows a focusable, painted, aria-disabled Disconnect (not the tab-order-removed native disabled)',
      r.rows.api.disabledDisc && r.rows.api.disabledDisc.visible && r.rows.api.disabledDisc.sized
        && !r.rows.api.disabledDisc.nativeDisabled,
      JSON.stringify(r.rows.api.disabledDisc));
    check('the api-key Disconnect states the truth in its accessible name: removal is coming, not broken',
      r.rows.api.disabledDisc && /not ready|coming soon/i.test(r.rows.api.disabledDisc.label),
      r.rows.api.disabledDisc ? r.rows.api.disabledDisc.label : 'no disabled disconnect');
    check('pressing the api-key disabled Disconnect does NOT point at a "Sign in again" that this row lacks',
      typeof r.apiPressSay === 'string' && r.apiPressSay.length > 0 && !/Sign in again/i.test(r.apiPressSay),
      JSON.stringify((r.apiPressSay || '').slice(0, 90)));
  } else {
    check('the api-key row was found in the list', false, 'no api-key row with a removal-coming Disconnect rendered');
  }
  // CONTROL
  check('CONTROL: the subscription row keeps its live Sign-in-again, Disconnect and Delete-and-remove',
    r.rows.sub && r.rows.sub.hasReauth && r.rows.sub.hasForget && r.rows.sub.hasRemove,
    r.rows.sub ? JSON.stringify(r.rows.sub) : 'no subscription control row found');

  await browser.close();
  if (problems.length) {
    console.error('render-claude-connect-choice-2433: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-claude-connect-choice-2433: the Claude add flow offers a subscription-vs-API-key picker that toggles the right step, a pasted key paints the gold connected box, a reauth skips the picker, and an api-key row suppresses the three not-yet-working removal controls (subscription row keeps them).');
})();
