'use strict';
/**
 * kosmos#5532 (Enterprise E0.3): published API prices, for the engine. The company rollup reports an ESTIMATED cost
 * per day, provider and model, and the board prices it here so the company's console and this person's usage screen
 * say the same number.
 *
 * 🛑 THE PAGE HAS THE SAME TABLE (web/index.html USAGE_MODEL_PRICES and usageModelPrice), and engine/usageprice.test.js
 * lifts both out of the page and fails on ANY difference. A price change is made in both places. The page keeps its
 * copy because its usage functions are pure, lifted into node tests, and also run from file:// in browser checks.
 *
 * $ per MILLION tokens: in (input), out (output), cw (cache write), cr (cache read). The sources and the reasons for
 * each odd-looking rate are in the page's comment above its table; do not "correct" one here without the page.
 *
 * 🛑 NO GUESSING (Splinter): a model with no published price prices as null, never 0 and never an estimate.
 */
const USAGE_MODEL_PRICES = Object.freeze({
  'claude-opus-5-5': Object.freeze({ in: 4, out: 20, cw: 5.00, cr: 0.20 }),
  'claude-opus-5': Object.freeze({ in: 5, out: 25, cw: 6.25, cr: 0.50 }),
  'claude-opus-4-8': Object.freeze({ in: 5, out: 25, cw: 6.25, cr: 0.50 }),
  'claude-sonnet-5-5': Object.freeze({ in: 2, out: 10, cw: 2.50, cr: 0.10 }),   // #5627: cache hits are 0.05x input (published)
  'claude-sonnet-5': Object.freeze({ in: 2, out: 10, cw: 2.50, cr: 0.20 }),
  'claude-sonnet-4-6': Object.freeze({ in: 3, out: 15, cw: 3.75, cr: 0.30 }),
  // #5626: claude-haiku-5-5 at the published Anthropic base rates (platform.claude.com pricing, 2026-10-08): input 0.10,
  // 5-minute write 0.125, cache read 0.01, output 0.50. Haiku 5.5 is priced by PROMPT LENGTH and costs 5x past 100,000
  // tokens. A usage day here carries no per-request prompt size, so the base rate is used and a long-context day is
  // under-estimated. Said on #5626.
  'claude-haiku-5-5': Object.freeze({ in: 0.10, out: 0.50, cw: 0.125, cr: 0.01 }),
  'claude-haiku-4-5': Object.freeze({ in: 1, out: 5, cw: 1.25, cr: 0.10 }),
  'claude-fable-5-1': Object.freeze({ in: 10, out: 50, cw: 12.50, cr: 0.25 }),
  'claude-fable-5': Object.freeze({ in: 10, out: 50, cw: 12.50, cr: 1.00 }),
  'gpt-5.1': Object.freeze({ in: 1.25, out: 10, cw: 1.25, cr: 0.125 }),
  'gemini-2.5-flash': Object.freeze({ in: 0.375, out: 1.875, cw: 0.375, cr: 0.0375 }),
  // #5158: the three newer models the page prices (sources beside web/index.html USAGE_MODEL_PRICES). grok-4.6-build
  // has no published price and stays unpriced here too.
  'gpt-5.6-sol': Object.freeze({ in: 4, out: 20, cw: 5, cr: 0.4 }),
  'gemini-3.8-flash': Object.freeze({ in: 0.75, out: 3.75, cw: 0.75, cr: 0.075 }),
  'grok-4.6': Object.freeze({ in: 2, out: 6, cw: 2, cr: 0.5 }),
});

/* A model id to its price row: exact first, then without a trailing -YYYYMMDD stamp (Claude Code writes
   claude-haiku-4-5-20251001). Null when there is no published price. Same rule as the page's usageModelPrice. */
function modelPrice(modelId) {
  const id = String(modelId || '');
  if (Object.prototype.hasOwnProperty.call(USAGE_MODEL_PRICES, id)) return USAGE_MODEL_PRICES[id];
  const stripped = id.replace(/-\d{8}$/, '');
  return Object.prototype.hasOwnProperty.call(USAGE_MODEL_PRICES, stripped) ? USAGE_MODEL_PRICES[stripped] : null;
}

/* The estimated cost in dollars of one usage bucket (engine/usage.js BUCKET_FIELDS) for one model, or null when the
   model has no published price. */
function costOf(modelId, bucket) {
  const p = modelPrice(modelId);
  if (!p) return null;
  const b = bucket || {};
  return ((Number(b.input_tokens) || 0) * p.in
    + (Number(b.output_tokens) || 0) * p.out
    + (Number(b.cache_creation_input_tokens) || 0) * p.cw
    + (Number(b.cache_read_input_tokens) || 0) * p.cr) / 1e6;
}

module.exports = { USAGE_MODEL_PRICES, modelPrice, costOf };
