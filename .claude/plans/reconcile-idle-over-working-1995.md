# Plan: reconcile-idle-over-working-1995

Addresses **kosmos#1995** (filed while mapping #1965).

## Problem

`reconcileReport` (`engine/status.js`) resolves a reported `idle`/`started` to `IDLE`
at its fallback, regardless of the scraped screen state. Every OTHER scraped non-idle
state already outranks a reported idle:

- scraped `stopped` -> rule 2
- scraped `auth_failed` / `rate_limited` -> rule 3b
- scraped `needs_you` -> rule 3

`WORKING` is the one scraped non-idle state with no guard, so an agent whose screen
shows a live working spinner while its last report was `idle` reads on the board as
"at rest and nothing is needed", with no conflict surfaced.

`classify` returns `WORKING` only on a live spinner (`SPINNER` title / `INTERRUPT_LINE`
"esc to interrupt" / `WORKING_LINE` = gerund + live timer), never on the idle footer,
so a scraped `WORKING` is active work happening now. The most common trigger is the
#1965 family (a background job keeps a live spinner while the Stop hook has already
fired an automatic idle).

## What finished looks like

1. A reported `idle`/`started` contradicted by a scraped `WORKING` reads as `WORKING`
   with the conflict surfaced -- the exact rule 3 / 3b shape
   (`{ ...scraped, reported: false, conflict }`).
2. Control that returns the dangerous answer: reported `idle` + scraped `IDLE` still
   reads `IDLE` (the guard is scoped to a scraped WORKING; it does not turn every idle
   report into working).
3. A reported `needs_you`/`blocked` still outranks a working screen (the guard sits
   below those branches and must not capture them).

## Approach

Add one guard immediately before the fallback return in `reconcileReport`, scoped to
`scraped.state === STATE.WORKING`. Placement below the reported `working`/`needs_you`/
`blocked` branches means it only affects the fallback (reported `idle`/`started`).

## Scope boundary

This does NOT fix #1965's main case: there the screen is footer-`IDLE` (backgrounded
job, no live spinner), so `classify` never returns `WORKING` and there is no screen
signal to reconcile against. #1965 needs a Stop-hook-side fix (analysis recorded on
#1965). This card closes only the reconcile asymmetry, and helps the #1965 sub-case
where the screen DOES show a live spinner.

## Test

`engine/status.test.js`, mirroring `#886`'s reconcile test: reported idle + scraped
WORKING -> WORKING with conflict; `started` too; a control (idle + scraped IDLE stays
idle); and a needs_you-still-wins guard.

## Validation

- `node --test engine/status.test.js` (was 172 pass after the change)
- full `yarn test` suite
- No `web/` change, so the #1720 browser-check gate is not triggered.
- No new test FILE, so the #1934 coverage-count assertion is unaffected.
