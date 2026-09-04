# Plan: fix #610 - three recorded nits from #597's convergence pass

Three NITs Angel recorded (not fixed) at #597's challenge-loop bound. None affects the
#597 invariant; each is a small, independent change. "Done when: each is a small change
with the existing test green."

## nit 1 - release.sh step 9b failure message names one cause for three
The served-bundle verification loop is reached for THREE distinct failures, and the old
message ("THE SERVED BUNDLE IS NOT THE TREE THAT WAS TESTED ... AFTER SIX READS") named
only the content-mismatch one, so a corrupt download or a persistent curl failure read as
a tree mismatch.
- The three causes are already distinguishable: curl failing (download/network),
  `release_bundle_matches_tree` rc 2 (unreadable/malformed/missing app|bin member), rc 1
  (per-file content mismatch).
- Fix: split the combined `curl && release_bundle_matches_tree` condition so each attempt
  records which cause it hit; capture the function's rc set-e-safely (`_m=0; fn || _m=$?`);
  name the cause in the final message. Success path and retry/sleep behavior preserved; a
  curl-failed partial file is never fed to the comparator (the `if ! curl; then ... continue`).

## nit 2 - cleanup trap was EXIT-only
A Ctrl-C/kill could skip the site-restore/thaw cleanup.
- Fix: `trap 'exit 130' INT; trap 'exit 143' TERM` beside the EXIT trap, converting a
  signal into a normal exit that runs the current EXIT trap once AND stops the cut.
- Rejected: `trap ... EXIT INT TERM`. A returning signal trap does NOT exit (bash resumes),
  so that shape would run cleanup on Ctrl-C and then carry the cut on regardless - worse than
  the status quo. (My first rationale wrongly said it "double-fires"; I tried to test that,
  the control failed - measured 1, not 2 - and I corrected the rationale and dropped the test.)
- The INT/TERM traps are separate from the EXIT trap, so they survive its later replacement
  by the full site-restore/thaw trap. `exit 130/143` makes `_rc=$?` land as 130/143 so
  `cut_record_done` classifies it `killed` with the right signal.

## nit 3 - release-freeze.sh comparator was content-only (cmp)
An executable-bit drift on a byte-identical file (bin/kosmos served non-executable, will
not run) was invisible.
- Fix: a portable `-x` XOR exec-bit check alongside cmp, guarded on tree-file existence. A
  no-op for non-executable files (both sides non-exec). Fires for every tree-compared
  member (also guards app/bin/kosmos-report-hook.sh, tracked 100755).
- Out of scope (noted in the comment): the two checksum-verified binaries (kosmos-tunnel,
  kosmos-app) `continue` on their sha and have no tree copy to read a mode from, so asserting
  THEY are executable is a separate guard - the same failure mode, left uncovered by #610.

## Tests
nit 3 has a direct test in tools/test-release-detached.sh (an exec-bit drift on a
byte-identical bin/kosmos is caught, with a same-content-same-mode control, and the fixture
is chmod-restored). nits 1 and 2 live in release.sh's main body (not unit-testable without
running a real cut) - verified by `bash -n` + the existing release-detached/site-restore/
frozen-roots suites staying green + the reasoning above. I could not add a reliable SIGINT
test for nit 2 (no `timeout`/`gtimeout` on the build box); nit 2 is the canonical
signal->clean-exit idiom.

## Review
challenge-loop, converged iteration 1 (zero blocker/warning/convention). Iter-1 NITs: a
stale line-number in my nit-2 comment (fixed, de-referenced) and my nit-3 comment
underselling the check's scope (fixed, now documents the report-hook coverage + the
tunnel/app carve-out). Full suite 65/65.
