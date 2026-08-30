# #1391: re-arm the concurrent-page-layer guard, correctly

## The card
`kosmos_refuse_if_browser_run_live` (in `tools/lib/cut-guard.sh`) refuses a page
layer when another browser-checks run is already live, so two concurrent
Playwright runs cannot starve each other and kill a cut. It was **disarmed** on
2026-08-27 because, when armed, it threw a false positive (reporting "1 live"
while nothing else ran) which cost a cut. The disarm note asked whoever re-arms
it to **reproduce the false positive first**. The note guessed the cause was
"`$$` does not change inside a subshell"; it flagged that guess as unconfirmed.

## Reproduced (deterministically, no Playwright)
A stub `tools/browser-checks.sh` that sources the real guard, invoked the way
release.sh does (`( cd && bash tools/browser-checks.sh <args> )`), which forks a
non-exec'd subshell that inherits its argv:
```
self ($$) = 14092 ; a non-exec'd subshell child 14094 carries the same argv
pgrep -fl 'browser-checks\.sh' -> ONLY 14094  (14092 is pgrep's ancestor, invisible)
guard -> "another browser-checks run is already live (1 live; first: 14094 ...)" -> REFUSE
```

## Root cause (the named cause was wrong)
Two interacting facts:
1. **macOS `pgrep -f` never lists its own ancestor.** The guard runs *inside*
   browser-checks.sh, so pgrep cannot see the browser-checks.sh process. The
   `$$` self-exclusion targeted a line pgrep never returned (dead code).
2. **A run forks bash subshells that inherit its argv with fresh pids.** Any
   `( a; b )` / background job / `$( )` that does not immediately exec keeps the
   parent's command line under a new pid. Those are the caller's own descendants,
   matched by pgrep, and a single-pid exclusion cannot drop them.

The guard conflated the cut's OWN page-layer subtree with a second run.

## The fix
Exclude the caller's whole **subtree** (self + descendants), not one pid
(`_kosmos_drop_self_subtree` + `_kosmos_pid_is_self_or_descendant`, walking a
candidate's parent chain to `self`). A matching pid inside the caller's subtree
is THIS run; only a pid outside it is a genuinely separate run. Then **re-arm**
it in `browser-checks.sh`, mirroring how release.sh arms the cut guard
(`KOSMOS_HARNESS_IGNORE_CUT=1` overrides).

## Tests
- Two default (non-opt-in, no browser process, safe on a shared Mac) seam+real-pid
  arms: a candidate that is the caller's descendant is excluded (#1391); the same
  shape from an unrelated caller still refuses (mirror).
- The opt-in real-path control reworked to a **delta** (`theirs - mine == 1`)
  robust to a colleague's concurrent run: a real decoy adds one for an unrelated
  caller and zero for its own ancestor.
- A static assertion that `browser-checks.sh` actually calls the arm, so a
  re-disarm turns a test red (the arm/disarm history is why this matters).
- All existing seam arms unchanged and passing.

## Scope
Fixes the **browser guard** (the card). The **cut guard** shares the identical
single-pid flaw but has not bitten because release.sh calls it at its very top,
before any argv-inheriting subshell exists; it is left unchanged here to keep an
armed, load-bearing guard out of scope, with a code comment and the shared helper
ready for a focused follow-up.

## Verification
- `tools/test-browser-run-guard.sh` default + `KOSMOS_BC_REALPATH=1`: all pass.
- `tools/test-cut-guard.sh`: 10/10 pass, 0 failures (cut guard unbroken).
- `tools.release-gate.test.js`: 22/22 pass.
- The original reproduction against the fixed guard now returns 0 (no false positive).
