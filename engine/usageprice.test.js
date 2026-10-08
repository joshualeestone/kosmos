'use strict';
/**
 * kosmos#5532: the engine's price table and the page's must never drift. Both are lifted (the page's straight out of
 * web/index.html) and compared row by row, and the two resolvers must agree on every id, dated or not, priced or not.
 * Pure: reads the page file, touches no data root.
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('../test-support/page');
const up = require('./usageprice');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
// eslint-disable-next-line no-new-func
const PAGE = new Function(page.liftConst(SCRIPT, 'USAGE_MODEL_PRICES') + '\n' + page.lift(SCRIPT, 'usageModelPrice') + '\n'
  + page.lift(SCRIPT, 'usageApiCost') + '\nreturn { USAGE_MODEL_PRICES, usageModelPrice, usageApiCost };')();

const plain = (o) => JSON.parse(JSON.stringify(o));

test('#5532: the engine price table is exactly the page\'s (same models, same four rates each)', () => {
  assert.ok(Object.keys(PAGE.USAGE_MODEL_PRICES).length >= 5, 'the page table was not lifted');
  assert.deepEqual(plain(up.USAGE_MODEL_PRICES), plain(PAGE.USAGE_MODEL_PRICES),
    'the engine and the page price models differently; change both (engine/usageprice.js and web/index.html USAGE_MODEL_PRICES)');
});

test('#5532: the engine and the page resolve every id the same way (exact, dated, unpriced, odd)', () => {
  const ids = Object.keys(PAGE.USAGE_MODEL_PRICES)
    .flatMap((id) => [id, id + '-20251001', id + '-2025'])
    .concat(['gpt-5.1-codex', 'totally-unknown', '']);
  for (const id of ids) {
    assert.deepEqual(plain(up.modelPrice(id)), plain(PAGE.usageModelPrice(id)), 'the two resolvers disagree on ' + JSON.stringify(id));
  }
  /* Names on every object's prototype are not models. The engine reads own keys only, so they price as null. (The page's
     usageModelPrice returns a built-in for these; no model is called that, so the usage screen never meets one.) */
  for (const id of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) assert.equal(up.modelPrice(id), null, id);
});

test('#5532: costOf matches the page\'s usageApiCost for a priced model, and is null (never 0) for an unpriced one', () => {
  const b = { input_tokens: 1234567, output_tokens: 765432, cache_creation_input_tokens: 111111, cache_read_input_tokens: 9999999 };
  for (const id of Object.keys(PAGE.USAGE_MODEL_PRICES).concat(['claude-haiku-4-5-20251001'])) {
    const pageCost = PAGE.usageApiCost({ d: { [id]: b } }).cost;
    assert.ok(Math.abs(up.costOf(id, b) - pageCost) < 1e-9, id + ': engine ' + up.costOf(id, b) + ' vs page ' + pageCost);
  }
  assert.equal(up.costOf('gpt-5.1-codex', b), null);
  assert.equal(up.costOf('totally-unknown', { output_tokens: 1e9 }), null);
  assert.equal(up.costOf('claude-opus-5', {}), 0, 'a priced model with no tokens costs 0');
});
