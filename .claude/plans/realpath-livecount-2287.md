# Plan: #2287 - the opt-in REALPATH live_count parses a message token the guard no longer emits

## Problem
test-browser-run-guard.sh's live_count helper parsed the guard's refusal for " live; first: " and a
"Mac (<n> live;" COUNT, but the guard's current message (cut-guard.sh:301) is a single <detail> with
no count. So live_count returned 0 for every caller, and the KOSMOS_BC_REALPATH delta assertion
(theirs -eq mine+1) was always 0 != 1 -> the opt-in real-path arm would FAIL. Found in the #2271 blind
review (pre-existing; out of scope there). The arm is opt-in (skipped by default, never in a cut), so
this affects only a person running the manual idle-box diagnostic.

## Decision (mine, reversible; test-only)
Key on the guard's EXIT CODE, not its message text - rc is the guard's actual verdict and cannot drift
with wording. Rename live_count -> live_refuses (1 if the guard refuses for a caller, 0 if not). The
real-path arm becomes a boolean pair: on the documented IDLE box, `theirs` refuses AND names the decoy
(browser-checks.sh) - the shipped pgrep saw the real decoy - and `mine` does NOT refuse (the #1391
subtree exclusion dropped the decoy for its own ancestor). Both claims the old delta proved.
Trade-off: the old count-delta cancelled a background page layer on a not-idle box; the rc pair does
not, so on a not-idle box `mine` may refuse and the arm fails loudly. Accepted: the arm is opt-in and
documented idle-only, and a loud fail ("is the box idle?") beats a silent count-parse that never fired.

## Verification
- Added a DEFAULT-runnable seam test for live_refuses (probe-live -> 1, probe-quiet -> 0), so the fix
  is validated on any box (the real-path arm stays opt-in, spawns a real decoy, cannot run on a shared
  box). Both seam arms pass; red-capable (the old text-parse would print 0 for probe-live).
- The real-path arm's real-decoy path is unchanged except the parse; it uses the seam-tested helper.
  It cannot be run on this shared box (the decoy would trip other agents' cut guards), which is exactly
  why it is opt-in and why the seam test carries the validation here.
- No source change (test-only).


## iter1 review disposition (converged)
No BLOCKER/WARNING/CONVENTION. 5 STRENGTHs: rc keying correct + $? reflects the function return (not
the redirect); rc=2 is moot by construction (the guard returns only 0/1 - "could not tell" is mapped
to return 1 at cut-guard.sh:297 - and the real-path arm uses the pgrep 0/1 path anyway); the seam arms
run in the DEFAULT path and are red-capable; no silent-pass risk in the real-path pair (a background
run makes mine==1 -> loud fail, never a false pass; the dropped delta only removes the ability to RUN
on a non-idle box, never converts a fail to a pass). One NIT (the has-check in the first arm slightly
duplicates the next arm) - harmless, adds specificity, not actionable. Converged on iter1.
