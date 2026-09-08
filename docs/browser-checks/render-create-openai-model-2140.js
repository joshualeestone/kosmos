'use strict';

/**
 * kosmos#2140: the create-agent OpenAI model picker. On OpenAI the model row is
 * now a per-account picker (not the old fixed "OpenAI picks its own model" note),
 * fed the account's /v1/models via /api/accounts/openai/models. Three states:
 * LISTABLE (the picker with "Let OpenAI choose" first + the account's models),
 * NOT LISTABLE (the box shows "OpenAI picks its own model for now" as its single
 * disabled option -- never a Claude model, per Josh 2026-09-04 -- with a keyed note), LOADING.
 *
 * ⚠️ WHY A BROWSER, and why a STUBBED fetch. Drives the real
 * paintOpenaiCreateModel against the real create picker in web/index.html and
 * reads the rendered DOM. The picker fetches the account's models, so this check
 * overrides window.fetch on the file:// page to return canned listable / not-
 * listable responses -- no board, no network. Reds on the pre-#2140 index (where
 * paintOpenaiCreateModel does not exist), and on the pre-refinement #2140 index
 * (where the not-listable state HID the box instead of showing the single option).
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-create-openai-model-2140.js
 *
 * ⚠️ HEADED by default; HEADED=0 on a console-less machine. Asserts rendered DOM.
 */

const nodePath = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.log('render-create-openai-model-2140: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: process.env.HEADED === '0' }); }
  catch (err) {
    console.error('FAIL  render-create-openai-model-2140: could not start a browser'
      + (process.env.HEADED === '0' ? '.' : ' (headed; try HEADED=0).'));
    console.error('  ' + (err && err.message ? err.message.split('\n')[0] : err));
    process.exit(1);
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto('file://' + PAGE);

  const r = await page.evaluate(async () => {
    if (typeof paintOpenaiCreateModel !== 'function') return { error: 'paintOpenaiCreateModel is not a function (the #2140 picker was not added)' };
    const prov = document.getElementById('create-provider');
    const sel = document.getElementById('create-model');
    const row = document.getElementById('create-model-row');
    const why = document.getElementById('create-model-why');
    const acct = document.getElementById('create-account');
    if (!prov || !sel || !row || !why || !acct) return { error: 'a create-model/account element is missing' };
    // Name an OpenAI account so the picker has a dir to fetch for.
    acct.innerHTML = '<option value="/home/.codex" selected>the OpenAI sign-in</option>';
    prov.value = 'openai';
    const settle = () => new Promise((res) => setTimeout(res, 40));

    // LISTABLE: stub the models fetch with two chat models.
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, models: [
      { key: 'gpt-5-codex', provider: 'openai', label: 'GPT-5-codex', arg: 'gpt-5-codex', why: 'The coding one.' },
      { key: 'o3', provider: 'openai', label: 'o3', arg: 'o3', why: 'A reasoning model.' },
    ] }) });
    paintOpenaiCreateModel();
    await settle();
    const opts = Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent }));
    // Selecting a concrete model must surface its why via the shared paintModelWhy.
    sel.value = 'o3'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const listable = {
      rowHidden: !!row.hidden,
      firstAuto: opts[0] && opts[0].v === '' && /Let OpenAI choose/.test(opts[0].t),
      hasModels: opts.some((o) => o.v === 'gpt-5-codex') && opts.some((o) => o.v === 'o3'),
      whyOnSelect: (why.textContent || ''),
      whyShownOnSelect: !why.hidden,
    };

    // NOT LISTABLE: stub a ChatGPT-mode (not-an-API-key) answer.
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: false, because: 'this sign-in cannot list models yet; it is not an API key' }) });
    paintOpenaiCreateModel();
    await settle();
    const notListable = {
      rowShown: !row.hidden,
      onlyOption: sel.options.length === 1,
      optionText: sel.options[0] ? sel.options[0].textContent : '',
      noClaude: !/Claude|sonnet|opus/i.test(sel.innerHTML),
      noStaleValue: sel.value === '',
      whyText: why.textContent || '',
      whyShown: !why.hidden,
    };
    // IMPORT DEFAULT (#2453 follow-up): an OpenAI IMPORT lands on the account's default
    // model. Stub a listable response where exactly one model is marked default:true.
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, models: [
      { key: 'gpt-5', provider: 'openai', label: 'GPT-5', arg: 'gpt-5', why: 'top', default: false },
      { key: 'gpt-4o', provider: 'openai', label: 'GPT-4o', arg: 'gpt-4o', why: 'mid', default: true },
    ] }) });
    // Control: with NO import flag, a normal create stays on "Let OpenAI choose" (value "").
    IMPORT_OPENAI_DEFAULT = false;   // eslint-disable-line no-undef
    paintOpenaiCreateModel();
    await settle();
    const noImportValue = sel.value;
    // Import: pre-picks the account default (gpt-4o), and consumes the one-shot flag.
    IMPORT_OPENAI_DEFAULT = true;    // eslint-disable-line no-undef
    paintOpenaiCreateModel();
    await settle();
    const importPicked = sel.value;
    const clearedAfter = (typeof IMPORT_OPENAI_DEFAULT === 'undefined') ? 'undef' : IMPORT_OPENAI_DEFAULT;   // eslint-disable-line no-undef
    // Fallback: import flag set but the list carries NO default -> stays "Let OpenAI choose".
    window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, models: [
      { key: 'gpt-5', provider: 'openai', label: 'GPT-5', arg: 'gpt-5', why: 'x', default: false },
    ] }) });
    IMPORT_OPENAI_DEFAULT = true;    // eslint-disable-line no-undef
    paintOpenaiCreateModel();
    await settle();
    const noDefaultFallback = sel.value;
    const importDefault = { noImportValue, importPicked, clearedAfter, noDefaultFallback };

    // LIFECYCLE clears: resetCreateProvider (fresh create) and switching to Claude both
    // drop the one-shot, so an abandoned/detoured import cannot pre-pick on a later create.
    IMPORT_OPENAI_DEFAULT = true;                                   // eslint-disable-line no-undef
    resetCreateProvider();                                         // eslint-disable-line no-undef
    const clearedByReset = (typeof IMPORT_OPENAI_DEFAULT === 'undefined') ? 'undef' : IMPORT_OPENAI_DEFAULT;   // eslint-disable-line no-undef
    IMPORT_OPENAI_DEFAULT = true;                                   // eslint-disable-line no-undef
    prov.value = 'anthropic'; applyCreateProviderUI();            // eslint-disable-line no-undef
    const clearedBySwitch = (typeof IMPORT_OPENAI_DEFAULT === 'undefined') ? 'undef' : IMPORT_OPENAI_DEFAULT;  // eslint-disable-line no-undef
    const lifecycle = { clearedByReset, clearedBySwitch };

    return { listable, notListable, importDefault, lifecycle };
  });

  await browser.close();

  const problems = [];
  if (r.error) {
    problems.push(r.error);
  } else {
    if (r.listable.rowHidden) problems.push('LISTABLE: the picker row is hidden but should be shown');
    if (!r.listable.firstAuto) problems.push('LISTABLE: the first option is not the empty-valued "Let OpenAI choose"');
    if (!r.listable.hasModels) problems.push('LISTABLE: the account models (gpt-5-codex, o3) are not offered');
    if (!/reasoning/i.test(r.listable.whyOnSelect) || !r.listable.whyShownOnSelect) problems.push('LISTABLE: selecting a model did not surface its why-line');
    if (!r.notListable.rowShown) problems.push('NOT LISTABLE: the model box is hidden -- it must show "OpenAI picks its own model for now" (Josh 2026-09-04)');
    if (!r.notListable.onlyOption || !/OpenAI picks its own model for now/.test(r.notListable.optionText)) problems.push('NOT LISTABLE: the box is not a single "OpenAI picks its own model for now" option: ' + JSON.stringify(r.notListable.optionText));
    if (!r.notListable.noClaude) problems.push('NOT LISTABLE: a Claude model appears under OpenAI');
    if (!r.notListable.noStaleValue) problems.push('NOT LISTABLE: a stale model value remains and could be submitted');
    if (!/signed in with ChatGPT/.test(r.notListable.whyText) || !r.notListable.whyShown) problems.push('NOT LISTABLE: the reason-keyed fallback note is missing');
    // IMPORT DEFAULT (#2453 follow-up)
    if (r.importDefault.noImportValue !== '') problems.push('IMPORT: with no import flag, a normal create must stay on "Let OpenAI choose" (value ""): ' + JSON.stringify(r.importDefault.noImportValue));
    if (r.importDefault.importPicked !== 'gpt-4o') problems.push('IMPORT: an OpenAI import did not pre-pick the account default model (gpt-4o): ' + JSON.stringify(r.importDefault.importPicked));
    if (r.importDefault.clearedAfter !== false) problems.push('IMPORT: the one-shot import flag was not consumed after the paint: ' + JSON.stringify(r.importDefault.clearedAfter));
    if (r.importDefault.noDefaultFallback !== '') problems.push('IMPORT (fallback): a list with no default must stay on "Let OpenAI choose" (value ""): ' + JSON.stringify(r.importDefault.noDefaultFallback));
    if (r.lifecycle.clearedByReset !== false) problems.push('LIFECYCLE: resetCreateProvider did not clear the import flag: ' + JSON.stringify(r.lifecycle.clearedByReset));
    if (r.lifecycle.clearedBySwitch !== false) problems.push('LIFECYCLE: switching to Claude did not clear the import flag (the gen-mismatch strand fix): ' + JSON.stringify(r.lifecycle.clearedBySwitch));
    // SOURCE-PIN the producer: the browser drove the flag by assignment, so pin that
    // finishImport SETS it authoritatively (true only for an OpenAI import) in source.
    const src = require('node:fs').readFileSync(PAGE, 'utf8');
    if (!/IMPORT_OPENAI_DEFAULT = \(wanted === 'openai'\)/.test(src)) problems.push('SOURCE: finishImport does not set IMPORT_OPENAI_DEFAULT authoritatively (= (wanted === openai))');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-create-openai-model-2140: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-create-openai-model-2140: the OpenAI picker lists the account models with "Let OpenAI choose" first and shows a selected model why; a not-listable account shows the box with the single "OpenAI picks its own model for now" option (no Claude model) and a reason-keyed note.');
})();
