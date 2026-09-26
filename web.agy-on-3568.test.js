'use strict';
/**
 * #3568: Gemini on a Google subscription (value 'antigravity', Google's Antigravity CLI) on the page.
 * The option is gated on agy being installed (not on an account: it signs in inside the agent's own
 * window), it is named as Gemini by subscription wherever a person picked it, and choosing it never
 * sends a Claude account or a Claude model.
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

test('#3568: the create and switch menus offer Gemini on a Google subscription, right after Gemini, off until checked', () => {
  for (const id of ['d-provider', 'create-provider']) {
    const body = selectBody(id);
    const agy = body.match(/<option value="antigravity"[^>]*>([^<]*)<\/option>/);
    assert.ok(agy, id + ' has no Gemini-by-subscription option');
    assert.match(agy[1], /Gemini \(Google subscription\)/);
    assert.match(agy[0], /\bdisabled\b/, 'it must start off until agy is checked');
    assert.ok(body.indexOf('value="google"') < body.indexOf('value="antigravity"'), 'it should sit after Gemini');
  }
  // CONTROL: Add a provider keeps Gemini's key path and does not list antigravity (its sign-in is the Gemini row's).
  assert.doesNotMatch(selectBody('acct-provider-pick'), /value="antigravity"/);
});

// eslint-disable-next-line no-new-func
const agy = new Function('document', 'fetch', 'CURRENT', `
  let AGY_INSTALLED = null; let AGY_ASKING = null;
  ${grab('function paintAgyOption(')}
  const set = (v) => { AGY_INSTALLED = v; };
  return { paintAgyOption, set };
`);

function menu() {
  const opts = ['anthropic', 'google', 'antigravity'].map((value) => ({ value, disabled: true, dataset: {} }));
  return { options: opts, opt: (v) => opts.find((o) => o.value === v) };
}

test('#3568: the option turns on only when agy is installed, and says why when it is off', () => {
  const api = agy(null, null, null);
  const m = menu();
  api.paintAgyOption(m, '');
  assert.equal(m.opt('antigravity').disabled, true, 'unknown must stay off');
  assert.equal(m.opt('antigravity').dataset.off, 'Checking Antigravity');
  api.set(false);
  api.paintAgyOption(m, '');
  assert.equal(m.opt('antigravity').disabled, true);
  assert.equal(m.opt('antigravity').dataset.off, 'Set up in AI Models');
  api.set(true);
  api.paintAgyOption(m, '');
  assert.equal(m.opt('antigravity').disabled, false, 'installed must turn it on');
  assert.equal(m.opt('antigravity').dataset.off, undefined);
  // The provider an agent is ON stays selectable so the menu can show it, installed or not.
  api.set(false);
  api.paintAgyOption(m, 'antigravity');
  assert.equal(m.opt('antigravity').disabled, false);
  // CONTROL: it touches only its own option.
  assert.equal(m.opt('google').disabled, true);
});

test('#3568: an Antigravity agent is on antigravity, and the switch words name Gemini by subscription', () => {
  const at = PAGE.indexOf('const providerOf = (a) =>');
  const end = PAGE.indexOf("'anthropic');", at);
  assert.ok(end > at && end - at < 400, 'providerOf moved or changed shape; re-anchor');
  const src = PAGE.slice(at, end + "'anthropic');".length);
  // eslint-disable-next-line no-new-func
  const f = new Function(src + '\n' + grab('function switchKeyedWord(') + '\nreturn { providerOf, switchKeyedWord };')();
  assert.equal(f.providerOf({ runner: 'antigravity' }), 'antigravity');
  assert.equal(f.providerOf({ runner: 'claude' }), 'anthropic', 'CONTROL');
  assert.equal(f.switchKeyedWord('antigravity'), 'Gemini (Google subscription)');
  assert.equal(f.switchKeyedWord('google'), 'Gemini', 'CONTROL');
});

test('#3568: creating on Gemini by subscription sends no account: the account row is emptied and hidden', () => {
  const asel = { innerHTML: '<option value="/h/.claude">me@x</option>', value: '/h/.claude' };
  const arow = { hidden: false };
  const provSel = { value: 'antigravity', options: [] };
  const document = { getElementById: (id) => (id === 'create-account' ? asel : id === 'create-account-row' ? arow : id === 'create-provider' ? provSel : null) };
  let claudeListed = false;
  // eslint-disable-next-line no-new-func
  const fill = new Function('document', 'CREATE_ACCOUNTS', 'CREATE_ACCOUNTS_KNOWN', 'CREATE_ACCOUNTS_FAILED', `
    function paintKeyedProviderOptions() {} function paintAgyOption() {} function agyAsk() {}
    function acctProvider() { return 'anthropic'; }
    ${grab('function fillCreateAccounts(')}
    return fillCreateAccounts;
  `)(document, new Proxy([], { get(t, k) { if (k === 'filter') claudeListed = true; return t[k]; } }), true, false);
  fill();
  assert.equal(asel.value, '', 'a Claude account would be sent for an Antigravity agent');
  assert.equal(arow.hidden, true);
  assert.equal(claudeListed, false, 'it must not even list Claude accounts');
});

test('#3568: the switch dialog and the "reactivate" sentence name Gemini by subscription, never Anthropic or Claude', () => {
  assert.match(PAGE, /const toAgy = sel\.value === 'antigravity';/);
  assert.match(PAGE, /const label = toOpenai \? 'OpenAI' : \(toOther \|\| toAgy\) \? switchKeyedWord\(sel\.value\) : 'Anthropic';/);
  assert.match(PAGE, /: toAgy\s*\n\s*\? 'Its ' \+ fromWord \+ ' model and account choices do not cross: Gemini picks its own model, and it signs in with your Google subscription in its own window\.'/);
});
