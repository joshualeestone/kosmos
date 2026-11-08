# nextv-0799: test-pointer-freeze asks release.sh for a version it accepts after 0.N.99 (kosmos#8254)

## Problem
Since 65c80ad96e (0.7.99), tools/test-pointer-freeze.sh's release.sh arm asked for 0.7.100 (patch + 1). release.sh's
version guard refuses it (0.7.99 ends the 0.7 line; next is the 0.8 line), so the arm stopped before its cut-only home
and shell 2/2 went red on main, every PR and the 0.7.99 cut (Baron stopped the cut).

## Fix
NEXTV follows release.sh's own rule: at a patch of 99 or more comes 0.(N+1).00; otherwise the next two-digit patch.
Review round 1 found the SAME naive formula in tools/test-whats-new-early-7349.sh (the next link in the shell chain;
measured: origin/main's copy fails "0.7.100 is past the end of the 0.7 line" on three arms). Both tests now carry one
identical NEXTV-RULE line, and test-pointer-freeze.sh checks the two lines match (mutation: alter one, it goes red).
tools/promote-check-legs-7933.sh keeps its naive + 1 on purpose: it only needs a version other than staging's.

## Can still fail
The arm's existing check, "release.sh made its cut-only home", goes red whenever release.sh refuses the number the test
picks, so a later change to the rule is caught. Control: origin/main's copy of the test, run in this tree, fails exactly
as CI does ("made no cut-only home"); this branch passes all 55 checks.

## Weakest premise
That release.sh accepts 0.8.00 here. That is measured by this run (the arm reached its home), not assumed.
