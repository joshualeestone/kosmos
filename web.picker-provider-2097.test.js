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
  // resetCreateProvider assigns this (an auto-default clears the touched sentinel).
  // eslint-disable-next-line no-unused-vars, prefer-const
  let CREATE_PROVIDER_TOUCHED = false;
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

test('#2097(2) (source+exec): the account row is HIDDEN at <2 accounts, SHOWN at 2+ (Josh re-rule 2026-09-04)', () => {
  // Josh re-ruled #2097 on 2026-09-04, superseding the earlier "shown even at one": a single-entry
  // menu is a choice presented to someone who has none to make, and he watched it confuse Ben. So
  // the account row hides itself unless there are two or more accounts to choose from.
  const start = PAGE.indexOf('function fillCreateAccounts');
  const fn = PAGE.slice(start, PAGE.indexOf('\nfunction ', start + 1));
  // source-pin: the hide is present and keyed on the account count.
  assert.match(fn, /create-account-row/, 'fillCreateAccounts no longer references the account row to hide it');
  assert.match(fn, /\.hidden = usable\.length < 2/, 'the account-row hide is no longer keyed on usable.length < 2');

  // exec: run fillCreateAccounts against a fake DOM and read the row's hidden state by account count.
  function hiddenWith(accounts) {
    const asel = { innerHTML: '' };
    const arow = { hidden: false };
    const prov = { value: 'anthropic' };
    // eslint-disable-next-line no-unused-vars
    const document = { getElementById: (id) => (
      id === 'create-account' ? asel : id === 'create-account-row' ? arow : id === 'create-provider' ? prov : null) };
    // eslint-disable-next-line no-unused-vars
    const CREATE_ACCOUNTS = accounts;
    // eslint-disable-next-line no-unused-vars
    const accountQualifiers = () => new Map();
    // eslint-disable-next-line no-unused-vars
    const esc = (s) => String(s);
    // eslint-disable-next-line no-eval
    eval('(' + fn + ')')();
    return arow.hidden;
  }
  assert.equal(hiddenWith([{ provider: 'anthropic', email: 'a@x.com' }]), true, 'one account -> row hidden');
  assert.equal(hiddenWith([{ provider: 'anthropic', email: 'a@x.com' }, { provider: 'anthropic', email: 'b@x.com' }]), false, 'two accounts -> row shown');
  assert.equal(hiddenWith([]), true, 'no usable accounts -> row hidden (placeholder is not a choice)');
});

// resetCreateProvider decides the default BEFORE CREATE_ACCOUNTS is fetched, so loadCreateExtras
// must re-apply the openai default once the real list lands, or the OpenAI-only default is inert on
// the first create of a page session. Source-pin it (loadCreateExtras is async + fetches, so it is
// not eval-executable in this harness) and prove the guard is present and correctly conditioned.
test('#2097(3) (source): loadCreateExtras re-defaults to openai once CREATE_ACCOUNTS loads (first-create fix)', () => {
  const start = PAGE.indexOf('async function loadCreateExtras');
  assert.ok(start > 0, 'loadCreateExtras moved or was renamed');
  const fn = PAGE.slice(start, PAGE.indexOf('\n}\n', start) + 2);
  // gated on the untouched-default sentinel, NOT value-equality: value alone cannot tell an
  // untouched 'anthropic' default from an import that set 'anthropic' deliberately.
  assert.match(fn, /!CREATE_PROVIDER_TOUCHED/, 'the re-default is not guarded on the untouched sentinel -- it could override a deliberately-set provider (e.g. an anthropic import on an OpenAI-only machine)');
  // upgrades to openai only when OpenAI is the sole usable provider
  assert.match(fn, /!hasClaude && hasOpenai.*prov\.value = 'openai'/s, 'loadCreateExtras does not upgrade an OpenAI-only default to openai after the accounts load');
});

// The sentinel is only correct if it is actually armed: the provider change handler must SET it
// (a manual pick or an import's explicit set both fire `change`), and resetCreateProvider must
// CLEAR it (an auto-default is not a choice). Without both, the guard above is inert.
test('#2097(3b) (source): the touched sentinel is armed by the change handler and cleared by reset', () => {
  const listenerAt = PAGE.indexOf("getElementById('create-provider').addEventListener('change'");
  assert.ok(listenerAt > 0, 'the create-provider change listener moved or was renamed');
  const listener = PAGE.slice(listenerAt, PAGE.indexOf('});', listenerAt) + 3);
  assert.match(listener, /CREATE_PROVIDER_TOUCHED = true/, 'the change handler does not mark the provider touched -- an import/manual set would not disarm the re-default');
  const resetAt = PAGE.indexOf('function resetCreateProvider');
  const reset = PAGE.slice(resetAt, PAGE.indexOf('\n}\n', resetAt) + 2);
  assert.match(reset, /CREATE_PROVIDER_TOUCHED = false/, 'resetCreateProvider does not clear the touched sentinel -- the first-create re-default would never fire after any earlier touch');
});
