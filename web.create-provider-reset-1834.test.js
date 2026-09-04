"use strict";
/**
 * #1834: the create-agent provider must reset consistently, so a role re-pick (or a reopened
 * form) cannot leave the provider on OpenAI while the rebuilt model menu lists Claude models
 * with the picker disabled -- a provider/model mismatch.
 *
 * Before this fix, create-provider was reset by NEITHER openCreate NOR refillDetails' role-change
 * branch (deliberately, to keep the two paths consistent -- but consistent at the WRONG value).
 * The fix routes both paths through resetCreateProvider(), which sets the provider back to the
 * markup default (`anthropic`) and re-applies the provider UI side effects via the shared
 * applyCreateProviderUI() -- re-enabling the model picker and restoring the Claude account menu --
 * so a bare value reset cannot leave those stale.
 *
 * These run the SHIPPED functions against a fake document + stubbed collaborators, so what is
 * under test is the code that ships, not a paraphrase. The reachability of the mismatch in the
 * current build is bounded (the step-two -> step-one Back button was removed 2026-08-19), so this
 * fix is defensive against a restored Back path -- exactly the latent-trap class of #1801.
 *
 *   node --test web.create-provider-reset-1834.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

// Slice each shipped top-level function (its closing brace is at column 0 -> '\n}\n').
function sliceFn(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' not found -- the #1834 fix is not present (or the function moved; re-anchor this test)');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
}
const applyFn = sliceFn('applyCreateProviderUI');
const resetFn = sliceFn('resetCreateProvider');

// Run resetCreateProvider() (which calls applyCreateProviderUI) against a fake document, seeding
// the OpenAI-selected state the mismatch leaves behind, and report the observable result.
function run(fn, seed) {
  const calls = { fill: 0, fillProviderAtCall: null, paint: 0 };
  const els = {
    'create-provider': { value: seed.provider },
    'create-model': { disabled: seed.modelDisabled, value: seed.model || 'claude-sonnet' },
    'create-account': { disabled: seed.acctDisabled, innerHTML: seed.acctHTML || '' },
    'create-model-why': { textContent: seed.why || '' },
  };
  const document = { getElementById: (id) => (id in els ? els[id] : null) };
  const wrap = `
    const fillCreateAccounts = () => {
      _calls.fill += 1;
      _calls.fillProviderAtCall = document.getElementById('create-provider').value;
    };
    const paintModelWhy = () => { _calls.paint += 1; };
    // #2140: switching to OpenAI now invokes the per-account model picker instead
    // of the old fixed note; stub it so this reset-consistency test (which is about
    // FORM state, not the picker's async detail) can run the shipped function.
    const paintOpenaiCreateModel = () => { _calls.paintOpenai = (_calls.paintOpenai || 0) + 1; };
    const esc = (s) => String(s == null ? '' : s);
    // #2097: resetCreateProvider now reads CREATE_ACCOUNTS to pick a default for a provider
    // the machine has an account for, and clears CREATE_PROVIDER_TOUCHED. These reset tests
    // are about FORM state (undoing an OpenAI selection), not account presence, so seed no
    // accounts -> the default stays the markup default (anthropic). The provider-aware default
    // is covered in web.picker-provider-2097.test.js.
    const CREATE_ACCOUNTS = [];
    let CREATE_PROVIDER_TOUCHED = false;
    ${applyFn}
    ${resetFn}
    ${fn};
    return {
      provider: document.getElementById('create-provider').value,
      modelDisabled: document.getElementById('create-model').disabled,
      acctDisabled: document.getElementById('create-account').disabled,
      why: document.getElementById('create-model-why').textContent,
    };
  `;
  // eslint-disable-next-line no-new-func
  const out = new Function('document', '_calls', wrap)(document, calls);
  return { ...out, calls };
}

const OPENAI_STATE = {
  provider: 'openai', modelDisabled: true, acctDisabled: false,
  acctHTML: '<option>an openai key</option>', why: 'OpenAI picks its own model for now.',
};

test('#1834: resetCreateProvider() puts the form back on Claude and undoes the OpenAI side effects', () => {
  const r = run('resetCreateProvider()', OPENAI_STATE);
  assert.equal(r.provider, 'anthropic', 'the provider was not reset to the Claude default');
  assert.equal(r.modelDisabled, false, 'the model picker stayed disabled -- the mismatch this card names');
  assert.equal(r.why, '', 'the OpenAI model-why note was not cleared on the reset to Claude');
  assert.equal(r.calls.fill, 1, 'the account menu was not refilled on the reset');
  assert.equal(r.calls.fillProviderAtCall, 'anthropic',
    'the account menu was refilled while the provider still read openai -- it would show OpenAI accounts against a Claude model menu');
});

test('#1834/#2140: applyCreateProviderUI() is faithful for a manual OpenAI change (the shared function is not weakened)', () => {
  // Seed a Claude state, then switch to OpenAI and apply -- the exact thing the change listener does.
  const r = run("document.getElementById('create-provider').value = 'openai'; applyCreateProviderUI()", {
    provider: 'anthropic', modelDisabled: false, acctDisabled: false, why: '',
  });
  // #2140: OpenAI now routes to the per-account model picker (paintOpenaiCreateModel),
  // which owns the model row / select / note across its own states -- so this test no
  // longer asserts the retired blanket "disable + fixed note" (#2098), it asserts the
  // picker path is invoked and the account menu is refilled for OpenAI. The picker's
  // loading/listable/not-listable behaviour is covered in web.picker-openai-model-2140
  // and the browser check.
  assert.equal(r.calls.paintOpenai, 1, 'switching to OpenAI must invoke the per-account model picker');
  assert.equal(r.calls.fillProviderAtCall, 'openai', 'the account menu was not refilled for OpenAI');
});

// Wiring: prove BOTH reset entry paths actually call resetCreateProvider(), not just that the
// function exists. A test that only ran the function would be an unarmed guard if nothing called it.
function fnBody(name) {
  const at = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' not found; re-anchor');
  return SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 2);
}
test('#1834: openCreate() calls resetCreateProvider()', () => {
  assert.match(fnBody('openCreate'), /resetCreateProvider\(\)/,
    'openCreate does not reset the provider -- a reopened form could keep the previous OpenAI selection');
});
test('#1834: refillDetails() resets the provider on a role change', () => {
  const body = fnBody('refillDetails');
  assert.match(body, /resetCreateProvider\(\)/,
    'refillDetails does not reset the provider -- a role re-pick could keep the previous OpenAI selection');
  // And it must sit inside the resetDirty branch (the role-CHANGE reset), not fire on a same-role return.
  const guard = body.indexOf('if (resetDirty)');
  const call = body.indexOf('resetCreateProvider()');
  const branchEnd = body.indexOf('\n  }', guard);
  assert.ok(guard > 0 && call > guard && call < branchEnd,
    'resetCreateProvider() is not inside the resetDirty branch -- it would wrongly reset the provider on a same-role return too');
});
