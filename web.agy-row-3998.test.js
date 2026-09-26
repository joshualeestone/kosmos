'use strict';

/**
 * #3998 review round 2: the Gemini SUBSCRIPTION row in Settings (authMode 'antigravity') has no key
 * and no account folder. While it was provider 'google' every key path on the page read it as a
 * Gemini API key: the create menu offered "Google Gemini (API key)", the account list sent with a
 * new agent listed it (an agent created with no key), the move picker offered it, and the guided
 * setup counted it as a connected Gemini key. These execute the page's own functions on it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}
const routeAt = PAGE.indexOf('const ACCT_KEYED_ROUTE');
// eslint-disable-next-line no-new-func
const api = new Function(PAGE.slice(routeAt, PAGE.indexOf('\n', routeAt)) + '\n' + grab('function acctProvider(') + '\n'
  + grab('function acctOfferableTarget(') + '\n' + grab('function paintKeyedProviderOptions(') + '\n'
  + grab('function acctMoveWorld(') + '\n'
  + 'return { acctProvider, paintKeyedProviderOptions, acctMoveWorld };')();

const SUB = { provider: 'antigravity', providerName: 'Gemini', dir: null, authMode: 'antigravity', email: 'j@example.com',
  connection: { state: 'connected', badge: 'signed_in_unverified' } };
// An older board (or a hand-made row) naming it 'google' must be read the same way.
const SUB_AS_GOOGLE = { ...SUB, provider: 'google' };
const KEY = { provider: 'google', dir: '/h/.gemini-work1', connection: { state: 'connected' } };
function menu() {
  return { options: ['anthropic', 'openai', 'google', 'antigravity', 'xai'].map((value) => ({ value, disabled: true, dataset: {} })) };
}
const opt = (sel, v) => sel.options.find((o) => o.value === v);

test('#3998: the subscription row is its own provider, never a Gemini key and never Claude', () => {
  assert.equal(api.acctProvider(SUB), 'antigravity');
  assert.equal(api.acctProvider(SUB_AS_GOOGLE), 'antigravity');
  assert.equal(api.acctProvider(KEY), 'google', 'CONTROL: a key row is still a Gemini key');
});

test('#3998: with only the subscription connected, "Google Gemini (API key)" stays off in the create menu', () => {
  for (const row of [SUB, SUB_AS_GOOGLE]) {
    const sel = menu();
    api.paintKeyedProviderOptions(sel, [row], true, 'anthropic');
    assert.equal(opt(sel, 'google').disabled, true, 'the API-key option was turned on by a subscription with no key');
  }
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [SUB, KEY], true, 'anthropic');
  assert.equal(opt(sel, 'google').disabled, false, 'CONTROL: a real Gemini key turns it on');
});

test('#3998: the subscription row is no account to move an agent onto', () => {
  const rows = [SUB, SUB_AS_GOOGLE, KEY];
  const g = api.acctMoveWorld({ runner: 'gemini', account: { dir: '/h/.gemini-work1' } }, rows);
  assert.deepEqual(g.movable.map((x) => x.dir), ['/h/.gemini-work1'], 'a Gemini key agent was offered the subscription');
  const a = api.acctMoveWorld({ runner: 'antigravity', account: null }, rows);
  assert.deepEqual(a.movable, [], 'a subscription agent was offered an account to move to');
});

test('#3998: the row\'s Remove confirms like Disconnect: danger style, the heard name matches, leaving disarms', () => {
  const at = PAGE.indexOf("querySelectorAll('[data-agy-forget]')");
  assert.notEqual(at, -1);
  const src = PAGE.slice(at, PAGE.indexOf("querySelectorAll('[data-grok-reauth]')", at));
  assert.match(src, /classList\.toggle\('armed', on\)/);
  assert.match(src, /setAttribute\('aria-label', on \? 'Remove\? '/);
  assert.match(src, /addEventListener\('blur'/);
  assert.match(PAGE, /class="acct-reauth acct-remove" type="button" data-agy-forget="1"/, 'no .acct-remove, so .armed draws nothing');
});
