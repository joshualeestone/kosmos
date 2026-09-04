'use strict';

/**
 * kosmos#2140: the create-agent OpenAI model picker. On OpenAI the model row is
 * now a per-account picker (not the old fixed "OpenAI picks its own model" note),
 * fed the account's /v1/models via /api/accounts/openai/models. Three states:
 * LISTABLE (the picker with "Let OpenAI choose" first + the account's models),
 * NOT LISTABLE (row hidden, no stale value, a note keyed to why), LOADING.
 *
 * ⚠️ WHY A BROWSER, and why a STUBBED fetch. Drives the real
 * paintOpenaiCreateModel against the real create picker in web/index.html and
 * reads the rendered DOM. The picker fetches the account's models, so this check
 * overrides window.fetch on the file:// page to return canned listable / not-
 * listable responses -- no board, no network. Reds on origin/main, where
 * paintOpenaiCreateModel does not exist (OpenAI had no picker, only a hidden row
 * and a fixed note).
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
      rowHidden: !!row.hidden,
      noStaleValue: sel.value === '',
      whyText: why.textContent || '',
      whyShown: !why.hidden,
    };
    return { listable, notListable };
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
    if (!r.notListable.rowHidden) problems.push('NOT LISTABLE: the picker row is NOT hidden');
    if (!r.notListable.noStaleValue) problems.push('NOT LISTABLE: a stale model value remains and could be submitted');
    if (!/signed in with ChatGPT/.test(r.notListable.whyText) || !r.notListable.whyShown) problems.push('NOT LISTABLE: the reason-keyed fallback note is missing');
  }

  console.log('  ' + JSON.stringify(r));
  if (problems.length) {
    console.error('render-create-openai-model-2140: ' + problems.length + ' problem(s)');
    for (const p of problems) console.error('  FAIL  ' + p);
    process.exit(1);
  }
  console.log('render-create-openai-model-2140: the OpenAI picker lists the account models with "Let OpenAI choose" first and shows a selected model why; a not-listable account hides the row with no stale value and a reason-keyed note.');
})();
