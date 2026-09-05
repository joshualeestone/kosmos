'use strict';
/**
 * #2284: pin Josh's most-powerful-first model order for BOTH providers, so this
 * launch-critical ordering cannot silently regress. The sort itself already
 * exists (Claude: the create.js MODELS array order; OpenAI: openaiTierScore +
 * openaiHighTierRank, applied in chatModelsFromList) - this test is the guard
 * that keeps it in Josh's exact order.
 *
 * Josh's stated order (0.6.36):
 *   Claude:  Fable 5.1, Fable 5, Opus 5, Opus 4.8, Sonnet, Haiku
 *   OpenAI:  5.6 Terra, 5.6 Soul, 5.6 Luna, 5.5 Pro, 5.5, 5.4 Pro, then 5.4 mini/nano, then gpt-4.x
 *
 * The 5.4 mini/nano pair is Mini > Nano (#2263): nano is OpenAI's SMALLEST tier
 * (full > mini > nano), so "most-powerful-first" ranks mini above it. Josh's
 * 0.6.36 note listed "Nano, Mini" - the pre-#2263 order (which a stale comment in
 * openaiaccounts.js still carried until #2284); this test encodes the corrected
 * power order. If a ruling ever explicitly wants nano above mini, this test and
 * openaiTierScore flip together.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('./create');
const openai = require('./openaiaccounts');

test('#2284 Claude models are in Josh\'s exact most-powerful-first order', () => {
  const claude = create.MODELS.filter((m) => m.provider === 'anthropic').map((m) => m.arg);
  assert.deepEqual(claude, [
    'claude-fable-5-1',
    'claude-fable-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-haiku-4-5-20251001',
  ], 'Claude picker order: Fable 5.1, Fable 5, Opus 5, Opus 4.8, Sonnet, Haiku');
});

test('#2284 OpenAI sorts most-powerful-first: version descending, then tier (terra>soul>luna>pro>plain>mini>nano)', () => {
  // The ids OpenAI would return for Josh's stated tiers, shuffled on input so the
  // assertion exercises the SORT, not the input order.
  const ids = [
    'gpt-5.4-nano', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.6-terra',
    'gpt-5.4-pro', 'gpt-5.5-pro', 'gpt-5.6-soul', 'gpt-4.1', 'gpt-4o',
  ].map((id) => ({ id }));
  const order = openai.chatModelsFromList(ids).map((r) => r.arg);
  assert.deepEqual(order, [
    'gpt-5.6-terra', 'gpt-5.6-soul', 'gpt-5.6-luna',
    'gpt-5.5-pro', 'gpt-5.5',
    'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
    'gpt-4.1', 'gpt-4o',
  ], 'OpenAI most-powerful-first: the 5.6 tiers, then 5.5 pro/plain, then 5.4 pro/mini/nano, then the gpt-4.x family');
});

test('#2284/#2263 the 5.4 mini/nano pair is Mini above Nano (nano is the smaller tier)', () => {
  const order = openai.chatModelsFromList([{ id: 'gpt-5.4-nano' }, { id: 'gpt-5.4-mini' }]).map((r) => r.arg);
  assert.deepEqual(order, ['gpt-5.4-mini', 'gpt-5.4-nano'], 'mini outranks nano, most-powerful-first');
});
