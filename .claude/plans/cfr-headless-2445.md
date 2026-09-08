# Plan: make click-first-run headless-robust (#2445 follow-up)

Branch: `cfr-headless-2445`

## Problem

The `docs/browser-checks/click-first-run.js` browser check was dropped from the CI
browser-checks allowlist (during #2445) after it timed out on the headless
macos-latest runner:

```
page.click: Timeout 30000ms exceeded.
  locator resolved to <button hidden="" id="fr-next" ...>Next</button>
    - element is not visible
```

That was diagnosed as a SwiftShader paint weakness ("a timeout bump cannot fix a
button that never paints") and the check was left at the headed cut-time 3b run only.

## Root cause (measured, not inferred)

The diagnosis was wrong. `hidden` is a DOM attribute, not a paint/compositor state.
`#fr-next` is **deterministically hidden** by the Model step (S5): when the
subscription is not `connected`, `frPaintSubscription()`'s non-connected arm
(web/index.html) calls `frActions(null, { label: 'Skip connecting a model', ... })`,
which sets `next.hidden = true` and offers the sole forward action on `#fr-alt`.

- A machine signed into Claude reports subscription `connected` -> `#fr-next` shows
  "Next" -> the walk's `page.click('#fr-next')` works.
- A clean machine (every CI runner, and a real fresh install) reports not-connected
  -> `#fr-next` is hidden, only the `#fr-alt` "Skip connecting a model" link is
  forward.

`advanceToAnchor` only ever clicked `#fr-next`, so it passed on the signed-in build
box (headed cut 3b, and local runs) and timed out on the clean runner. A
false-green machine, exactly the class the browser-checks header warns about (the
board reads the operator's real Claude login for the subscription check, which no
CONFIG_ROOT isolation covers).

Confirmed by pulling the CI failure log (the hidden `#fr-next` markup) and by
reproducing the identical failure locally: forcing the not-connected arm (mock
`/api/first-run` subscription state `unknown`) reproduces the exact timeout.

## Fix

`advanceToAnchor` now clicks whichever control is actually forward:

1. `#fr-next` when usable (visible + enabled) - preferred.
2. else if `#fr-next` is disabled: throw the kosmos#1801 required-answer-gate
   diagnostic (a gated step this walk does not handle).
3. else if `#fr-alt` is usable: click it (the S5 "Skip connecting a model" link,
   the only forward-alt case in a straight walk to `#fr-success`).
4. else: throw "no forward control ... the step painted no way onward."

A settle-wait (`waitForFunction` on atTarget OR a usable forward control, 6s) absorbs
any brief async before reading the step's state.

`#fr-next` is preferred, so the connected arm (whose `#fr-alt` is "Check again", NOT
forward) is still driven by its Next. `#fr-alt` is reached only when `#fr-next` is
unusable, which in a straight walk is only ever the S5 Skip.

## Alternatives rejected

- **Mock `/api/first-run` subscription `connected` in section 1** to force the
  connected arm deterministically. Rejected: it would test the less-representative
  path (a signed-in machine) and never the clean-machine Skip walk, which is what a
  real fresh install and every CI runner actually hit. Clicking the actual forward
  control tests both arms faithfully.
- **Assert the `#fr-alt` label matches `/Skip/` before clicking** (a reviewer NIT).
  Rejected: couples the check to this exact label wording; a benign reword would
  break it. A future non-forward alt fails benignly today (the loop throws "never
  reached ... in N advances", never a false green).

## Additive-safety

Other sections that call `advanceToAnchor` (4/6/9) mock subscription `connected`, so
`#fr-next` is always usable for them -> no behavior change. Sections 6/12 target
anchors at/before S3, so the S5 subscription state never affects them.

## Test plan

- RED: unfixed helper + not-connected arm -> reproduces the exact CI timeout.
- FIX + not-connected arm -> passes (walks the S5 Skip link).
- FIX + unmocked/connected -> passes (drives `#fr-next`). Both "all clear", exit 0.
- Browser-check meta-guards green (selectors / wired / reason-grep).
- Full validation suite green.

## Follow-up (not in this PR)

Re-adding `click-first-run` to `KOSMOS_BC_CI_ALLOWLIST` in `browser-checks.yml` is a
one-line change gated on #2457 landing that allowlist + workflow to main (the
browser-checks CI does not run on main yet). This PR fixes the check so it *can*
rejoin; landing it first also removes the false-green-machine fragility at headed
cut 3b.
