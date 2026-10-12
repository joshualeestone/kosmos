# rerunrefuse-5932: a cut refuses an exported KOSMOS_SUITE_RERUN_CMD

Card kosmos#5932 (Renet Tilley, 07:5x, from the #5907 follow-up review).

## Change
- tools/release.sh step 1c, right after the #5137 notarise-seam loop: if KOSMOS_SUITE_RERUN_CMD is set (`${..+x}`,
  so an EMPTY export counts), print "... is set in this shell (even an empty value counts) ... (#5932): unset it and
  run again." and exit 1. Same message shape as the notarise loop, its own sentence (that loop's says "notarises").
- KOSMOS_SUITE_RERUN_SLEEP is NOT refused (it only paces reruns; a leftover leans toward abort). Neither is
  KOSMOS_SUITE_RERUN_MAX: it is not on main yet; Renet's rerunbudget-5907 branch adds it as an operator setting.

## Why its own block, not the notarise loop
That loop's message is about notarising ("A cut always notarises the app binaries for real"); one more name in it
would print a false reason.

## Verify
- tools/test-cut-rerun-guard.sh (already in package.json test:shell, so it is wired): new arms extract the real guard
  from release.sh and run it:
  - it sits before step 2's bump and before step 3's rerun use (732 < 788 < 1039);
  - `=true` refuses with its sentence;
  - an empty export refuses;
  - MAX and SLEEP alone pass;
  - a clean env passes (the control).
- When the anchor is missing, the behaviour arms are SKIPPED with a FAIL. The first version fell back to line 1 and
  ran the top of release.sh (it printed usage and exited, harmless, but never again).
- Mutants:
  - the refusal exits 0: red at the =true and the empty arm;
  - `+x` changed to `:+x` (an empty export passes): red at the empty arm only;
  - a reshaped guard line: red as "missing", nothing executed.

## Weakest premise (the card's)
That nothing between step 1c and step 3 re-exports the seam. Grep on release.sh: no export or assignment of
KOSMOS_SUITE_RERUN_CMD anywhere in it. A refusal at 1c cannot be undone by a later step unless release.sh itself
sets it, which it does not.

## Review 1 (opus, 2026-10-12 08:05)
- **SHOULD-FIX, taken:** KOSMOS_SUITE_RERUN_MAX does not exist on main; it comes from Renet's unmerged
  rerunbudget-5907 (c0a6d4261, 7 refs in cut-rerun-guard.sh). Still allowed (the card asks it), and the comment, plan and
  arm now say where it comes from instead of implying it is read today.
- Confirmed: no exec/re-exec in release.sh, nothing assigns the seam; cut-rerun-guard.sh's only other seam (SLEEP) is
  harmless.
- **Out of scope, reported on the card:** a leftover KOSMOS_TEST_PART with KOSMOS_TEST_PART_LOCAL=1 narrows step 3's own
  suite (run-tests.sh:35-46); release.sh does not refuse it. Same class, different mechanism.
- **NITs, not taken:** the order arm compares line numbers (the column-0 anchor makes a guard nested in a branch
  unlikely); a `fi` with a trailing comment would over-extract, but that fails loud (undefined function, exit 1) with no
  side effect.

## Review 2 (sonnet, 2026-10-12 08:06): CONVERGED, no blocker or should-fix
- **NITs, taken (wording):** the message says the contention RERUN runs the real suite (a cut reruns only on a
  contention red); the comment no longer names a speculative source for the leftover export; the lib's seam list says
  release.sh refuses it.

## After main moved (2026-10-12 09:58)
Renet's rerunbudget-5907 merged, so KOSMOS_SUITE_RERUN_MAX is on main now. Merged main in; the one conflict was the
seam list in tools/lib/cut-rerun-guard.sh (both sides edited the same comment lines), resolved to main's wording plus
this branch's refusal note. The release.sh comment no longer calls the setting unmerged. Guard test: ALL PASS on the
merged tree.
