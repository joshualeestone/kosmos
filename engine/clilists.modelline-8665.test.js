'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8665: `kosmos agent list` names each agent's model in the words of its card. engine/clilists.js carries its own
 * copy of the card's model line (the CLIs carry that file alone), so this runs the PAGE's own tileModelLine, modelLine
 * and cardStOf (with the real CARD_ST table) on the same cards and asserts the same words, card by card. A change to
 * either side that the other does not make goes red here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scriptOf, liftAll } = require('../test-support/page');
const clilists = require('./clilists');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));

/* The card table and cardStOf, as one slice: from `const CARD_ST = {` to the end of cardStOf's line. */
function pageModelWords() {
  const from = SCRIPT.indexOf('const CARD_ST = {');
  const fn = SCRIPT.indexOf('function cardStOf(a)', from);
  assert.ok(from > 0 && fn > from, 'the page no longer has CARD_ST then cardStOf; this test lifts nothing');
  const table = SCRIPT.slice(from, SCRIPT.indexOf('\n', fn));
  const src = liftAll(SCRIPT, ['modelLine', 'tileModelLine']);
  return new Function(table + '\n' + src + '\nreturn { tileModelLine, states: Object.keys(CARD_ST) };')();
}

/* Review 5: every state the page's CARD_ST knows, read from the page, plus one it does not, so a new state (a second
   presence that is off, say) is in the matrix the day it is added. */
const STATES = pageModelWords().states.concat(['a_state_the_page_does_not_know']);
const MODELS = [
  {}, { modelName: 'Sonnet 5' }, { modelName: 'Claude Opus 5.5' }, { plannedModelName: 'Claude Haiku 4.5' },
  { modelName: 'Claude Opus 5', plannedModelName: 'Claude Haiku 4.5' }, { neverRecorded: true }, { neverRecorded: false },
  { earlierModelName: 'Opus 4.8' }, { earlierModelName: 'Claude Opus 4.8', neverRecorded: true },
  { earlierModelName: 'Opus 4.8', modelName: 'Sonnet 5' },
];
const RUNNERS = [
  {}, { runner: 'claude' }, { runner: 'codex' }, { runner: 'codex', modelName: 'o3' }, { runner: 'codex', modelName: 'GPT 5.6 Sol' },
  { runner: 'codex', account: { provider: 'alibaba' } }, { runner: 'codex', account: { provider: 'alibaba' }, modelName: 'qwen3-coder' },
  { runner: 'codex', account: { provider: 'alibaba' }, modelName: 'coder-30b' },
  { account: { provider: 'deepseek' } }, { account: { provider: 'deepseek' }, modelName: 'v4' },
  { account: { provider: 'glm' }, modelName: '4.6' }, { account: { provider: 'minimax' } },
  { runner: 'gemini' }, { runner: 'gemini', modelName: 'Gemini 3.8 Flash', settingModelName: 'Gemini 3.8 Pro' },
  { runner: 'grok' }, { runner: 'grok', modelName: 'Grok 4.6' }, { runner: 'antigravity' }, { runner: 'muse' },
];
const EXTRAS = [{}, { disruption: { failed: true } }, { crashLoop: { looping: true } }, { deliveryStall: { since: 'x' } },
  { reconnect: { phase: 'gave_up' } }, { stateReportedBy: 'agent' }, { isNamedOurs: true }, { isNamedOurs: false }];

test('the list names every card\'s model in the card\'s own words', () => {
  const page = pageModelWords().tileModelLine;
  let n = 0; const seen = new Set();
  for (const state of STATES) for (const m of MODELS) for (const r of RUNNERS) for (const x of EXTRAS) {
    const card = { name: 'Ada', state, ...m, ...r, ...x };
    const want = page(card);
    assert.equal(clilists.modelWordsOf(card), want, 'differs from the card for ' + JSON.stringify(card));
    seen.add(want); n += 1;
  }
  // The matrix reaches the branches it is meant to: the job's model for a stopped agent and the live one otherwise.
  for (const w of ['Claude Haiku 4.5', 'Claude Opus 5', 'Made before Kosmos recorded this', 'No model recorded: set it in AI Settings', 'No model recorded', 'Claude Opus 4.8',
    'OpenAI o3', 'Qwen', 'Qwen coder-30b', 'DeepSeek v4', 'Z.ai GLM 4.6', 'Gemini 3.8 Flash (set to Gemini 3.8 Pro)', 'Meta Muse']) {
    assert.ok(seen.has(w), 'no card in the matrix reads ' + w);
  }
  assert.ok(STATES.length >= 11 && n > 10000, 'the matrix shrank to ' + n + ' cards over ' + STATES.length + ' states');
});

test('a stopped agent and a restart that did not come back name the job\'s model; a running one names its own', () => {
  const both = { modelName: 'Claude Opus 5', plannedModelName: 'Claude Haiku 4.5' };
  assert.equal(clilists.modelWordsOf({ state: 'stopped', ...both }), 'Claude Haiku 4.5');
  assert.equal(clilists.modelWordsOf({ state: 'needs_you', disruption: { failed: true }, ...both }), 'Claude Haiku 4.5');
  assert.equal(clilists.modelWordsOf({ state: 'idle', ...both }), 'Claude Opus 5');
  assert.equal(clilists.modelWordsOf({ state: 'stopped', crashLoop: { looping: true }, ...both }), 'Claude Haiku 4.5');
});

test('the list prints the model after the state, on the same line, and a row with none prints as before', () => {
  const row = clilists.rosterRow({ name: 'Ada', role: 'Researcher', cardWord: 'Idle', state: 'idle', modelName: 'Sonnet 5' }, null);
  assert.equal(row.model, 'Claude Sonnet 5');
  assert.deepEqual(clilists.agentLines([row]).lines, ['Ada  Researcher  Idle  Claude Sonnet 5']);
  assert.deepEqual(clilists.agentLines([{ name: 'Bo', role: 'R', state: 'Idle' }]).lines, ['Bo  R  Idle'], 'an older board sends no model');
  assert.deepEqual(clilists.agentLines([{ name: 'Cy', role: 'R', state: 'Idle', model: 'Claude\nOpus' }]).lines, ['Cy  R  Idle  Claude Opus'],
    'a line break in a model name split the row');
  const never = clilists.rosterRow({ name: 'Di', cardWord: 'Idle', state: 'idle', neverRecorded: true }, null);
  assert.deepEqual(clilists.agentLines([never]).lines, ['Di  no role recorded  Idle  Made before Kosmos recorded this']);
});
