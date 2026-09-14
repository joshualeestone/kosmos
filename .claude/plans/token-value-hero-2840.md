# token-value-hero-2840 - implement the approved Token Usage value-view (#2840)

## What / ruling
Josh's named priority (2026-09-14): implement the approved `/design/token-value` value-view as the
in-app Token Usage screen. Splinter relayed Josh's rulings, in order:
1. Build it EXACTLY as approved, verbatim, no "honest-adjustment", no agent interpretation. The
   blended "total tokens" headline is CORRECT because it reflects FULL engineering value (research,
   reading, prioritizing), not output-token "typing" alone. This overrules the earlier #2617
   never-sum position ON THE MERITS.
2. The "Equivalent Token API Cost" box is built from OFFICIAL PUBLISHED per-model API list prices
   (tokens x published price), with source + date cited; flag any model with no published price
   rather than guess.
Mona (design owner + #2617 author) was coordinated and given Josh's merits rationale.

## Built (all from real /api/usage data, calc-verified against the design)
`web/index.html`:
- **Hero**: active-days eyebrow + the blended `total tokens = approximate human cost` equation +
  three stats (Human Work Hours / Years of Human Work / Equivalent Token API Cost). Reuses the
  design's own calc, already live for the Value column: `hours = total / 100000`, `value = hours *
  $90`, `years = hours / 2080`. Verified: 150.0B total -> $135.0M, 1.5M hours, 720 years (matches
  the approved mock exactly). `usageHeroHtml` / `usageHeroDigits`, pure.
- **Per-model table + donut**: `usageByModel` aggregates `byDay` into per-model 4-class totals
  (blended, per the ruling), sorted desc; `usageModelTableHtml` (Model / share-bar / tokens / %);
  `usageDonutSvg` (top-6 + Other token share, blended-total center). One shared palette
  (`USAGE_MODEL_COLORS`) so table and donut cannot drift.
- **charts4**: `usageCharts4Html` - four per-class daily mini-charts (cache reads / writes / output /
  input) with name / tag / abbreviated total / % of blended total. (Defined; wiring/placement gated
  on the A/B scope decision below.)
- **Equivalent Token API Cost**: `USAGE_MODEL_PRICES` ($/Mtok input/output/cache-write/cache-read
  per model id) + `usageModelPrice` (exact, then strip a `-YYYYMMDD` stamp) + `usageApiCost` (sum
  tokens x published price; `{cost, unpriced}`). Sources cited + dated in code (claude.com/pricing,
  developers.openai.com, ai.google.dev, fetched 2026-09-14). NO guessing: gpt-5.1-codex has no
  published price -> excluded and NAMED in the status line; `cost` null -> hero shows "-" not a
  false $0. OpenAI/Gemini bill cache-writes at the input rate (published behaviour, noted).
- **CSS**: the design's hero/stats/donut/charts4/model-table styles ported to the app's `--k-*`
  tokens (light + dark).

## Open scope decision (flagged to Splinter, awaiting A/B ruling)
The approved design's layout does not contain three elements the live screen has, which Josh
explicitly ruled IN earlier: (1) the four class cards with FULL unabbreviated numbers (#2617); (2)
the ONE combined shared-axis daily chart (#2617); (3) the output-only money box (#853). Building the
design exact-to-spec REPLACES 1/2/3 with charts4 + the hero value box. Flagged to Splinter to
confirm REPLACE (pure exact-to-spec) vs KEEP-alongside before deleting Josh-ruled elements. The
additions above are safe either way; the removals/charts4-placement wait on the ruling.

## Verification
- Focused pure-function tests (scratch): hero figures match the design (150.0B / $135.0M / 1.5M /
  720); per-model aggregation + donut bucketing; charts4 (4 charts, empty-safe, no NaN); API cost
  (per-class pricing, codex excluded+flagged, haiku date-strip, null-dash). All pass.
- Existing `web.token-usage-2617.test.js` still 16/16 after every step.
- Committed coverage for the new pure fns to be added to that test; browser-test (visual gate, per
  Splinter) before PR.

## Weakest premise
That "port to the Kosmos token system" is implementation, not interpretation. The numbers, calc, and
structure match the design exactly; only the CSS variables map to existing `--k-*` tokens (the design
is already Mona's Kosmos-restyle). The one place judgment enters is the A/B removal scope, which is
flagged, not decided unilaterally.
