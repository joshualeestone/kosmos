# Plan: #2840 Token Usage value-view — usage-history list increment

Author: Angel. Started 2026-09-12 ~03:05 CDT. Branch: token-value-2840.

## Context + the standing conflict (READ FIRST)
#2840 implements Mona's approved token-value design (~/.cache/handoffs/token-value-2840-spec.html,
= chaoskosmos-site origin/token-usage-hero:design/token-value.html) into the app's
`#s-sec-usage` region (web/index.html), wired to the real `/api/usage` (byDay shape:
`{[day]:{[model]:{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}}}`).

🛑 STANDING PRODUCT CONFLICT, surfaced to Mona + Splinter, ruled a JOSH call (Splinter is
taking it to Josh's morning): the design derives the hero "Total Tokens" + all the $ value
figures (Human Cost, Work Hours, Years, and the usage-history Value column) from a BLENDED
sum of all four token classes (~99% cache_read). The shipped #2617 code DELIBERATELY never
blends (cache_read ~440x output, so a blended total is "~440x too large"; its money box is
OUTPUT-ONLY "so a large number is never turned into a large dollar amount it did not earn").
So every $-value figure is CONTESTED and must be STUBBED/FLAGGED, not shipped, until Josh
rules blend ($135M demo) vs output-only (~440x smaller). Splinter's steer (i): build the
layout + usage-history now, value math clearly stubbed; drop in the math the moment Josh rules.

## Scope of THIS increment (bounded, additive, low-risk on the #1 demo surface)
Add the scrollable usage-history list (the 0.6.57 polish Josh flagged) as a new block in
`#s-sec-usage`, ABOVE the estimate note, matching the design's `.uhwrap`/`.uhrow`:
columns Day / Model / Total tokens / Value, newest first, fixed-height scroll, sticky header.
- Day, Model, Total tokens: real data from byDay (per day+model row). "Total tokens" here is
  the per-ROW sum of that day+model's four classes — a detailed breakdown row, not the single
  blended HEADLINE #2617 refuses; still, it is a sum, so it is labeled and its meaning is
  clear in the column header, and the hero single-total is NOT built in this increment.
- Value column: STUBBED — renders a clear "pending" placeholder (not a live number), with a
  code comment naming the blend-vs-output decision and #2840 as where the real math lands.
The fuller hero/charts4/model-table/pie redesign is the remaining #2840 scope (a bigger
visual pixel-match, best finished in a claude-fe interactive session or a follow-up); this
increment does NOT tear down the existing #2617 cards/chart/table.

## Changes (web/index.html)
- New pure function `usageHistoryHtml(byDay)` (mirrors usageTableHtml's shape + the design's
  .uhrow markup): one row per day+model, newest first, Total = row's 4-class sum, Value = the
  stub placeholder. Returns '' when empty.
- Wire it into `paintUsage` (a new `#usage-history` container in the section HTML).
- CSS: `.uhwrap`/`.uhrow`/head/sticky, ported from the design's tokens to the app's real
  tokens (the design already remapped to app vars; use the app's --k-* set as the section does).

## Verification
- Node test: mirror web.token-usage-2617.test.js — lift `usageHistoryHtml` out, run against a
  fixture byDay, assert the rows (Day/Model/Total) and that Value is the STUB, not a number.
- Browser-check (render-usage-history-2840.js) via pw-runtime headless: assert the list
  renders, has the 4 columns, scrolls (max-height), and the Value cells show the stub.
  Bump the browser-check count guards if adding a new check reds the reason-grep test.
- Full node suite (tools/run-tests.sh) green; challenge-loop to convergence; PR (Addresses
  #2840, non-closing; no --reviewer per the self-authored-Kosmos rule). Josh's in-app eyeball
  is the final visual pass (per #2350), plus his blend ruling fills the stub.

## Weakest premise
That a per-day+model "Total tokens" breakdown ROW is acceptable under #2617's no-blend stance
(it is a labeled detail sum, not the single blended headline #2617 rejects). If Josh's ruling
is "never sum classes anywhere," this column changes too — but the row is a breakdown, not a
headline, so it is the defensible reading, and the Value column (the real contested $) is
stubbed regardless.
