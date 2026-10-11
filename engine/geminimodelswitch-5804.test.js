'use strict';
/* #5804: when a running Gemini agent's card says "(set to X)". Pure: every read is injected. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { settingModelName } = require('./geminimodelswitch');

const display = (id) => ({ 'gemini-2.5-flash': 'Gemini 2.5 Flash', 'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-2.5-pro': 'Gemini 2.5 Pro', auto: 'Auto', flash: 'Flash' }[id] || id);
const START = Date.parse('2026-10-10T19:00:00Z');
const deps = (o) => Object.assign({
  planned: () => ({ id: 'gemini-2.5-flash', isDefault: false }),
  session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: START + 60000 }),
  startedAt: () => START,
  display,
}, o);

test('#5804: a reply from another model in this run names the model the agent is set to', () => {
  assert.equal(settingModelName('a', deps()), 'Gemini 2.5 Flash');
  // The launcher's default is its setting too (the reported case may be: no model chosen, -m from the launcher).
  assert.equal(settingModelName('a', deps({ planned: () => ({ id: 'gemini-2.5-flash', isDefault: true }) })), 'Gemini 2.5 Flash');
});

test('#5804: nothing to say for the same model, an alias, a reply from before this run, or anything unread', () => {
  assert.equal(settingModelName('a', deps({ session: () => ({ found: true, model: 'gemini-2.5-flash', modelAt: START + 1500 }) })), null, 'same model');
  assert.equal(settingModelName('a', deps({ planned: () => ({ id: 'auto', isDefault: false }) })), null, 'auto picks by design');
  assert.equal(settingModelName('a', deps({ planned: () => ({ id: 'flash', isDefault: false }) })), null, 'an alias');
  assert.equal(settingModelName('a', deps({ planned: () => ({ id: 'auto-gemini-2.5', isDefault: false }) })), null, 'an auto-routing alias with a version');
  assert.equal(settingModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: START - 1 }) })), null,
    'a reply from before a model change and restart is not this run');
  assert.equal(settingModelName('a', deps({ startedAt: () => null })), null, 'run start unknown');
  assert.equal(settingModelName('a', deps({ session: () => ({ found: false }) })), null, 'no session');
  assert.equal(settingModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: null }) })), null, 'reply time unknown');
  assert.equal(settingModelName('a', deps({ planned: () => null })), null, 'no job');
  assert.equal(settingModelName('a', deps({ planned: () => { throw new Error('x'); } })), null, 'a read that throws');
  // Review 4: tmux's start is whole seconds, so a reply in the same second may predate it: not said.
  assert.equal(settingModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: START + 999 }) })), null, 'the start second');
  // CONTROL: the same deps with a reply a second into this run DO speak, so the nulls above are each one condition.
  assert.equal(settingModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: START + 1000 }) })), 'Gemini 2.5 Flash');
});

test('#5804 review 3: the same model spelled with a revision, -latest or -preview is not a switch', () => {
  for (const spelled of ['gemini-2.5-flash-001', 'gemini-2.5-flash-latest', 'gemini-2.5-flash-preview-09-2025', 'Gemini-2.5-Flash',
    'gemini-2.5-flash-high', 'gemini-2.5-flash-09-2025', 'gemini-2.5-flash-exp']) {
    assert.equal(settingModelName('a', deps({ session: () => ({ found: true, model: spelled, modelAt: START + 1500 }) })), null, spelled);
  }
  // CONTROL: a different model is still said.
  assert.equal(settingModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash-001', modelAt: START + 1500 }) })), 'Gemini 2.5 Flash');
});

test('#5804 review 7: the real wiring names functions that exist (a rename would otherwise turn the note off silently)', () => {
  const status = require('./status');
  const create = require('./create');
  for (const f of ['readGeminiSession', 'sessionStartedAtFromTmux', 'modelDisplayName']) assert.equal(typeof status[f], 'function', 'status.' + f);
  assert.equal(typeof create.plannedModelOf, 'function', 'create.plannedModelOf');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'geminimodelswitch.js'), 'utf8');
  for (const call of ['create().plannedModelOf(name)', 'status().readGeminiSession(name)', 'status().sessionStartedAtFromTmux(name)', 'status().modelDisplayName(id)']) {   // #5811: required lazily
    assert.ok(src.includes(call), 'realDeps no longer calls ' + call);
  }
});

test('#5804 review 6: every same-model suffix status.js GEMINI_WINDOWS knows is one canonicalId strips (the copies stay in step)', () => {
  const { canonicalId } = require('./geminimodelswitch');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'status.js'), 'utf8');
  const m = /\(-\((preview\|latest[^)]*)\)\)\*\$/.exec(src);
  assert.ok(m, 'CONTROL: the GEMINI_WINDOWS suffix alternation was found');
  const samples = { '\\d{3}': '001', '\\d{2}-\\d{2}': '09-25', '\\d{2}-\\d{4}': '09-2025' };
  for (const tok of m[1].split('|')) {
    const word = Object.prototype.hasOwnProperty.call(samples, tok) ? samples[tok] : tok;
    assert.equal(canonicalId('gemini-2.5-flash-' + word), 'gemini-2.5-flash', 'status.js treats -' + word + ' as the same model; canonicalId does not');
  }
});
