# Plan: restore the graphical Token Usage page (#2617)

## Goal
Josh, #2617: the Token Usage page (Settings > Token Usage) "lost its graphical per-agent design --
now a plain white box." Restore the graphical, value-oriented design per Mona's mockup. This is
Josh's #1 demo win and the long pole for the morning demo.

## Spec (Mona's mockup IS the spec)
`~/work/Josh-Brain/Projects/kosmos-design/kosmos-token-usage-money-2026-09-01.html`. Josh's overrule
(via Splinter): show ALL FOUR token classes and the trend, in full, however large -- do NOT round,
abbreviate (no "2.4M"), or soften a number because it looks alarming. Dark theme (the app's theme).

The page (in `web/index.html`, section `#s-sec-usage`, nav button `data-go="usage"` at ~web:10674,
section at ~web:11312 -- currently the #853 per-model/day TABLE only) gains, above/around the table:
1. **Four class cards**: Input, Output, Cache written, Cache read (cache-read in gold and it TOWERS).
   Full numbers, no abbreviation. Each card: uppercase class label + big mono number + a one-line
   "say" (e.g. "what you sent the models" / "the same context read again on every turn").
2. **A 14-day daily LINE CHART** (SVG): four polylines (cache-read gold, cache-written green, input
   blue, output purple) on ONE shared axis, so cache-read towers and the other three run low along
   the bottom -- the true proportion, not a drawing choice. X-axis day labels; a legend.
3. **A MONEY box** "One interpretation, in money": derived from OUTPUT tokens ONLY (750,000 output
   tokens = one 8-hour engineer-day at $100/hr => $ = round(outputTotal / 750000 * 800)). It NAMES
   its class (output) and states the basis, so a derived $ is never read as a raw total. Do NOT fold
   the other three classes into the dollar figure.
4. **Keep the per-model/day table** (Day, Model, Input, Output, Cache written, Cache read).

## Data source
Existing **`/api/usage`** (server.js:4491, #853/#854 -- real per-model, per-day token usage read from
the local transcripts). The JS render for #853 usage is at ~web:22301. Per-AGENT breakdown is DEFERRED
(engine work, out of scope for #2617). Compute the four class TOTALS + the daily series by summing the
/api/usage rows client-side (as the mockup's headline numbers "add up from" the table).

## Decisions
- All four classes in full, unsoftened (Josh's explicit overrule -- do not re-introduce abbreviation).
- The chart shares one axis on purpose (cache-read towering is the honest proportion).
- The dollar line is output-only and self-labels; the other three are shown raw, never folded in.
- Match Mona's exact tokens/colors/copy (gold #d6a62e cache-read, green #6fd3a0 cache-written, blue
  #8ab4ff input, purple #c78cff output; the dark-theme surface/ink tokens the app already defines).

## Tests / gates
- Full node suite green. web/index.html change -> browser-check gate (CI). ADD a #2617 browser-check
  + a node test pinning the render (the four cards present + the class totals computed from /api/usage
  + the chart svg + the money box naming output + the table). KEEP browser-check assertions
  DETERMINISTIC (the #2620 lesson: an un-runnable check's hardcoded values are caught by the blind
  review -- and a wrong computed-$ or mis-summed class is exactly what the challenge-loop must catch).
- Challenge-loop before PR (write THIS plan file first -- the plan-file gate is hard-enforced).
- HEADED visual verify (overlay of the chart + cards matching Mona's mockup) rides the MORNING
  claude-fe session; ping Mona to eyeball. Beta: merge on green AFTER the headed pass.
- Coordinate with Mona (monalisa-76) -- she owns the design and flagged this as Josh's #1.
