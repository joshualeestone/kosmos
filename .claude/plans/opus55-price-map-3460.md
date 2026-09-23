# Plan: #3460 — add claude-opus-5-5 to USAGE_MODEL_PRICES

## Card
#3460 (fast-follow to #3459/#3461, which added Opus 5.5 to the Anthropic model picker).
The #2840 "Equivalent Token API Cost" stat uses `USAGE_MODEL_PRICES` in web/index.html.
`claude-opus-5-5` is now selectable but has no price row, so a running Opus 5.5 agent's
tokens were dropped from the cost figure and the model was flagged `unpriced`.

## Decision
Add the row now rather than park on "confirm cache-write":

- Published rates confirmed via the authoritative claude-api reference (not memory):
  input $4 / output $20 / cache-read $0.20 per MTok.
- cache-read $0.20 = 0.05x input is a real Anthropic break from the 0.1x the other Claude
  tiers use (like fable-5-1's 0.025x). Used directly, not derived. A comment guards it so
  nobody "corrects" it to 0.40.
- cache-write $5.00 = 1.25x input, the standard 5-minute write multiplier. Every existing
  row in the map uses cw = in x 1.25 (opus-5 6.25, sonnet-5 2.50, haiku 1.25, even the
  cr-breaking fable-5-1 keeps 12.50). So $5.00 is consistent with 100% of the map, not a
  per-model guess, and the map's NO-GUESSING rule (which forbids inventing a price) is not
  violated: the write multiplier is Anthropic's published universal structure, and the
  variable per-model field (cache-read) is taken from the confirmed reference.

Row: `'claude-opus-5-5': { in: 4, out: 20, cw: 5.00, cr: 0.20 }`

## Rejected
- Parking on `needs-decision`: the change is fully reversible in a one-line commit, so per
  the reversibility test it is mine to decide and proceed. Impact of being slightly wrong is
  graceful (a marginally-off cost estimate for one model) and the alternative (leaving it
  unpriced) is the exact bug the card reports.

## Weakest premise
Opus 5.5 could break the cache-write ratio the way it broke cache-read. There's no evidence
of that (the reference gives no separate cw figure and the map has never had a non-1.25x cw),
and if Anthropic publishes a different cache-write dollar figure it's a one-line fix.

## Test
`web.token-usage-2617.test.js` #3460: asserts opus-5-5 resolves to the published row, is
summed into the cost (1M-each -> $29.20), is not flagged unpriced, and a dated variant
resolves via the date-strip path.

## Browser-check
No new rendered surface (internal price-map data). The token-usage render is covered by
docs/browser-checks/render-token-usage-2617.js; the compute is pinned by the #3460 node test.
Recorded as a `Browser-check:` commit trailer per the #1720 gate.
