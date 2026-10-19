# Plan: org chart first-ring 12px line-to-face fix (#4499)

Branch: `orgchart-deeptrees-4499`. Repo: `joshualeestone/kosmos`. Card #4499.

This is a long-running card (not started via `/pplan`); this plan file records the
approach that the branch implements and that the challenge-loop reviewed. The full
diagnosis lives in the working note and the PR body; this is the decision record.

## Problem

Card #4499 names two symptoms on the org chart:

1. Deep trees render about 2x their pre-#4434 size.
2. The 12px line-to-face clearance rule is not met (a hub line grazes an inner
   face below 12px).

A categorized scan over 300 trees found 122 of 123 under-12px lines share one shape:
light first-ring roots cluster at near-equal leaf-count-slice angles, get bumped to
outer lanes (r = 120, 178, 236, 294) but keep their angle, so an outer hub line
grazes an inner face. The flat-fleet ring (#4502) already solved this for flat boards;
the tree first ring never inherited it.

## Scope decision (gated "option A")

The two symptoms are coupled: giving each first-ring root a minimum angular span
clears the line-to-face rule, but the span a light root gains is taken from a heavy
donor root whose own subtree needs that angle, so on a crowded chart the naive floor
GROWS the chart (measured: 47 roots with one 60-report root grew ~20x). Clearing the
line can cost the size.

So this PR clears the line-to-face rule **only where it can be done without growing
the chart**, measured per chart, and hands the rest (the charts that cannot be cleared
without growing, plus the standalone size work) to the size work that stays open on
this card. Measured against main, it regresses neither axis on any chart.

## The implementation

`orgPlaceGated(nodes)` lays the chart out twice: proportionally (identical to main)
and floored. It keeps the floored layout only when ALL hold:

- the chart actually has a sub-12px first-ring line (no bug -> keep main's layout,
  positions byte-identical);
- few enough roots to seat the floor (root-count ceiling, checked before the
  O(roots^2) scan);
- the floored `maxR` is within 1% of proportional (size never regresses);
- it clears 12px by the first-ring check;
- it is no worse than proportional at the first ring.

Otherwise it keeps the proportional layout. The decision is all-or-nothing per chart.

`ORG_LINE_CLEAR` (12) and `ORG_LINE_MARGIN` (6) are hoisted to module scope so
`orgPlace`, `orgFirstRingClear` and `orgPlaceGated` share one definition of the floor
and its margin (convention: one derivation of one fact). The floor formula and the
fundability ceiling are pinned to one expression so they cannot drift.

## Where it stops

With one heavy root the floor holds up to about 38 roots (fan 5), 29 (fan 20), 23
(fan 60); below about 24 roots it is size-safe almost always. Past that, and for a
chart with two heavy roots or 24+ roots with a heavy root, clearing the first ring
would grow the chart, so the chart keeps main's layout and its first-ring clearance
is left to the size work on this card. A pure-flat board is the #4502 ring, out of
this card's scope.

## Verification

- Guard test `web.org-first-ring-clear-4499.test.js` (7 tests) pins: the 12px rule,
  the floor formula (one source), size within 1% (red on the un-gated always-floor
  commit), 12px where funded by the full check (red on pre-fix main), a no-bug chart
  byte-identical to main, and a 16-shape funded/fallback sweep (honest funded,
  clearance never worse, overlap never worse, every funded chart reaching the ~18px
  floor target so 12px holds as drawn at the 0.7 squeeze).
- Four sibling org test files gain the two hoisted constants in their `orgPlace` lift
  const-list (they reference the constants unconditionally in `MIN_SPAN`).
- Full recorded suite green at the converged head (0 failures); guard in-suite about
  33.65s, within the 38s budget.
- Browser-checks: all org render checks green; the sole failure is the tracked
  federation-invite clipboard flake (#6105), unrelated.

## Challenge loop

5 blind reviewer passes (opus/sonnet rotation), converged. No code-logic defect found
in any pass; iterations refined comment honesty and test coverage. The two recurring
themes (as-drawn-vs-natural, first-ring-vs-full) are resolved and deferred respectively
(see the pre-challenge proof ledger).

Addresses #4499 (card stays open; this PR is the first-ring size-safe slice).
