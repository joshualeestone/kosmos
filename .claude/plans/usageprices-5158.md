# usageprices-5158: published prices for the models Codex, Gemini CLI and Grok agents run (slice 2)

Card: kosmos#5158 (GO, Josh 11:23 via Splinter). Slice 1 (PR #5163) counts these providers' tokens; without a price
row their tokens are listed as unpriced. This adds the rows the "no guessing" rule allows: published, dated prices only.

## What finished looks like
Token Usage's "Equivalent Token API Cost" prices gpt-5.6-sol, gemini-3.8-flash and grok-4.6 from each provider's own
page, and names any model with no published price (grok-4.6-build, the id Grok's usage file records) as unpriced.

## Prices ($ per million tokens; fetched 2026-10-03 from each provider's own page)
| Model | in | out | cw | cr | Source | Note |
|---|---|---|---|---|---|---|
| gpt-5.6-sol | 4 | 20 | 5.00 | 0.40 | developers.openai.com/api/docs/models/gpt-5.6-sol | cache writes published at 1.25x input; >272K prompts cost more |
| gemini-3.8-flash | 0.75 | 3.75 | 0.75 | 0.075 | ai.google.dev/gemini-api/docs/pricing | introductory through 2026-12-31, doubles 2027-01-01; caching storage billed per hour, so cw = input |
| grok-4.6 | 2 | 6 | 2 | 0.50 | docs.x.ai/docs/models/grok-4.6 | no cache-write price published, so cw = input; >=200K prompts cost more |

## Decisions
- Standard (not long-context) rates: the page prices a day's tokens, not individual requests, so a request's prompt size
  is not known here. Stated in the table's comment.
- grok-4.6-build stays unpriced: no published price under that id. Rejected: borrowing grok-4.6's (a guess). Grok's own
  recorded cost (costUsdTicks) is a later slice once its unit is confirmed.
- Weakest premise: the Gemini introductory rate is right only until 2026-12-31; the comment says to update it then.

## Validation
- web.token-usage-2617: the three rows equal the published numbers; a Codex day prices to $6.40 exactly; grok-4.6-build is
  named unpriced. Page parse and name/brand guards pass.
