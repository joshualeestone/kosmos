# Plan: give the Instructions-tab stale-note its own space (#2830)

## Card
#2830 (Josh, 0.6.57 live review): on the Instructions tab, the "This file has changed since
you opened it" warning is touching / overlapping the Save button. Give it its own space.
"still" = reported before.

## Root cause
The warning is `.stale-note` (id `#d-instr-outdated`), rendered directly below the Save
button (`#d-instr-save`). Base `.stale-note` sets `margin-bottom` but no `margin-top`, so it
hugs the button above it. #1841 (Josh, 2026-09-02) fixed the exact same "touching the button,
looks sloppy" issue for the HEADER instance (`#d-instr-stale`) with a scoped
`margin-top: var(--space-5)`, and deliberately left the Instructions-tab instance untouched.
Josh's "still" is that leftover.

## The change (CSS only)
Mirror the #1841 fix, id-scoped to this instance:

    #d-instr-outdated { margin-top: var(--space-5); }

Placed right after the `#d-instr-stale` rule. Same token (`--space-5`) as the header fix, for
consistency. Base `.stale-note` is left as-is (id-scoped like #1841, so no other stale-note
instance changes).

## Test
New server.test.js assertion: `#d-instr-outdated` sets `margin-top: var(--space-N)`; control
that base `.stale-note` still has no `margin-top` of its own (keeps the fix id-scoped, matching
#1841).

## Gate
CSS-only, unit-covered. #1720 coarse browser-check: `Browser-check:` trailer. No surface
gate hit (no browser-check annotates the stale-note / instructions region).
