# Plan: METR "how we estimate the value" footnote (#2840)

## What finished looks like

The app's Token Usage value-view shows the design's "how we estimate the value" method
footnote, as a quiet hairline note under the usage-history list (beside the blended Value
column it explains), above the measurement table. A render check asserts it.

## The call (design owner: Mona Lisa, 2026-09-13)

#2840's literal deliverable (usage-history list + blended Value column) was already shipped
by PR #2974, and the surrounding value-view (four cards, chart, output-only money box,
table) by #2617. The ONE spec-aligned gap was this method footnote (the app had zero METR
copy). Mona's ruling settled the two open questions:

1. **It belongs to the blended Value column, not the money box.** The per-row Value column
   IS a blended figure (all four classes at a blended knowledge-work rate, web/index.html
   ~12511). The money box already names its own OUTPUT basis, so a METR note there would
   describe the wrong number. So the footnote sits with the Value column.
2. **Treatment: quiet, not a callout.** One top hairline, muted --k-ink-2, no box/border/
   radius, no left color-rule (the design's .method treatment). Method-level copy with NO
   pinned $/hr (which would go stale; the figure already shows in the column), and the METR
   URL verbatim from design/token-value.html.

## What I rejected, and why

- **Framing the footnote around the output-only money box** (my first read). Rejected: the
  money box names its own output basis; the blended Value column is the figure that needs a
  method note. Mona corrected this premise.
- **Porting the design's blended hero / stat boxes / pie / day-count.** Rejected: #2617 and
  Mona's ruling deliberately dropped the blended HEADLINE; pulling those in would reintroduce
  the forbidden single blended total.
- **A new browser-check.** Rejected in favour of extending render-token-usage-2617.js (the
  existing check for this exact section), keeping the assertion beside its siblings and
  avoiding a new-check count bump.

## Weakest premise

The footnote copy is the design owner's call, and copy is reversible (Josh eyeballs in-app).
I built Mona's exact wording; if she or Josh want different words, it is a one-line change.
What would change my mind on placement: if the Value column moved out of the history list.

## Verification (this session)

- The real page-layer gate (tools/browser-checks.sh) passed, and render-token-usage-2617's
  nine footnote assertions all pass: the element renders, exact copy, the exact approved METR
  URL, a top hairline, NO left color-rule, no callout background, and placement under the
  history list / above the measurement table.
- Headless screenshot captured (representative for a static text footnote) and eyeball-
  confirmed: quiet muted note under the Value column, hairline separator, correct copy + link.
