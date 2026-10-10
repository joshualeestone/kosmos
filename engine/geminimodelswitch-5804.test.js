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

test('#5804: geminisession reports when the model-naming reply was written', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'geminisession.js'), 'utf8');
  assert.match(src, /const modelAt = model && Number\.isFinite\(parseTs\(lastGemini\)\) \? parseTs\(lastGemini\) : null;/);
  assert.match(src, /\n    model,\n    modelAt,\n  \};/);
});
