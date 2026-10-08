# usageprice-5532: the published price table, for the engine (#5532, Enterprise E0.3, piece 1)

Umbrella #5529. The company rollup (#5532) reports an estimated cost per day, provider and model, and the contract
agreed with PigeonPete (kosmos-relay `.claude/plans/rollup-5532.md`) says the board prices it, from one table, and sends
`null` for a model with no published price, never 0.

## What this branch builds
- `engine/usageprice.js`: `USAGE_MODEL_PRICES` (the same rows as the page's), `modelPrice(id)` (exact, then without a
  trailing -YYYYMMDD stamp; own keys only) and `costOf(id, bucket)` (null when unpriced).
- `engine/usageprice.test.js`: lifts the page's `USAGE_MODEL_PRICES`, `usageModelPrice` and `usageApiCost` out of
  web/index.html and fails on any difference in rows, in how an id resolves, or in the cost of a bucket.

Nothing calls the module yet: the rollup sender (the next piece of #5532) is its first caller.

## Decided
- Two copies with a guard, not one copy. The page's usage functions are pure, lifted into node tests, and also run from
  file:// in browser checks; making them fetch prices from the board is a wide change for a table that changes a few
  times a year. Rejected too: the engine reading the page at runtime.
- Weakest premise: a price change now has to be made in both places. The guard turns red until it is.
- The page's `usageModelPrice` returns a built-in for a prototype name such as `toString` (it does not check own keys).
  No model has such a name, so the usage screen never meets one; the engine prices them as null and the test pins that.
  Not changed here, to keep this branch off the page.

## Tests
- Row-for-row equality with the page (a changed rate reddens it: mutation run).
- The two resolvers agree on every priced id, its dated form, a malformed date, unpriced ids and the empty id.
- `costOf` matches the page's `usageApiCost` for every priced model and a dated one; null for unpriced; 0 for no tokens.
