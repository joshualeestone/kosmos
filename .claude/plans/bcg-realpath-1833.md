# Plan: browser-check-gate real-git-path arm asserts a verdict, not rc 0 (kosmos#1833)

## Problem
The `test` CI workflow (kosmos#1794) was reported (#1833) as flaking on a tmux-server race.
Pulling the raw run logs disproved that:
- The `error connecting to /private/tmp/tmux-501/default` lines are BENIGN: measured 91 in green
  runs (33595539904, 33594289317, 33591558640) and 90-91 in red runs. `status.js:tmuxSaidNoServer`
  reads that exact string as the no-server empty and returns clean, so the tests that emit it pass.
- The sole hard failure on the cited evidence run (33594404764) was `browser-check-gate: 1 FAILED`
  -- the `test-browser-check-gate.sh` "real git path" arm asserting rc 0.

## Root cause
`tools/test-browser-check-gate.sh` line ~108: the seam-free arm ran `kosmos_browser_check_gate`
against the live branch and asserted rc 0, on the assumption "this branch touches no web/". The
gate's base is `origin/main` (`git diff --name-status origin/main...HEAD`). So:
- On main: HEAD == origin/main -> empty diff -> gate passes -> rc 0 -> green.
- On a branch that legitimately changes web/ without an inline assertion: non-empty diff -> gate
  CORRECTLY refuses -> rc 1 -> the arm asserted 0 -> false red.
Outcome is a function of the branch under test. That IS "branch red / main green, same code" (the
control Mona Lisa observed), no tmux involved. disconnect-css-1710 is a CSS/web change, so it reds
this arm on the branch and greens on its empty-diff main merge -- explaining her control exactly.

## The change (tools/test-browser-check-gate.sh only)
Replace the single branch-dependent arm with TWO base-PINNED arms, both branch-independent and
both asserted with the existing `check` helper (exact expected rc):
- base=HEAD: `git diff HEAD...HEAD` is empty on every branch, so the gate runs its real diff+log
  and returns 0 via the "no rendered change" path (NOT the fail-soft escape). Asserting exactly 0
  also catches a gate that wrongly refused an empty diff.
- base=<unresolvable ref>: `git diff <nope>...HEAD` errors, so the gate takes its fail-soft branch
  and returns 0. Exercises the no-origin/main path the old comment claimed but only reached by
  accident on a checkout lacking origin/main.

The refuse-vs-pass decision LOGIC is already proven by the seam-driven arms above (KOSMOS_BCG_FILES:
rc 1 on an uncovered web/ change, rc 0 on a covered one). These two arms only prove the real git
plumbing runs and returns the right verdict for a known input.

### Why not the first draft (`assert rc in {0,1}`)
Iteration-1 challenge WARNING: the gate fail-softs a broken git path to rc 0
(browser-check-gate.sh:59-64), so `rc in {0,1}` could not distinguish "git ran and produced a
verdict" from "git failed and was swallowed to 0" -- near-vacuous, catching only a rc>1 shell crash.
The base-pinned pair asserts an exact rc against a known input, which is strictly stronger and still
branch-independent. (Two NITs from the same review -- an imprecise "git error -> rc>1" comment, and
hand-rolling PASS/FAIL instead of the `check` helper -- are both resolved by this rewrite.)

## Verification
- `bash -n` clean; full self-test green on this branch (real-path arm hits rc 0, tools-only change).
- Reproduced the false-red: base=HEAD^ (07c11fa4, dirty-form-1786, `M web/index.html`, no assertion)
  -> real gate rc 1 -> OLD arm FAILED, NEW arm PASSES.

## Deliberately not done
- Warming a tmux server in the workflow: fixes zero reds (socket errors are benign, proven by
  control) and adds roster-pollution risk. Rejected.
- Silencing the benign socket stderr at source: an engine change with test implications; noted as a
  lower-priority cosmetic follow-up in #1833, not this PR.
- Full local `run-tests.sh`: withheld under the standing no-local-full-suite constraint (it spawns
  test-install.sh and trips the cut-guard, kosmos#1796). The `test` CI runs the full suite on push.

## Scope
Backend/test hardening, design cleared. Self-merge per beta norm; lands in the next cut.
