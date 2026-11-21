'use strict';
/**
 * kosmos#8841: offByEnv says whether the start environment itself switched the usage poll or the mover off, as against
 * the default reading off (one login, a test, a dry run). Settings names only the first.
 *
 *   node --test engine/usagepoll-offbyenv-8841.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { offByEnv, defaultOn } = require('./usagepoll');

const F = 'AGENT_WORKFORCE_AUTOMOVE';
const O = 'AGENT_WORKFORCE_AUTOMOVE_OFF';

test('the brake, and the force variable set to anything but 1, are offs from the environment', () => {
  assert.equal(offByEnv({ [O]: '1' }, F, O), true);
  assert.equal(offByEnv({ [O]: '1', [F]: '1' }, F, O), true, 'the brake wins over a force, as in defaultOn');
  assert.equal(offByEnv({ [F]: '0' }, F, O), true);
  assert.equal(offByEnv({ [F]: 'false' }, F, O), true);
});

test('CONTROL: unset, empty, forced on, or a brake not set to 1 are not', () => {
  assert.equal(offByEnv({}, F, O), false);
  assert.equal(offByEnv({ [F]: '' }, F, O), false);
  assert.equal(offByEnv({ [F]: '1' }, F, O), false);
  assert.equal(offByEnv({ [O]: '0' }, F, O), false);
  assert.equal(offByEnv(null, F, O), false);
});

test('a default off (one login, a test, a dry run) is not reported as an off from the environment', () => {
  for (const env of [{}, { NODE_TEST_CONTEXT: 'child' }, { AGENT_WORKFORCE_DRY_RUN: '1' }]) {
    assert.equal(defaultOn(env, F, O, 1), false, 'CONTROL: defaultOn reads off here');
    assert.equal(offByEnv(env, F, O), false, JSON.stringify(env));
  }
});

test('whenever offByEnv says off, defaultOn is off, whatever the login count', () => {
  for (const env of [{ [O]: '1' }, { [F]: '0' }, { [O]: '1', [F]: '1' }]) {
    for (const n of [0, 1, 2, 5]) assert.equal(defaultOn(env, F, O, n), false, JSON.stringify(env) + ' n=' + n);
  }
});
