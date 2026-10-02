'use strict';
/**
 * kosmos#4935: Create a Team sends ONE model for every member (Josh: "default all of them to a single model").
 * tcModel reads #tc-model beside the provider and account, sends it only when it has a value (an empty value is
 * "the vendor picks" or "not chosen yet", and create then uses its default), and once a member exists keeps the
 * model it was made on. tcSyncModel repaints the list only when the provider or account changed, so a person's
 * pick survives the 2 s repaints. Lifted from the shipped page and run against a fake document.
 *
 *   node --test web.teammodel-4935.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));

function lift(name) {
  const start = SCRIPT.indexOf('function ' + name + '(');
  const end = SCRIPT.indexOf('\n}\n', start) + 3;
  assert.ok(start > 0 && end > start, name + ' moved');
  return SCRIPT.slice(start, end);
}

function modelWorld(els, tc) {
  const ctx = { document: { getElementById: (id) => els[id] || null } };
  vm.runInNewContext('let TC = null;\nfunction tcMemberExists() { return Boolean(TC && TC.made); }\n' + lift('tcModel')
    + '\nthis.model = (t) => { TC = t; return tcModel(); };', ctx);
  return (t) => JSON.parse(JSON.stringify(ctx.model(t === undefined ? tc : t)));   // out of the vm realm
}

test('#4935 the chosen model rides with the provider and account', () => {
  const m = modelWorld({ 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '/acct/c' }, 'tc-model': { value: 'opus' } });
  assert.deepEqual(m({}), { provider: 'anthropic', account: '/acct/c', model: 'opus' });
});

test('#4935 an empty model (the vendor picks, or not chosen) sends no model key', () => {
  const m = modelWorld({ 'tc-provider': { value: 'google' }, 'tc-account': { value: '' }, 'tc-model': { value: '' } });
  assert.deepEqual(m({}), { provider: 'google' });
  // CONTROL: the same world with a value does carry it, so the absence above is the empty value's doing.
  const c = modelWorld({ 'tc-provider': { value: 'google' }, 'tc-account': { value: '' }, 'tc-model': { value: 'x' } });
  assert.deepEqual(c({}), { provider: 'google', model: 'x' });
});

test('#4935 once a member exists, the model it was made on is kept even if the menu changed', () => {
  const els = { 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '' }, 'tc-model': { value: 'opus' } };
  const m = modelWorld(els);
  const tc = {};
  assert.deepEqual(m(tc), { provider: 'anthropic', model: 'opus' });
  tc.made = true;
  els['tc-model'].value = 'haiku';
  assert.deepEqual(m(tc), { provider: 'anthropic', model: 'opus' });
});

test('#4935 tcSyncModel repaints only on a provider or account change, and never once the choice is fixed', () => {
  const sel = { value: 'opus', disabled: false, dataset: {} };
  const els = { 'tc-provider': { value: 'anthropic' }, 'tc-account': { value: '/a' }, 'tc-model': sel };
  const painted = [];
  let fixed = false;
  const ctx = {
    document: { getElementById: (id) => els[id] || null },
    tcChoiceFixed: () => fixed, TC_FILLING: 0,
    tcPaintModel: (pv, ac) => { painted.push(pv + '|' + ac); },
  };
  vm.runInNewContext('let TC_MODEL_FOR = null;\n' + lift('tcSyncModel') + '\nthis.sync = tcSyncModel;', ctx);
  ctx.sync(); ctx.sync(); ctx.sync();
  assert.deepEqual(painted, ['anthropic|/a'], 'the 2 s repaints must not rebuild the list');
  els['tc-account'].value = '/b'; ctx.sync();
  assert.deepEqual(painted, ['anthropic|/a', 'anthropic|/b']);
  assert.equal(sel.disabled, false);
  fixed = true; els['tc-provider'].value = 'openai'; ctx.sync();
  assert.equal(painted.length, 2, 'a fixed choice is not repainted');
  assert.equal(sel.disabled, true, 'and the menu is locked with the provider and account (item 8)');
});
