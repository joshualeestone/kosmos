# tiersort-mininano-2263: mini outranks nano in the OpenAI picker

## The bug

`engine/openaiaccounts.js` `openaiTierScore` (shipped in #2248, item 9 of #2140)
ranked the within-version tiers: terra 9 > soul 8 > luna 7 > pro 6 > plain 5 >
**nano 4 > mini 3**. That puts nano above mini, which is backwards: in OpenAI's
lineup nano is the smallest / least-capable tier and mini sits above it
(gpt-4.1 > gpt-4.1-mini > gpt-4.1-nano). The picker sorts most-powerful-first, so
mini should rank above nano. Found while building the /design model-picker mock.

## The fix

Swap the two scores: mini 4, nano 3. `plain` stays 5 (between pro 6 and mini 4);
the comment "between pro and nano" is corrected to "between pro and mini". The
change is centralized in `openaiTierScore`, which `openaiHighTierRank` also uses,
so the newer-than-gpt-5 tier ranking picks up the fix too.

## Test

The #2140 item-9 ordering test in `engine/openaiaccounts.test.js` asserted the
old Pro>Nano>Mini order (it encoded the bug); corrected to Pro>Mini>Nano, the
real lineup. The assertion pins the whole ordered list from a shuffled input, so
it exercises the sort end to end. 81 openaiaccounts tests pass.

## Weakest premise

That mini is always more capable than nano. True for OpenAI's public naming
(nano = smallest); the speculative gpt-5.x tier names are not yet real ids, but
the nano<mini relationship is a stable OpenAI convention, so the order holds when
those ids arrive.

## Not in scope

The design mock of this order is a separate change (chaoskosmos-site
/design/model-picker), already showing the corrected order.
