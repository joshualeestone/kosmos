# model-sort-order-2284: pin Josh's most-powerful-first model order (both providers)

**Card:** kosmos#2284 (self-carded; routed by Splinter from Josh's 0.6.36 notes). Picker lane.

## Josh's stated order

- Claude: Fable 5.1, Fable 5, Opus 5, Opus 4.8, Sonnet, Haiku
- OpenAI/GPT: 5.6 Terra, 5.6 Soul, 5.6 Luna, 5.5 Pro, 5.5, 5.4 Pro, then 5.4 mini/nano, then the GPT-4.x family (highest-performant first)

## What I found (verify before build)

Both providers ALREADY sort in Josh's exact order on current main:
- Claude: the `engine/create.js` MODELS array is authored in that order (the array order IS the display order).
- OpenAI: `openaiTierScore` + `openaiHighTierRank`, applied in `chatModelsFromList` (#2140/#2263), sort version-descending then by tier (terra>soul>luna>pro>plain>mini>nano).

I verified by feeding Josh's ids through `chatModelsFromList` and printing the order; it matches exactly.

## The one discrepancy and the decision

Josh's relayed OpenAI order lists "5.4 Nano, 5.4 Mini", but the shipped code ranks **Mini > Nano** (#2263, merged before the 0.6.36 cut). Mini > Nano is the real OpenAI power order (nano is the smallest tier: full > mini > nano), which is what "most-powerful-first" requires, and #2263 is Josh's own 0.6.35 ruling with that reasoning. The relayed "Nano, Mini" matches the PRE-#2263 order and a stale comment in `openaiaccounts.js` that #2263 never updated.

**Decision: keep Mini > Nano.** Rejected: flipping to Nano > Mini (would reverse #2263 and contradict the most-powerful-first principle). **Weakest premise:** that Josh's relayed "Nano, Mini" is a slip rather than a new intent - confirmed with Splinter (who relayed it and owned the slip: it was his verbatim relay of Josh's note, not a fresh ruling; #2263 matches Josh's stated principle). Flagged on the card; a one-line flip in code + test if Josh ever explicitly wants Nano above Mini.

## The change

The sort is already correct, so this is a durable guard, not a behavior change:
1. `engine/model-sort-order-2284.test.js` (new): pins Josh's full exact order for BOTH providers - the Claude array order, the OpenAI version-then-tier order (incl. the 5.6 terra/soul/luna tiers and the mini>nano pair). Turns "it happens to be right" into "it stays right" for launch.
2. `engine/openaiaccounts.js`: fixed the stale tier-order comment ("Nano > Mini" -> "Mini > Nano") so it matches the code + #2263 - the stale line is what a 0.6.36 re-request of the sort echoed.

## Verification

Full node suite green (4676 pass, 0 fail); the three new tests ran (confirmed by name) and the #1934 coverage guard passed. Blind challenge-review converged (0 blocker/warning/convention).
