'use strict';
/* #5804: when a running Gemini agent's card says "(started on X)". Pure: every read is injected. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startedModelName } = require('./geminimodelswitch');

const display = (id) => ({ 'gemini-2.5-flash': 'Gemini 2.5 Flash', 'gemini-3.5-flash': 'Gemini 3.5 Flash', 'gemini-2.5-pro': 'Gemini 2.5 Pro', auto: 'Auto', flash: 'Flash' }[id] || id);
const START = Date.parse('2026-10-10T19:00:00Z');
const deps = (o) => Object.assign({
  planned: () => ({ id: 'gemini-2.5-flash', isDefault: false }),
  session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: START + 60000 }),
  startedAt: () => START,
  display,
}, o);

test('#5804: a reply from another model in this run names the model it was started on', () => {
  assert.equal(startedModelName('a', deps()), 'Gemini 2.5 Flash');
  // The launcher's default is what it was started on too (the reported case: no model chosen, -m from the launcher).
  assert.equal(startedModelName('a', deps({ planned: () => ({ id: 'gemini-2.5-flash', isDefault: true }) })), 'Gemini 2.5 Flash');
});

test('#5804: nothing to say for the same model, an alias, a reply from before this run, or anything unread', () => {
  assert.equal(startedModelName('a', deps({ session: () => ({ found: true, model: 'gemini-2.5-flash', modelAt: START + 1 }) })), null, 'same model');
  assert.equal(startedModelName('a', deps({ planned: () => ({ id: 'auto', isDefault: false }) })), null, 'auto picks by design');
  assert.equal(startedModelName('a', deps({ planned: () => ({ id: 'flash', isDefault: false }) })), null, 'an alias');
  assert.equal(startedModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: START - 1 }) })), null,
    'a reply from before a model change and restart is not this run');
  assert.equal(startedModelName('a', deps({ startedAt: () => null })), null, 'run start unknown');
  assert.equal(startedModelName('a', deps({ session: () => ({ found: false }) })), null, 'no session');
  assert.equal(startedModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: null }) })), null, 'reply time unknown');
  assert.equal(startedModelName('a', deps({ planned: () => null })), null, 'no job');
  assert.equal(startedModelName('a', deps({ planned: () => { throw new Error('x'); } })), null, 'a read that throws');
  // CONTROL: the same deps with a reply from this run DO speak, so the nulls above are each one condition.
  assert.equal(startedModelName('a', deps({ session: () => ({ found: true, model: 'gemini-3.5-flash', modelAt: START }) })), 'Gemini 2.5 Flash');
});

test('#5804: geminisession reports when the model-naming reply was written', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'geminisession.js'), 'utf8');
  assert.match(src, /const modelAt = model && Number\.isFinite\(parseTs\(lastGemini\)\) \? parseTs\(lastGemini\) : null;/);
  assert.match(src, /\n    model,\n    modelAt,\n  \};/);
});
