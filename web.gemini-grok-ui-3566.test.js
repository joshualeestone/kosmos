'use strict';

/**
 * #3566: Gemini and Grok are selectable in the UI.
 *
 * The engine could already create, switch and store keys for `google` and `xai`
 * (#3484, #3490, #3509), but every door on the page said "coming soon", so the
 * backend was unreachable from the product. These pin the three doors open and
 * EXECUTE the gate that decides when Gemini/Grok are offered, because a gate read
 * as text cannot tell "offered when connected" from "always offered" or "never".
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
function selectBody(id) {
  const m = PAGE.match(new RegExp('<select[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</select>'));
  assert.ok(m, '#' + id + ' is gone from the page');
  return m[1];
}
function optionTag(body, value) {
  const m = body.match(new RegExp('<option value="' + value + '"[^>]*>[^<]*</option>'));
  assert.ok(m, 'no ' + value + ' option');
  return m[0];
}

const routeAt = PAGE.indexOf('const ACCT_KEYED_ROUTE');
const ROUTE_SRC = PAGE.slice(routeAt, PAGE.indexOf('\n', routeAt));
// eslint-disable-next-line no-new-func
const api = new Function(ROUTE_SRC + '\n' + grab('function acctProvider(') + '\n'
  + grab('function acctOfferableTarget(') + '\n'
  + grab('function paintKeyedProviderOptions(') + '\n'
  + 'return { acctProvider, paintKeyedProviderOptions, ACCT_KEYED_ROUTE };')();

function menu() {
  const mk = (value) => ({ value, disabled: true, dataset: {} });
  return { options: ['anthropic', 'openai', 'google', 'xai', 'meta'].map(mk) };
}
const opt = (sel, v) => sel.options.find((o) => o.value === v);

test('#3566: Add a provider offers Gemini and Grok as LIVE options, the rest stay coming soon', () => {
  const body = selectBody('acct-provider-pick');
  for (const v of ['google', 'xai']) {
    const tag = optionTag(body, v);
    assert.doesNotMatch(tag, /\bdisabled\b/, v + ' is still disabled on Add a provider');
    assert.doesNotMatch(tag, /coming soon/i, v + ' still says coming soon on Add a provider');
  }
  assert.match(optionTag(body, 'meta'), /\bdisabled\b/, 'CONTROL: a genuinely coming-soon provider must stay disabled');
});

test('#3566: the create and switch menus no longer label Gemini/Grok coming soon', () => {
  for (const id of ['d-provider', 'create-provider']) {
    const body = selectBody(id);
    for (const v of ['google', 'xai']) {
      assert.doesNotMatch(optionTag(body, v), /coming soon/i, id + ' still labels ' + v + ' coming soon');
    }
  }
});

test('#3566: acctProvider maps every provider id, and unknown ids are Claude', () => {
  assert.equal(api.acctProvider({ provider: 'google' }), 'google');
  assert.equal(api.acctProvider({ provider: 'XAI' }), 'xai', 'case-insensitive, like the qualifier path');
  assert.equal(api.acctProvider({ provider: 'openai' }), 'openai');
  assert.equal(api.acctProvider({ provider: 'anthropic' }), 'anthropic');
  assert.equal(api.acctProvider({}), 'anthropic');
  assert.equal(api.acctProvider(null), 'anthropic');
  assert.deepEqual(api.ACCT_KEYED_ROUTE, { openai: 'openai', google: 'gemini', xai: 'grok' },
    'the route words must match the engine routes /api/accounts/{openai,gemini,grok}');
});

test('#3566: with the list read and no Gemini/Grok account, both are OFF and say where to connect', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [{ provider: 'anthropic', connection: { state: 'connected' } }], true, 'anthropic');
  for (const v of ['google', 'xai']) {
    assert.equal(opt(sel, v).disabled, true, v + ' is offered with no account to run it on');
    assert.equal(opt(sel, v).dataset.off, 'Connect in AI Models');
  }
});

test('#3566: a connected Gemini account turns Gemini ON, and only Gemini', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [{ provider: 'google', dir: '/h/.gemini-work1', connection: { state: 'connected' } }], true, 'anthropic');
  assert.equal(opt(sel, 'google').disabled, false, 'Gemini stays off with a connected Gemini account');
  assert.equal(opt(sel, 'google').dataset.off, undefined, 'an ON option must not carry an off reason');
  assert.equal(opt(sel, 'xai').disabled, true, 'a Gemini account must not turn Grok on');
  assert.equal(opt(sel, 'meta').disabled, true, 'CONTROL: the gate must not touch a coming-soon provider');
});

test('#3566: a Grok account the provider REJECTED does not turn Grok on', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [{ provider: 'xai', dir: '/h/.grok-work1', connection: { state: 'none' } }], true, 'anthropic');
  assert.equal(opt(sel, 'xai').disabled, true, 'a rejected key is offered as a place to run');
});

test('#3566: an UNKNOWN list leaves them on (the engine refuses a missing account with its own sentence)', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [], false, 'anthropic');
  assert.equal(opt(sel, 'google').disabled, false);
  assert.equal(opt(sel, 'xai').disabled, false);
});

test('#3566: the provider an agent is ON stays selectable so the menu can show it', () => {
  const sel = menu();
  api.paintKeyedProviderOptions(sel, [], true, 'xai');
  assert.equal(opt(sel, 'xai').disabled, false, 'a Grok agent could not show Grok as its current provider');
  assert.equal(opt(sel, 'google').disabled, true);
});

test('#3566: the first-run model step does not call Gemini or Grok coming soon, and says where they connect', () => {
  for (const name of ['Gemini', 'Grok']) {
    const m = PAGE.match(new RegExp('<b>' + name + '</b><small>[^<]*</small></div><span class="soon"[^>]*>([^<]*)</span>'));
    assert.ok(m, 'the first-run ' + name + ' row moved; re-anchor this test');
    assert.equal(m[1], 'After setup', 'the first-run ' + name + ' pill says ' + JSON.stringify(m[1]));
  }
  assert.match(PAGE, /id="fr-later-models"[^>]*>Gemini and Grok connect with an API key in Settings, AI Models/,
    'the first-run step no longer says where Gemini and Grok connect');
  const llama = PAGE.match(/<b>Llama<\/b><small>[^<]*<\/small><\/div><span class="soon"[^>]*>([^<]*)<\/span>/);
  assert.ok(llama && llama[1] === 'Coming soon', 'CONTROL: a genuinely unavailable provider must still say Coming soon');
});

test('#3566: the key step posts to the engine route for the picked provider, and sends no label', () => {
  const at = PAGE.indexOf("document.getElementById('acct-apikey-go').addEventListener('click'");
  assert.notEqual(at, -1, 'the Gemini/Grok Add handler is gone');
  const body = PAGE.slice(at, PAGE.indexOf('\n});', at));
  assert.match(body, /fetch\('\/api\/accounts\/' \+ p\.route \+ '\/apikey'/, 'the Add button no longer posts to the per-provider route');
  assert.match(body, /JSON\.stringify\(\{ key: key\.trim\(\), name: /, 'the body must carry the key and the display name');
  assert.doesNotMatch(body, /label:/, 'a label would be validated as a slug and refuse a person\'s words');
  assert.match(PAGE, /google: \{ route: 'gemini'/);
  assert.match(PAGE, /xai: \{ route: 'grok'/);
});
