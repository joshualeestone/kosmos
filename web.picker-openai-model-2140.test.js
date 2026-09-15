"use strict";
/**
 * #2140: the OpenAI create-model picker. Runs the SHIPPED functions
 * (paintOpenaiCreateModel + openaiNoModelsNote) against a fake document with a
 * stubbed fetch, so what is tested is the code that ships. Three states:
 * LISTABLE (the picker with "Let OpenAI choose" first + the account's models,
 * kept in the separate OPENAI_PICK_MODELS cache -- NOT merged into the Claude-only
 * CREATE_MODELS -- so paintModelWhy resolves them without polluting the Claude
 * menus), NOT LISTABLE (the box shows "OpenAI picks its own model for now" as its
 * single disabled option -- never a Claude model, per Josh's 2026-09-04 refinement --
 * with a note keyed to accountModels' `because`), and no account chosen. Plus the
 * copy map is asserted case by case.
 *
 *   node --test web.picker-openai-model-2140.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
function sliceFn(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' not found -- #2140 picker not present (or the function moved; re-anchor)');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
}
const paintFn = sliceFn('paintOpenaiCreateModel');
const noteFn = sliceFn('openaiNoModelsNote');

async function runPicker({ fetchOk, fetchBody, acctDir, seedModels, savedModel }) {
  const els = {
    'create-model-row': { hidden: false },
    // value starts '' = the "Let OpenAI choose" default; the picker only sets it when it
    // applies an import default or the #3081 saved model, so a case that does neither leaves ''.
    'create-model': { disabled: false, innerHTML: '', value: '' },
    'create-model-why': { textContent: '', hidden: true },
    'create-account': { value: acctDir == null ? '' : acctDir },
  };
  const document = { getElementById: (id) => (id in els ? els[id] : null) };
  const calls = { paintWhy: 0, fetchUrl: null };
  const wrap = `
    let OPENAI_MODELS_GEN = 0;
    let CREATE_MODELS = ${JSON.stringify(seedModels || [])};
    let OPENAI_PICK_MODELS = [];
    let IMPORT_OPENAI_DEFAULT = false;   /* #2453 follow-up: paintOpenaiCreateModel reads this one-shot OpenAI-import default flag */
    let CREATE_PREF_OPENAI_MODEL = ${JSON.stringify(savedModel || '')};   /* #3081: paintOpenaiCreateModel reads + consumes this saved-model one-shot */
    const esc = (s) => String(s == null ? '' : s);
    const paintModelWhy = () => { _calls.paintWhy += 1; };
    const fetch = async (url) => { _calls.fetchUrl = url; return { ok: ${fetchOk ? 'true' : 'false'}, json: async () => (${JSON.stringify(fetchBody || {})}) }; };
    ${noteFn}
    ${paintFn}
    paintOpenaiCreateModel();
    /* #3081: the flag the INSTANT the paint call returns -- i.e. after the async IIFE ran
       synchronously up to its await. The fix consumes the one-shot there (before the await),
       so a real account paint reads '' here; that is exactly what makes a concurrent LATER
       paint (a manual account switch fired before this fetch resolves) see the flag already
       cleared and fall through to the default, instead of re-forcing the stale saved model. */
    const savedModelSync = CREATE_PREF_OPENAI_MODEL;
    // A reader closure, because paintOpenaiCreateModel REASSIGNS OPENAI_PICK_MODELS
    // inside its async, so a value captured now would be the pre-fetch empty array.
    return () => ({ CREATE_MODELS: CREATE_MODELS.slice(), OPENAI_PICK_MODELS: OPENAI_PICK_MODELS.slice(), savedModelAfter: CREATE_PREF_OPENAI_MODEL, savedModelSync });
  `;
  // eslint-disable-next-line no-new-func
  const read = new Function('document', '_calls', wrap)(document, calls);
  await new Promise((r) => setTimeout(r, 15)); // let the fire-and-forget fetch resolve
  const state = read();
  return { els, calls, CREATE_MODELS: state.CREATE_MODELS, OPENAI_PICK_MODELS: state.OPENAI_PICK_MODELS, savedModelAfter: state.savedModelAfter, savedModelSync: state.savedModelSync };
}

test('#2140 LISTABLE: the picker shows "Let OpenAI choose" first + the account models, in a SEPARATE cache (Claude CREATE_MODELS is not polluted)', async () => {
  const r = await runPicker({
    fetchOk: true,
    fetchBody: { ok: true, models: [
      { key: 'gpt-5-codex', provider: 'openai', label: 'GPT 5 Codex', arg: 'gpt-5-codex', why: 'The coding one.' },
      { key: 'o3', provider: 'openai', label: 'O3', arg: 'o3', why: 'A reasoning model.' },
    ] },
    acctDir: '/home/.codex',
    seedModels: [{ key: 'sonnet', provider: 'anthropic', label: 'Claude Sonnet 5', why: 'x' }],
  });
  assert.equal(r.els['create-model-row'].hidden, false, 'the picker row must be shown for a listable account');
  const html = r.els['create-model'].innerHTML;
  assert.match(html, /value=""[^>]*>Let OpenAI choose \(recommended\)/, 'the auto option must be first and empty-valued');
  assert.match(html, /value="gpt-5-codex">GPT 5 Codex/);
  assert.match(html, /value="o3">O3/);
  // The OpenAI models live in OPENAI_PICK_MODELS (for paintModelWhy) and must NOT
  // pollute the Claude CREATE_MODELS the Claude create/detail pickers render whole.
  assert.ok(r.OPENAI_PICK_MODELS.some((m) => m.key === 'gpt-5-codex'), 'the OpenAI models were not kept in OPENAI_PICK_MODELS for paintModelWhy');
  assert.ok(!r.CREATE_MODELS.some((m) => m.provider === 'openai'), 'an OpenAI model leaked into the Claude CREATE_MODELS list');
  assert.deepEqual(r.CREATE_MODELS.map((m) => m.key), ['sonnet'], 'CREATE_MODELS was mutated by the OpenAI picker');
  assert.equal(r.calls.paintWhy >= 1, true, 'paintModelWhy was not called to show the selected model why');
  assert.match(r.calls.fetchUrl, /\/api\/accounts\/openai\/models\?dir=/, 'the per-account models route was not fetched');
  assert.match(r.calls.fetchUrl, /home.*codex/, 'the fetch did not carry the selected account dir');
});

test('#2140 NOT LISTABLE: the box SHOWS "OpenAI picks its own model for now" as the single option (Josh 2026-09-04), never a Claude model, with the keyed note', async () => {
  const r = await runPicker({
    fetchOk: true,
    fetchBody: { ok: false, because: 'this sign-in cannot list models yet; it is not an API key' },
    acctDir: '/home/.codex',
    seedModels: [{ key: 'claude-sonnet', provider: 'anthropic', label: 'Claude Sonnet 5', why: 'x' }],
  });
  // Josh's refinement: the model box stays VISIBLE with a single OpenAI option, not hidden.
  assert.equal(r.els['create-model-row'].hidden, false, 'the model box must stay shown when OpenAI cannot expose a choice');
  const html = r.els['create-model'].innerHTML;
  assert.match(html, /value="" selected>OpenAI picks its own model for now</, 'the single option must be "OpenAI picks its own model for now"');
  assert.doesNotMatch(html, /Claude|sonnet|opus/i, 'no Claude model may appear under OpenAI');
  assert.equal(r.els['create-model'].disabled, true, 'the single-option box is not a real choice, so it is disabled');
  assert.equal(r.els['create-model-why'].hidden, false, 'the reason note must be shown below');
  assert.match(r.els['create-model-why'].textContent, /signed in with ChatGPT/, 'the note was not keyed to the not-an-API-key reason');
});

test('#2140 NO ACCOUNT: the box shows the single OpenAI option (no Claude model) and the auto note, without a fetch', async () => {
  const r = await runPicker({ fetchOk: false, fetchBody: {}, acctDir: '' });
  assert.equal(r.els['create-model-row'].hidden, false, 'the model box must stay shown');
  assert.match(r.els['create-model'].innerHTML, /value="" selected>OpenAI picks its own model for now</);
  assert.doesNotMatch(r.els['create-model'].innerHTML, /Claude|sonnet|opus/i);
  assert.equal(r.els['create-model-why'].hidden, false);
  assert.match(r.els['create-model-why'].textContent, /Once this account is signed in/);
  assert.equal(r.calls.fetchUrl, null, 'no account was chosen, so no models fetch should have fired');
});

test('#2140 copy: openaiNoModelsNote maps each accountModels reason to Josh-voice copy (no em dashes)', () => {
  // eslint-disable-next-line no-new-func
  const note = new Function(noteFn + '\nreturn openaiNoModelsNote;')();
  const cases = [
    ['this sign-in cannot list models yet; it is not an API key', /signed in with ChatGPT/],
    ['this account has no chat models we recognise yet', /could not find a model we recognise/],
    ['OpenAI did not return this account\'s models (it answered 500)', /could not reach OpenAI/],
    ['nobody has signed in to this account yet', /Once this account is signed in/],
    [null, /Once this account is signed in/],
  ];
  for (const [because, re] of cases) {
    const out = note(because);
    assert.match(out, re, 'wrong copy for because=' + JSON.stringify(because));
    assert.doesNotMatch(out, /—/, 'an em dash slipped into the note copy');
  }
});

/* #3081: the saved-OpenAI-model one-shot (CREATE_PREF_OPENAI_MODEL). These run the shipped
   paintOpenaiCreateModel with the flag armed, so they exercise the actual restore + consume
   path -- not just the standalone helpers. The savedModelSync assertions pin the WARNING-2
   fix: the flag is consumed BEFORE the await, so a superseded later paint cannot re-apply it. */
test('#3081: an armed saved model that IS in the account list is selected', async () => {
  const r = await runPicker({
    fetchOk: true,
    fetchBody: { ok: true, models: [
      { key: 'gpt-5-codex', provider: 'openai', label: 'GPT 5 Codex', why: 'x' },
      { key: 'o3', provider: 'openai', label: 'O3', why: 'y' },
    ] },
    acctDir: '/home/.codex',
    savedModel: 'o3',
  });
  assert.equal(r.els['create-model'].value, 'o3', 'the saved model, offered by this account, was not restored');
  assert.equal(r.savedModelSync, '', 'the one-shot must be cleared synchronously (before the await), or a concurrent later paint re-forces it');
  assert.equal(r.savedModelAfter, '', 'the one-shot must not survive the paint');
});

test('#3081: an armed saved model that is NOT in the account list falls through to "Let OpenAI choose"', async () => {
  const r = await runPicker({
    fetchOk: true,
    fetchBody: { ok: true, models: [
      { key: 'gpt-5-codex', provider: 'openai', label: 'GPT 5 Codex', why: 'x' },
    ] },
    acctDir: '/home/.codex',
    savedModel: 'o3-retired',   // this account no longer offers it
  });
  assert.equal(r.els['create-model'].value, '', 'a saved model not offered by this account must NOT be selected (stays on the auto default)');
  assert.equal(r.savedModelSync, '', 'the one-shot is consumed even when the saved model is not applied');
  assert.equal(r.savedModelAfter, '', 'the one-shot must not survive to a later paint');
});

test('#3081 control: a NOT-LISTABLE account still consumes the one-shot (never re-applied to the next account)', async () => {
  const r = await runPicker({
    fetchOk: true,
    fetchBody: { ok: false, because: 'nobody has signed in to this account yet' },
    acctDir: '/home/.codex',
    savedModel: 'o3',
  });
  // The box shows the single disabled OpenAI option; the saved model cannot and must not apply.
  assert.match(r.els['create-model'].innerHTML, /OpenAI picks its own model for now/);
  assert.equal(r.savedModelSync, '', 'a not-listable account must still consume the one-shot before the await');
  assert.equal(r.savedModelAfter, '', 'the one-shot must not leak to the next account paint');
});

test('#3081: a flag armed while NO account is chosen SURVIVES the account-less paint (mirrors IMPORT_OPENAI_DEFAULT)', async () => {
  const r = await runPicker({ fetchOk: false, fetchBody: {}, acctDir: '', savedModel: 'o3' });
  // No account -> the paint early-returns before the IIFE, so the one-shot is NOT consumed and
  // survives to the paint that finally has an account (the same contract IMPORT_OPENAI_DEFAULT keeps).
  assert.equal(r.calls.fetchUrl, null, 'no account was chosen, so no models fetch should have fired');
  assert.equal(r.savedModelSync, 'o3', 'a flag armed before an account exists must survive the account-less paint');
});
