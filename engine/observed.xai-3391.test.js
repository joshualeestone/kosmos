'use strict';

/*
 * kosmos#3391 observability follow-on -- the XAI (Grok) provider added to the observed enum
 * must behave exactly like ANTHROPIC/OPENAI/GOOGLE: the (provider, agent) join stays injective,
 * so an XAI observation never crosses into another provider's slot and vice-versa, and an
 * unrecognised provider still cannot land. (The full saw/read/verdict surface is covered
 * provider-generically in observed.test.js; these pin XAI.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const observed = require('./observed');

const { OK, REJECTED } = observed.OUTCOME;
const { ANTHROPIC, OPENAI, GOOGLE, XAI } = observed.PROVIDER;

test.beforeEach(() => observed._clearForTest());

test('XAI is a recognised provider value', () => {
  assert.equal(XAI, 'xai', 'the XAI enum member must be the string "xai"');
  observed.saw(XAI, 'grk', OK, 1000);
  assert.deepEqual(observed.read(XAI, 'grk'), { outcome: OK, at: 1000 },
    'an XAI observation did not land -- the closed-set guard is rejecting a value it should accept');
});

test('an XAI observation never crosses into another provider slot for the same agent name', () => {
  observed.saw(XAI, 'sub', OK, 1000);
  observed.saw(GOOGLE, 'sub', REJECTED, 2000);
  observed.saw(OPENAI, 'sub', REJECTED, 3000);
  observed.saw(ANTHROPIC, 'sub', REJECTED, 4000);
  assert.deepEqual(observed.read(XAI, 'sub'), { outcome: OK, at: 1000 }, 'the xai slot was clobbered by another provider write');
  assert.deepEqual(observed.read(GOOGLE, 'sub'), { outcome: REJECTED, at: 2000 });
  assert.deepEqual(observed.read(OPENAI, 'sub'), { outcome: REJECTED, at: 3000 });
  assert.deepEqual(observed.read(ANTHROPIC, 'sub'), { outcome: REJECTED, at: 4000 });
  const x = observed.all().filter((o) => o.provider === XAI);
  assert.deepEqual(x, [{ provider: XAI, agent: 'sub', outcome: OK, at: 1000 }],
    'exactly one XAI row, tagged xai, so the grok overlay reads only its own');
});

test('an XAI agent name with a space stays injective (no prefix collision with the other providers)', () => {
  observed.saw(XAI, 'Sonya Blade', OK, 1000);
  observed.saw(ANTHROPIC, 'Sonya Blade', REJECTED, 2000);
  assert.deepEqual(observed.read(XAI, 'Sonya Blade'), { outcome: OK, at: 1000 });
  assert.deepEqual(observed.read(ANTHROPIC, 'Sonya Blade'), { outcome: REJECTED, at: 2000 });
});

test('an unrecognised provider still cannot land an observation', () => {
  observed.saw('xaiii', 'grk', OK, 1000);
  assert.equal(observed.read('xaiii', 'grk'), null, 'the closed-set guard let an unrecognised provider through');
  assert.equal(observed.all().length, 0, 'an unrecognised provider left a row in the store');
});
