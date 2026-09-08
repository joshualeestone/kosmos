# Plan: fix stale control in web.change-dialog.test.js (false-red on origin/main)

Branch: `chgdlg-control-fix`.

## Problem
`web.change-dialog.test.js`'s control test ("the page before this change left the dialog on
Working…") anchors its "before" reference to `git show origin/main:web/index.html`. That is a
MOVING reference. While the outcome-reporting fix (#619/#788) and the #768 interstitial (#2463)
were unmerged, origin/main was a valid pre-fix reference and the control bit. Once #2463 merged,
origin/main became the FIXED page, and the control's skip-guard -- which grepped the source for
`say(out.because || 'Changed.'` (a marker the #768 refactor removed) -- no longer matched, so the
control ran against the advanced page and produced a FALSE RED.

Impact: the only failing test in the whole node suite (5210 pass / 1 fail). It reds the full
`run-tests.sh` gate on every branch, blocking merge-on-green fleet-wide.

## Fix
Gate the control by BEHAVIOUR, not by grepping the source. Run the change against the reference;
if the result is not "Working…", the reference has advanced past the pre-fix state, so the control
skips honestly (matching the file's existing escape-hatch style). A behaviour check cannot go
stale on a refactor.

## Verification
- Against current origin/main (post-fix): control SKIPS, test file 2 pass / 0 fail.
- Against a genuinely pre-fix page (8b52626d~1, parent of the #619 commit that added the control):
  control BITES -- runs the assertion (`got.msg === 'Working…'`, `got.keep.hidden === true`) and
  passes. Same test, opposite pages, opposite branches: the control is armed, not a dead guard.
- Full node suite returns to 5211 pass / 0 fail.

## Scope / non-goals
- Test-only. Does not touch web/index.html or any product code (so it does not trip the #1720
  web/ browser-check gate).
- Does not change what the control asserts on a genuine pre-fix reference; only replaces the
  brittle source-string skip-guard with a behaviour guard.

## Decision
Behaviour-based skip over pinning a hardcoded pre-fix sha: pinning a sha keeps the control live
forever but hardcodes git archaeology that is its own fragility; the behaviour guard is minimal,
refactor-proof, and still bites against any genuine pre-fix reference (e.g. an old checkout).
Weakest premise: on current main the control is dormant (origin/main will not be pre-fix again),
which is the inherent limit of an origin/main-anchored control post-merge; the main test at line
74 is the live guard, the control was always a one-time proof-of-bite.
