# sonnetcr-5627: Sonnet 5.5 cache-read price 0.20 -> 0.10

**Card:** #5627 (filed while adding Haiku 5.5, #5626).

**Source:** Anthropic pricing page, read 2026-10-08.
- Claude Sonnet 5.5: input $2, 5-minute write $2.50, cache hits and refreshes $0.10, output $10.
- Footnote 2: cache hits on Opus 5.5 and Sonnet 5.5 are 0.05x the base input price.
- Sonnet 5 stays at $0.20 (its own row on the same page).

**Change:**
- `cr: 0.10` for claude-sonnet-5-5 in both tables, `engine/usageprice.js` and `web/index.html` USAGE_MODEL_PRICES. engine/usageprice.test.js requires the two tables to be identical.
- The #4439 price test updated: the rates, and the 1M-each total, which goes from $14.70 to $14.60.
- A control that Sonnet 5 keeps 0.20.

**Why it matters:** cache reads are most of an agent's tokens. At 0.20, Sonnet 5.5 days were valued at about twice their cache-read cost, on the usage screen and in the company rollup.

**Weakest premise:** that the published page is current. The 0.20 came from Claude Code's own catalog entry (tier_2_10). The published price wins, as it does for every other row.

**Tests:** usageprice.test.js and web.token-usage-2617.test.js pass. Every test file naming claude-sonnet-5-5 passes (5 files, 524 tests).

## Review 1 (blind, Opus): converged; NITs taken (comments name the shared 0.05x; wording)
