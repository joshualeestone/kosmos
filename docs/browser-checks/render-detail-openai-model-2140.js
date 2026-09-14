'use strict';

/**
 * kosmos#2140 Surface 2: the OpenAI model picker on an EXISTING agent's detail
 * page. The Claude change-model flow matches by label against the Claude
 * CREATE_MODELS, so an OpenAI agent would show Claude Sonnet 5 etc. as
 * switchable options -- the "Claude models under an OpenAI agent" bug Josh
 * flagged, here on the detail surface. paintOpenaiDetailModel gives OpenAI its
 * own per-account picker instead.
 *
 * ⚠️ WHY A BROWSER, and why a STUBBED fetch + CURRENT. Drives the real
 * paintOpenaiDetailModel against the real #d-model controls in web/index.html
 * on a file:// page, overriding window.fetch and setting CURRENT so no board is
 * needed. Reds on origin/main, where paintOpenaiDetailModel does not exist.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-detail-openai-model-2140.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts rendered DOM.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-detail-openai-model-2140: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-detail-openai-model-2140: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof paintOpenaiDetailModel !== 'function') return { error: 'paintOpenaiDetailModel is not a function (Surface 2 was not added)' };
    const sel = document.getElementById('d-model');
    if (!sel) return { error: '#d-model is missing' };
    const settle = () => new Promise((res) => setTimeout(res, 40));
    const agent = { sessionName: 'oa1', isNamedOurs: true, provider: 'openai', account: { dir: '/home/.codex' }, plannedModelName: 'o3' };
    // paintOpenaiDetailModel bails unless CURRENT is the agent it is painting.
    CURRENT = { sessionName: 'oa1' };

    // LISTABLE
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, models: [
      { key: 'gpt-5-codex', provider: 'openai', label: 'GPT-5-codex', arg: 'gpt-5-codex', why: 'The coding one.' },
      { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' },
    ] }) });
    paintOpenaiDetailModel(agent, 'oa1');
    await settle();
    const listable = {
      html: sel.innerHTML,
      hasAuto: /value="">Let OpenAI choose/.test(sel.innerHTML),
      currentSelected: /value="o3"[^>]*selected/.test(sel.innerHTML),
      noClaude: !/Claude|sonnet|opus/i.test(sel.innerHTML),
      current: sel.dataset.current,
      // #2802: the Connect-an-API-key button must NOT leak into a listable
      // account (it already has an API key and a real picker).
      connectHidden: (document.getElementById('d-model-connect') || {}).hidden === true,
    };

    // SNAPSHOT-PINNED (#2191): the agent is pinned to a raw dated snapshot that
    // the collapsed menu no longer lists. The picker must add a row for it and
    // pre-select it -- showing the agent's ACTUAL model, not "Let OpenAI choose".
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, models: [
      { key: 'gpt-4o', provider: 'openai', label: 'GPT-4o', arg: 'gpt-4o', why: 'The everyday choice.' },
      { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' },
    ] }) });
    paintOpenaiDetailModel({ ...agent, plannedModelName: 'gpt-4o-2024-08-06' }, 'oa1');
    await settle();
    const snapshotPinned = {
      injectedRow: /value="gpt-4o-2024-08-06"/.test(sel.innerHTML),
      injectedSelected: /value="gpt-4o-2024-08-06"[^>]*selected/.test(sel.innerHTML),
      autoNotSelected: !/value=""[^>]*selected/.test(sel.innerHTML),
      current: sel.dataset.current,
    };

    // NOT LISTABLE
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: 'this sign-in cannot list models yet; it is not an API key' }) });
    paintOpenaiDetailModel({ ...agent, plannedModelName: '' }, 'oa1');
    await settle();
    const msg = document.getElementById('d-model-msg') || {};
    // #2802: the not-an-api-key (ChatGPT subscription) state must be ACTIONABLE,
    // not just prose. The "Connect an API key" button shows here, and clicking it
    // opens the Add-a-provider flow (the same #acct-add-modal the Accounts door
    // opens). The selector itself stays honestly disabled.
    const connectBtn = document.getElementById('d-model-connect');
    const connectShown = !!connectBtn && connectBtn.hidden === false;
    let connectOpensFlow = false;
    // #2802: closing the modal opened from the Model tab must return focus to the
    // Connect button, NOT to #acct-add-open (which is display:none unless the
    // Settings > Accounts section is showing -> focus would strand on <body>).
    let connectFocusReturns = false;
    if (connectBtn && connectShown) {
      // the modal open/close focus contract only bites when the detail Model tab is
      // actually on screen; reveal its containers so this focus test is faithful
      // (paintOpenaiDetailModel paints into the section but does not navigate to it,
      // so #panel-detail / #d-sec-model start hidden and the button has no layout).
      const panelDetail = document.getElementById('panel-detail');
      const secModel = document.getElementById('d-sec-model');
      if (panelDetail) panelDetail.hidden = false;
      if (secModel) secModel.hidden = false;
      connectBtn.focus();               // the button holds focus when clicked
      connectBtn.click();
      await settle();
      const modal = document.getElementById('acct-add-modal');
      connectOpensFlow = !!modal && modal.hidden === false;
      if (typeof closeAcctAdd === 'function') { try { closeAcctAdd(); } catch { /* reset only */ } }
      await settle();
      connectFocusReturns = (document.activeElement === document.getElementById('d-model-connect'));
    }
    const notListable = {
      onlyOption: sel.options.length === 1,
      optionText: sel.options[0] ? sel.options[0].textContent : '',
      noClaude: !/Claude|sonnet|opus/i.test(sel.innerHTML),
      msg: msg.textContent || '',
      connectShown,
      connectOpensFlow,
      connectFocusReturns,
    };

    // SEQUENCE: the REAL openDetail paint order for a codex agent --
    // paintModelPicker(a) THEN paintProviderPicker(a). This is the interaction
    // that hid the picker: paintProviderPicker used to park #d-model-row (hide +
    // disable + "Switch it back to Anthropic") synchronously AFTER the new picker
    // painted, so the feature was invisible in the app while a direct call to
    // paintOpenaiDetailModel passed. Drives both real functions in order and
    // asserts the model row survives, populated, with no parking message.
    let sequence = { ran: false };
    if (typeof paintModelPicker === 'function' && typeof paintProviderPicker === 'function') {
      const seqAgent = { sessionName: 'oa2', isNamedOurs: true, provider: 'openai', runner: 'codex', account: { dir: '/home/.codex' }, plannedModelName: 'o3' };
      CURRENT = { sessionName: 'oa2', runner: 'codex' };
      window.fetch = async (url) => {
        if (String(url).indexOf('/api/accounts/openai/models') !== -1) {
          return { ok: true, json: async () => ({ ok: true, models: [
            { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' },
          ] }) };
        }
        // The account tail-call (fillSwitchAccounts -> /api/accounts): tolerant stub.
        return { ok: true, json: async () => ({ ok: true, accounts: [] }) };
      };
      await paintModelPicker(seqAgent);   // delegates to paintOpenaiDetailModel
      paintProviderPicker(seqAgent);      // the call that used to hide the row
      await settle();
      await settle();
      const rowEl = document.getElementById('d-model-row');
      const seqMsg = document.getElementById('d-model-msg') || {};
      sequence = {
        ran: true,
        rowVisible: !!rowEl && rowEl.hidden === false,
        hasOpenaiOption: /value="o3"/.test(sel.innerHTML),
        selEnabled: sel.disabled === false,
        noParkingMsg: !/Switch it back to Anthropic/.test(seqMsg.textContent || ''),
        noClaude: !/Claude|sonnet|opus/i.test(sel.innerHTML),
      };
    }

    // #2802 ARMED RESET COVERAGE. The listable.connectHidden and notListable
    // assertions above each read the button's state at one moment; neither proves
    // the code that HIDES a previously-shown button actually runs, so removing
    // either reset left this check green. Show the button (not-listable), then
    // exercise BOTH hide paths so a dropped reset reds the check:
    //  (a) paintOpenaiDetailModel's per-paint default-hide -> repaint LISTABLE;
    //  (b) openDetail's on-open reset -> switch to a CLAUDE agent, whose paint never
    //      runs the OpenAI painter, so ONLY the on-open reset can hide the button.
    let hideCoverage = { ran: false };
    {
      CURRENT = { sessionName: 'oa1' };
      window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: 'this sign-in cannot list models yet; it is not an api key' }) });
      paintOpenaiDetailModel({ ...agent, plannedModelName: '' }, 'oa1');
      await settle();
      const shownGoingIn = (document.getElementById('d-model-connect') || {}).hidden === false;

      // (a) a LISTABLE repaint must hide it (the painter's own default-hide).
      window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, models: [
        { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' },
      ] }) });
      paintOpenaiDetailModel({ ...agent, plannedModelName: 'o3' }, 'oa1');
      await settle();
      const hidByListableRepaint = (document.getElementById('d-model-connect') || {}).hidden === true;

      // re-show (not-listable) so (b) also starts from a visible button.
      window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: 'this sign-in cannot list models yet; it is not an api key' }) });
      paintOpenaiDetailModel({ ...agent, plannedModelName: '' }, 'oa1');
      await settle();
      const reShown = (document.getElementById('d-model-connect') || {}).hidden === false;

      // (b) switch to a CLAUDE agent through the REAL openDetail; the OpenAI painter
      //     never runs for a Claude agent, so only the on-open reset can hide it.
      const openDetailUsable = (typeof openDetail === 'function' && typeof LAST !== 'undefined' && Array.isArray(LAST));
      let hidByClaudeSwitch = false;
      if (openDetailUsable) {
        const claudeAgent = { sessionName: 'cl1', name: 'ClaudeOne', isNamedOurs: true, provider: 'anthropic', account: { dir: '', isDefault: true }, plannedModelName: 'sonnet' };
        LAST.length = 0; LAST.push(claudeAgent);
        openDetail('cl1', 'model');
        await settle();
        hidByClaudeSwitch = (document.getElementById('d-model-connect') || {}).hidden === true;
      }
      hideCoverage = { ran: true, shownGoingIn, hidByListableRepaint, reShown, openDetailUsable, hidByClaudeSwitch };
    }

    // #2802 USABLE-GATE COVERAGE. The show predicate is `usable && not-an-api-key`,
    // where usable = ours && !neverRecorded. Every fixture above is ours+recorded
    // (usable === true), so dropping the `usable &&` clause would still pass every
    // assertion. Paint a NOT-OURS agent whose `because` ALSO matches "not an api
    // key": the button must stay HIDDEN (usable is false) and the msg must show the
    // refusal sentence, not the not-an-api-key note.
    let usableGate = { ran: false };
    {
      CURRENT = { sessionName: 'oa1' };
      // pre-show via an OURS not-listable paint, so we prove the not-ours paint
      // HIDES a visible button rather than merely never showing it.
      window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: 'this sign-in cannot list models yet; it is not an api key' }) });
      paintOpenaiDetailModel({ sessionName: 'oa1', isNamedOurs: true, provider: 'openai', account: { dir: '/home/.codex' }, plannedModelName: '' }, 'oa1');
      await settle();
      const shownGoingIn = (document.getElementById('d-model-connect') || {}).hidden === false;
      // now the SAME not-an-api-key because, but a NOT-OURS agent (usable === false).
      paintOpenaiDetailModel({ sessionName: 'oa1', isNamedOurs: false, provider: 'openai', account: { dir: '/home/.codex' }, plannedModelName: '' }, 'oa1');
      await settle();
      const cb = document.getElementById('d-model-connect');
      const mm2 = document.getElementById('d-model-msg') || {};
      usableGate = {
        ran: true,
        shownGoingIn,
        hiddenForNotOurs: !!cb && cb.hidden === true,
        refusalShown: /cannot change its model/.test(mm2.textContent || ''),
      };
    }

    // #2802 SIBLING-REASON COVERAGE. The show gate's because-half is
    // `/not an api key/i`. Prove it EXCLUDES the OTHER not-listable reasons -- a
    // rejected/forbidden key -- whose real remedy is reconnect, not connect-an-api-
    // key. usable stays true here (ours+recorded), so this isolates the because-half
    // from the usable-half above. Show the button via a not-an-api-key paint, then
    // repaint the SAME agent with a real 401-rejected-key because: the button must
    // go hidden because the because no longer matches. (The string is the literal
    // one engine/openaiaccounts.js:1552 emits for an invalid_api_key 401.)
    let siblingReasonGate = { ran: false };
    {
      CURRENT = { sessionName: 'oa1' };
      window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: 'this sign-in cannot list models yet; it is not an api key' }) });
      paintOpenaiDetailModel({ sessionName: 'oa1', isNamedOurs: true, provider: 'openai', account: { dir: '/home/.codex' }, plannedModelName: '' }, 'oa1');
      await settle();
      const shownGoingIn = (document.getElementById('d-model-connect') || {}).hidden === false;
      window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: "this account's API key was rejected by OpenAI (401)" }) });
      paintOpenaiDetailModel({ sessionName: 'oa1', isNamedOurs: true, provider: 'openai', account: { dir: '/home/.codex' }, plannedModelName: '' }, 'oa1');
      await settle();
      const cb = document.getElementById('d-model-connect');
      siblingReasonGate = {
        ran: true,
        shownGoingIn,
        hiddenForRejectedKey: !!cb && cb.hidden === true,
      };
    }

    return { listable, snapshotPinned, notListable, sequence, hideCoverage, usableGate, siblingReasonGate };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (!r.listable.hasAuto) problems.push('LISTABLE: "Let OpenAI choose" option is missing');
    if (!r.listable.currentSelected) problems.push('LISTABLE: the agent\'s current model (o3) is not pre-selected');
    if (!r.listable.noClaude) problems.push('LISTABLE: a Claude model appears on an OpenAI agent detail page');
    if (r.listable.current !== 'o3') problems.push('LISTABLE: dataset.current is not the agent\'s current key: ' + JSON.stringify(r.listable.current));
    if (!r.snapshotPinned.injectedRow) problems.push('SNAPSHOT (#2191): the agent\'s pinned snapshot (gpt-4o-2024-08-06) is not offered as a row once the menu collapses it');
    if (!r.snapshotPinned.injectedSelected) problems.push('SNAPSHOT (#2191): the pinned snapshot row is not pre-selected');
    if (!r.snapshotPinned.autoNotSelected) problems.push('SNAPSHOT (#2191): "Let OpenAI choose" is selected instead of the agent\'s actual pinned model');
    if (r.snapshotPinned.current !== 'gpt-4o-2024-08-06') problems.push('SNAPSHOT (#2191): dataset.current is not the pinned snapshot: ' + JSON.stringify(r.snapshotPinned.current));
    if (!r.notListable.onlyOption || !/OpenAI picks its own model for now/.test(r.notListable.optionText)) problems.push('NOT LISTABLE: not a single "OpenAI picks its own model for now" option: ' + JSON.stringify(r.notListable.optionText));
    if (!r.notListable.noClaude) problems.push('NOT LISTABLE: a Claude model appears under OpenAI');
    if (!/signed in with ChatGPT/.test(r.notListable.msg)) problems.push('NOT LISTABLE: the reason-keyed note is missing from the msg');
    if (!r.notListable.connectShown) problems.push('#2802: the "Connect an API key" button is not shown for a not-an-api-key (ChatGPT subscription) account, so the disabled model state is inert prose again');
    if (!r.notListable.connectOpensFlow) problems.push('#2802: clicking "Connect an API key" does not open the Add-a-provider flow (#acct-add-modal)');
    if (r.notListable.connectShown && !r.notListable.connectFocusReturns) problems.push('#2802: closing the modal opened from the Model tab did NOT return focus to the Connect button (it strands on <body>, since #acct-add-open is display:none outside Settings -- the #1918 stranded-focus class)');
    if (!r.listable.connectHidden) problems.push('#2802: the "Connect an API key" button leaks into a LISTABLE account (it should be hidden when the account can list models)');
    if (!r.hideCoverage || !r.hideCoverage.ran) {
      problems.push('#2802 coverage: the hide-path coverage block did not run');
    } else {
      if (!r.hideCoverage.shownGoingIn) problems.push('#2802 coverage: the button was not shown by the not-listable paint, so the (a) hide assertion below is vacuous');
      if (!r.hideCoverage.hidByListableRepaint) problems.push('#2802 coverage: a LISTABLE repaint did not hide the Connect button -- paintOpenaiDetailModel\'s per-paint default-hide is not firing, so the button would leak across an OpenAI account switch');
      if (!r.hideCoverage.reShown) problems.push('#2802 coverage: the button did not re-show for the second not-listable paint, so the (b) openDetail-switch assertion below is vacuous');
      if (!r.hideCoverage.openDetailUsable) problems.push('#2802 coverage: openDetail/LAST were not drivable, so the on-open reset (the OpenAI->Claude linger) could not be exercised');
      else if (!r.hideCoverage.hidByClaudeSwitch) problems.push('#2802 coverage: switching to a Claude agent via openDetail did NOT hide the Connect button -- the on-open reset is not firing, so the button lingers under the Claude model tab');
    }
    if (!r.usableGate || !r.usableGate.ran) {
      problems.push('#2802 coverage: the usable-gate coverage block did not run');
    } else {
      if (!r.usableGate.shownGoingIn) problems.push('#2802 coverage: the button was not shown by the ours not-listable paint, so the not-ours hide assertion is vacuous');
      if (!r.usableGate.hiddenForNotOurs) problems.push('#2802 coverage: the Connect button SHOWS for a not-ours (usable=false) not-an-api-key agent -- the `usable &&` half of the show gate is not enforced');
      if (!r.usableGate.refusalShown) problems.push('#2802 coverage: a not-ours account did not show the refusal sentence, so the usable=false path was not exercised');
    }
    if (!r.siblingReasonGate || !r.siblingReasonGate.ran) {
      problems.push('#2802 coverage: the sibling-reason coverage block did not run');
    } else {
      if (!r.siblingReasonGate.shownGoingIn) problems.push('#2802 coverage: the button was not shown by the not-an-api-key paint, so the sibling-reason hide assertion is vacuous');
      if (!r.siblingReasonGate.hiddenForRejectedKey) problems.push('#2802 coverage: the Connect button SHOWS for a rejected-key (401) account -- the `not an api key` half of the show gate does not exclude the sibling not-listable reasons (whose remedy is reconnect, not connect-an-api-key)');
    }
    if (!r.sequence || !r.sequence.ran) {
      problems.push('SEQUENCE: paintModelPicker/paintProviderPicker not both present, so the openDetail order was not exercised');
    } else {
      if (!r.sequence.rowVisible) problems.push('SEQUENCE: #d-model-row is hidden after paintProviderPicker -- the picker is invisible in the app (the BLOCKER this check exists for)');
      if (!r.sequence.hasOpenaiOption) problems.push('SEQUENCE: the OpenAI model option (o3) is missing after the openDetail paint order');
      if (!r.sequence.selEnabled) problems.push('SEQUENCE: #d-model is left disabled after the paint order, so the picker cannot be used');
      if (!r.sequence.noParkingMsg) problems.push('SEQUENCE: the stale "Switch it back to Anthropic" parking message is showing instead of the picker');
      if (!r.sequence.noClaude) problems.push('SEQUENCE: a Claude model appears after the openDetail paint order');
    }
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-detail-openai-model-2140: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-detail-openai-model-2140: an OpenAI agent detail page shows the account models with the current one pre-selected (never a Claude model); a not-listable account shows the single "OpenAI picks its own model for now" option with the reason.');
})();
