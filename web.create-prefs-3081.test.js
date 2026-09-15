'use strict';

/**
 * #3081: the create-agent flow remembers the last-selected provider / account / model
 * (per machine, in localStorage) and pre-fills them on the next create -- as a DEFAULT the
 * operator can still change, and ONLY while each saved value is still usable.
 *
 * These EXTRACT and RUN the four persistence/validity helpers from the page against stubs,
 * so the controls can return the dangerous answer WITHOUT a browser: a saved model that has
 * since been retired, a saved account that is no longer offered, and a blocked-storage
 * (private window) read. The cascade wiring in loadCreateExtras is covered by the browser
 * check; this pins the logic those helpers own.
 *
 *   node --test web.create-prefs-3081.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* Same slice discipline as web.acct-picker-1917.test.js: from the signature to the first
   column-0 `\n}` (the function's own close; inner braces are indented). */
function grab(sig) {
  const at = PAGE.indexOf(sig);
  assert.notEqual(at, -1, sig + ' is gone from the page');
  return PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
}
const KEYS_SRC = (() => {
  const at = PAGE.indexOf('const CREATE_PREF_KEYS');
  assert.notEqual(at, -1, 'CREATE_PREF_KEYS is gone from the page');
  return PAGE.slice(at, PAGE.indexOf(';', at) + 1);
})();
const READ_SRC = grab('function readCreatePrefs(');
const SAVE_SRC = grab('function saveCreatePrefs(');
const ACCT_SRC = grab('function applyCreateAccountPref(');
const MODEL_SRC = grab('function applyCreateModelPref(');

// A localStorage stub backed by a Map, or one that throws on every access (private window /
// blocked site data) so the try/catch arms are exercised, not just described.
function makeStorage(throwing) {
  const m = new Map();
  return {
    map: m,
    getItem: (k) => { if (throwing) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (throwing) throw new Error('blocked'); m.set(k, String(v)); },
  };
}

// Build a scope with the four helpers + the stubs each needs.
function scope({ storage, document, createModels }) {
  const factory = new Function('localStorage', 'document', 'CREATE_MODELS', 'paintModelWhy', `
    ${KEYS_SRC}
    ${READ_SRC}
    ${SAVE_SRC}
    ${ACCT_SRC}
    ${MODEL_SRC}
    return { readCreatePrefs, saveCreatePrefs, applyCreateAccountPref, applyCreateModelPref };
  `);
  return factory(storage, document || null, createModels || [], () => {});
}

test('#3081: save then read is a faithful round-trip of all three values', () => {
  const storage = makeStorage(false);
  const s = scope({ storage });
  s.saveCreatePrefs('openai', '/h/.codex-work', 'gpt-x');
  assert.deepEqual(s.readCreatePrefs(), { provider: 'openai', account: '/h/.codex-work', model: 'gpt-x' });
  // The keys are the documented, namespaced ones (a rename would silently orphan saved prefs).
  assert.equal(storage.map.get('kosmos.create.provider'), 'openai');
  assert.equal(storage.map.get('kosmos.create.account'), '/h/.codex-work');
  assert.equal(storage.map.get('kosmos.create.model'), 'gpt-x');
});

test('#3081: an unset store reads as all-empty (never undefined), so nothing is applied', () => {
  const s = scope({ storage: makeStorage(false) });
  assert.deepEqual(s.readCreatePrefs(), { provider: '', account: '', model: '' });
});

test('#3081: empty selections persist as empty and never crash (single-account row hidden, OpenAI auto model)', () => {
  const storage = makeStorage(false);
  const s = scope({ storage });
  s.saveCreatePrefs('anthropic', '', '');
  assert.deepEqual(s.readCreatePrefs(), { provider: 'anthropic', account: '', model: '' });
});

test('#3081 control: blocked storage (private window) neither throws nor invents a value', () => {
  const s = scope({ storage: makeStorage(true) });
  // read fails soft to all-empty; save swallows -- either throwing would break the create form.
  assert.deepEqual(s.readCreatePrefs(), { provider: '', account: '', model: '' });
  assert.doesNotThrow(() => s.saveCreatePrefs('openai', '/a', 'm'));
});

test('#3081: applyCreateAccountPref selects a saved account ONLY when it is an offered option', () => {
  const sel = { value: '/h/.claude', options: [{ value: '/h/.claude' }, { value: '/h/.claude-work1' }] };
  const document = { getElementById: (id) => id === 'create-account' ? sel : null };
  const s = scope({ storage: makeStorage(false), document });
  s.applyCreateAccountPref('/h/.claude-work1');
  assert.equal(sel.value, '/h/.claude-work1', 'a saved account that is offered should be selected');
});

test('#3081 control: a saved account no longer offered leaves the server-marked default in place', () => {
  const sel = { value: '/h/.claude', options: [{ value: '/h/.claude' }] };  // the saved dir was removed
  const document = { getElementById: (id) => id === 'create-account' ? sel : null };
  const s = scope({ storage: makeStorage(false), document });
  s.applyCreateAccountPref('/h/.claude-removed');
  assert.equal(sel.value, '/h/.claude', 'a stale account must NOT be selected (would be an option that always fails)');
});

test('#3081: applyCreateModelPref selects a saved model ONLY when still in the engine list', () => {
  const sel = { value: 'claude-default', options: [] };
  const document = { getElementById: (id) => id === 'create-model' ? sel : null };
  const models = [{ key: 'claude-default' }, { key: 'claude-opus-5' }];
  const s = scope({ storage: makeStorage(false), document, createModels: models });
  s.applyCreateModelPref('claude-opus-5');
  assert.equal(sel.value, 'claude-opus-5');
});

test('#3081 control: a RETIRED saved model is not applied (falls back to the default)', () => {
  const sel = { value: 'claude-default', options: [] };
  const document = { getElementById: (id) => id === 'create-model' ? sel : null };
  const models = [{ key: 'claude-default' }, { key: 'claude-opus-5' }];  // the saved model is gone from the list
  const s = scope({ storage: makeStorage(false), document, createModels: models });
  s.applyCreateModelPref('claude-retired-4');
  assert.equal(sel.value, 'claude-default', 'a retired model must not be re-selected');
});

test('#3081 control: an empty saved model is a no-op (OpenAI "let it choose" stays)', () => {
  const sel = { value: '', options: [] };
  const document = { getElementById: (id) => id === 'create-model' ? sel : null };
  const s = scope({ storage: makeStorage(false), document, createModels: [{ key: 'x' }] });
  s.applyCreateModelPref('');
  assert.equal(sel.value, '', 'empty want should leave the select untouched');
});

/* The four helpers above are unit-tested in isolation; these last two pin the WIRING
   in the page that calls them -- the one part the browser check would otherwise own.
   Source-pattern assertions (the web.create-account.test.js style), because
   loadCreateExtras is a large async function with many collaborators that is not worth
   eval-executing whole; a regression that drops the restore or the save reds a node test
   rather than only surfacing in a live browser. */
test('#3081 wiring: loadCreateExtras restores the saved provider/account/model', () => {
  const start = PAGE.indexOf('async function loadCreateExtras');
  assert.ok(start >= 0, 'loadCreateExtras moved or was renamed; restate this pin');
  const fn = PAGE.slice(start, PAGE.indexOf('\n  /* 🛑 THE PROJECTS PICKER IS GONE', start));
  assert.ok(fn.length > 0, 'could not slice loadCreateExtras up to the projects-picker marker; re-anchor');
  assert.match(fn, /const pref = readCreatePrefs\(\);/, 'the restore no longer reads the saved prefs');
  assert.match(fn, /applyCreateAccountPref\(pref\.account\)/, 'the restore no longer applies the saved account');
  // The account is applied BEFORE the model (applyCreateProviderUI resets the account to
  // isDefault, so the account must be re-set first); pin that order.
  assert.ok(
    fn.indexOf('applyCreateAccountPref(pref.account)') < fn.indexOf('CREATE_PREF_OPENAI_MODEL = pref.model'),
    'the saved account must be applied before the OpenAI model one-shot is armed',
  );
  // OpenAI's model rides the async one-shot (armed, then a single repaint for the chosen
  // account); Claude's model is applied synchronously. Both branches must be present.
  assert.match(fn, /CREATE_PREF_OPENAI_MODEL = pref\.model[^;]*;\s*\n\s*paintOpenaiCreateModel\(\);/,
    'the OpenAI branch no longer arms the saved-model one-shot before a single repaint');
  assert.match(fn, /applyCreateModelPref\(pref\.model\)/, 'the Claude branch no longer applies the saved model');
  // The restore only fires while the provider is still usable and the operator has not
  // touched the form (the #2097 auto-default gate); pin that guard so it cannot become a lock.
  assert.match(fn, /prefProviderUsable/, 'the restore is no longer gated on the saved provider being usable');
});

test('#3081 wiring: a saved default is written ONLY on a successful create', () => {
  const start = PAGE.indexOf("document.getElementById('create-go').addEventListener");
  assert.ok(start >= 0, 'the create-go click handler moved or was renamed; restate this pin');
  const handler = PAGE.slice(start, PAGE.indexOf("\n});", start) + 4);
  assert.ok(handler.length > 0, 'could not slice the create-go handler; re-anchor');
  // The save must sit inside an `outcome === 'created'` guard -- a 'partial' rolls back, so
  // it must not become the remembered choice.
  assert.match(handler, /if \(result\.outcome === 'created'\) \{[\s\S]*?saveCreatePrefs\(/,
    "saveCreatePrefs is no longer guarded by outcome === 'created' (a rolled-back partial must not be remembered)");
});
