'use strict';
/*
 * #2097/#2098 -- the create-agent picker is provider-aware. Executes the small
 * resetCreateProvider against a fake DOM (its default-provider logic), and pins the
 * two hide behaviours in source (the browser check render-picker-provider-2097.js
 * proves the model-row hide renders).
 *
 *   node --test web.picker-provider-2097.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SRC = PAGE.match(/function resetCreateProvider\(\) \{[\s\S]*?\n\}/);
assert.ok(SRC, 'resetCreateProvider moved or was renamed');

function defaultFor(accounts) {
  const prov = { value: null };
  // eslint-disable-next-line no-unused-vars
  const document = { getElementById: (id) => (id === 'create-provider' ? prov : null) };
  // eslint-disable-next-line no-unused-vars
  const CREATE_ACCOUNTS = accounts;
  // eslint-disable-next-line no-unused-vars
  const applyCreateProviderUI = () => {};
  // eslint-disable-next-line no-eval
  const fn = eval('(' + SRC[0] + ')');
  fn();
  return prov.value;
}

test('#2097: OpenAI-only accounts -> the provider defaults to openai', () => {
  assert.equal(defaultFor([{ provider: 'openai', keyTail: 'NfYA' }]), 'openai');
});

test('#2097: a Claude account present -> defaults to anthropic (the user has Claude)', () => {
  assert.equal(defaultFor([{ provider: 'anthropic', email: 'her@x.com' }]), 'anthropic');
  // mixed: a Claude account exists, so start on Claude (do not surprise a Claude user)
  assert.equal(defaultFor([{ provider: 'anthropic' }, { provider: 'openai' }]), 'anthropic');
});

test('#2097: no accounts loaded yet -> falls back to anthropic (never start on an unusable provider)', () => {
  assert.equal(defaultFor([]), 'anthropic');
});

test('#2098 (source): applyCreateProviderUI hides the model ROW whole on OpenAI, not just disables it', () => {
  const start = PAGE.indexOf('function applyCreateProviderUI');
  const fn = PAGE.slice(start, PAGE.indexOf('\nfunction ', start + 1));
  assert.match(fn, /create-model-row/, 'the model row is no longer hidden whole on OpenAI (a disabled select still shows its Claude value)');
  assert.match(fn, /modelRow\.hidden = openai/, 'the model row hide is not keyed on the openai provider');
});

test('#2097(2) (source): fillCreateAccounts hides the account row when there is <=1 account', () => {
  const start = PAGE.indexOf('function fillCreateAccounts');
  const fn = PAGE.slice(start, PAGE.indexOf('\nfunction ', start + 1));
  assert.match(fn, /create-account-row/, 'the account row is no longer hidden when there is nothing to pick');
  assert.match(fn, /acctRow\.hidden = usable\.length <= 1/, 'the account-row hide condition changed shape');
});
