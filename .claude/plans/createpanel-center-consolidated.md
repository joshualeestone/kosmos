# createpanel-center-consolidated - center the New Agent panel in the consolidated view

Source: Josh, 2026-09-23, #chaoskosmos-design (with screenshot):
"for .91 lets also add in the margin issue for viewing Add an Agent on the consolidated view.
Its touching the vertical rule and should be centered." Target build: 0.6.91 (fast-follow, not .90).
Owner: Mona Lisa (app-UI / dialog-UI lane).

## What "finished" looks like (falsifiable)
On the consolidated (3-column) layout, the New Agent create panel (#panel-create, the
"What should this agent do?" role picker) is CENTERED in the display column: equal gaps left and
right, at its 34rem form width, instead of sitting flush against the projects-list vertical rule
with a large empty right margin. At the narrow consolidated floor (960px) the form fills the column
but keeps a horizontal inset so its content never touches the rule.

## Root cause
#3053 placed #panel-create in the consolidated display column with `margin: 0` (deliberately
left-flush, "not a narrow centered island") and `padding: 24px 24px 0 0` (zero left padding). So the
panel's left edge and its content both sat on the projects-list right rule. Tab view already centers
this same panel via `margin: 0 auto` (Josh's 2026-08-22 ruling "I want it centered"); the
consolidated override dropped that centering. Josh's 2026-09-23 request reverses the #3053 choice.

## Change (web/index.html)
One CSS rule, `html[data-layout="consolidated"] body.consolidated #panel-projects > #panel-create`:
`margin: 0` -> `margin: 0 auto` (center the 34rem box in the 1fr display column) and
`padding: 24px 24px 0 0` -> `padding: 24px 24px 0 24px` (symmetric inset so content never touches the
rule at the narrow floor, where the box fills the column and margin:auto has no room). Comment
rewritten to record Josh's reversal + rulings. No JS, no behavior change.

Why `margin: 0 auto` centers a grid item: it is in the grid's `1fr` column with a definite width
(width:100% capped by inherited max-width:34rem) less than the column, and auto margins absorb the
free space and take precedence over the default `justify-self: stretch`. Same mechanism the settings
panel documents. No competing justify-self/justify-items on this element.

## Test
Update the existing CI browser-check docs/browser-checks/render-consolidated-newagent-3053.js: its
position arm asserted the OLD top-left position (`leftGapPastList < 40`). Rewrite it to assert the
CENTERED position - add `rightGap`, assert `leftGap > 40` (rejects old left-flush), `|leftGap -
rightGap| <= 24` (rejects off-center), and width in 400..640 (rejects narrow-island / full-fill).
Relative gap comparison, not an absolute pixel target. This satisfies the #1720 web-change gate by a
real assertion update, not a trailer.

## Verification note
Host browser render is wedged tonight (chrome-headless-shell will not launch; box up 10 days, matches
the macOS long-uptime bulletin), so the updated check could not be run + positive-controlled locally.
Verified by CSS reasoning + the blind challenge review; CI runs the browser suite on the PR, which is
where the updated assertion executes against real chromium. If CI reds the position arm, re-tune the
geometry there.

## Gates
- #1720 web-change gate: satisfied by the render-consolidated-newagent-3053.js assertion update.
- #2518 surface gate: the check's Browser-check-surface tokens are unchanged.
- No em dashes in any added line (output-to-Josh rule).
