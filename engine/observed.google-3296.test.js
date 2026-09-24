'use strict';

/*
 * kosmos#3296 observability follow-on -- the GOOGLE (Gemini) provider added to the
 * observed enum must behave exactly like ANTHROPIC/OPENAI: the (provider, agent) join
 * stays injective, so a GOOGLE observation never crosses into a claude/openai slot and
 * vice-versa, and an unrecognised provider still cannot land. (The full saw/read/verdict
 * surface is covered provider-generically in observed.test.js; these pin GOOGLE.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const observed = require('./observed');

const { OK, REJECTED } = observed.OUTCOME;
const { ANTHROPIC, OPENAI, GOOGLE } = observed.PROVIDER;

test.beforeEach(() => observed._clearForTest());

test('GOOGLE is a recognised provider value', () => {
  assert.equal(GOOGLE, 'google', 'the GOOGLE enum member must be the string "google"');
  observed.saw(GOOGLE, 'gem', OK, 1000);
  assert.deepEqual(observed.read(GOOGLE, 'gem'), { outcome: OK, at: 1000 },
    'a GOOGLE observation did not land -- the closed-set guard is rejecting a value it should accept');
});

test('a GOOGLE observation never crosses into the claude or openai slot for the same agent name', () => {
  observed.saw(GOOGLE, 'sub', OK, 1000);
  observed.saw(OPENAI, 'sub', REJECTED, 2000);
  observed.saw(ANTHROPIC, 'sub', REJECTED, 3000);
  assert.deepEqual(observed.read(GOOGLE, 'sub'), { outcome: OK, at: 1000 }, 'the google slot was clobbered by another provider write');
  assert.deepEqual(observed.read(OPENAI, 'sub'), { outcome: REJECTED, at: 2000 });
  assert.deepEqual(observed.read(ANTHROPIC, 'sub'), { outcome: REJECTED, at: 3000 });
  const g = observed.all().filter((o) => o.provider === GOOGLE);
  assert.deepEqual(g, [{ provider: GOOGLE, agent: 'sub', outcome: OK, at: 1000 }],
    'exactly one GOOGLE row, tagged google, so the gemini overlay reads only its own');
});

test('a GOOGLE agent name with a space stays injective (no prefix collision with anthropic/openai/google)', () => {
  observed.saw(GOOGLE, 'Sonya Blade', OK, 1000);
  observed.saw(ANTHROPIC, 'Sonya Blade', REJECTED, 2000);
  assert.deepEqual(observed.read(GOOGLE, 'Sonya Blade'), { outcome: OK, at: 1000 });
  assert.deepEqual(observed.read(ANTHROPIC, 'Sonya Blade'), { outcome: REJECTED, at: 2000 });
});

test('an unrecognised provider still cannot land an observation', () => {
  observed.saw('gooooogle', 'gem', OK, 1000);
  assert.equal(observed.read('gooooogle', 'gem'), null, 'the closed-set guard let an unrecognised provider through');
  assert.equal(observed.all().length, 0, 'an unrecognised provider left a row in the store');
});
