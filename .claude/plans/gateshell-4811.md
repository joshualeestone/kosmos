# #4811: the browser-check gates cannot pass falsely when sourced into the agent's shell

Card: joshualeestone/kosmos#4811 (claimed:angel; found by Pigeon Pete on PR #4805). Branch gateshell-4811 off main.

## What finished looks like
Sourced into any shell, including the agent's own zsh, each browser-check gate gives the same answer it gives
under bash, so an agent's local check can no longer be green where CI is red.

## Cause (measured)
On PR #4805 at c609886ab the surface gate refused under `bash -c` and under `zsh -c`, and PASSED when sourced in
the Claude Bash tool's own zsh. The difference between the two zsh runs: in the agent shell `grep` is a function
(from the Claude Code shell snapshot) that runs ugrep with --ignore-files, -I and other options, so the gate's
matches differ. A fresh zsh has no such function. (The card guessed zsh word-splitting; that class is already
handled, see test arm 9.)

## The change
- tools/lib/browser-check-surface-gate.sh and tools/lib/browser-check-gate.sh record their own absolute path when
  sourced. Each gate function, when BASH_VERSION is empty, says so on stderr and runs itself in a fresh bash
  (`env <settings> bash -c '. <lib> && <gate>'`), returning that answer. The five KOSMOS_BCG_* / KOSMOS_BCSG_*
  settings are handed over explicitly, each only when set (review 1: a plain unexported zsh variable did not reach
  the child bash, which then checked the real branch and could pass). Measured: plain, exported and prefix settings
  all refuse an unchecked change and pass a compliant one.
- Under bash nothing changes.

## Decisions
1. Re-run under bash rather than refuse (the card's ask was refuse). Both make a false green impossible; the re-run
   gives the agent the right answer the first time. Rejected: refusing (an extra step every time), and replacing
   each `grep` with `command grep` (fixes this function but not the next ambient difference; the gates are bash
   programs and should run as bash).
2. Both gates get the guard. The coarse gate's verdict does not run through grep (its one grep picks a merge base,
   only without the seams), so it was not wrong on #4805; the guard is for consistency and the next difference.
WEAKEST PREMISE: that `bash` on PATH is a sane bash. On this Mac it is /bin/bash 3.2 while CI runs a newer bash; both
pass the gate tests. Under `setopt nofunctionargzero` or `emulate sh` the recorded path is wrong and the re-run fails
closed (rc 1, a cryptic error), never open; normal zsh records it correctly (measured by review 1).

## Tests
- tools/test-browser-check-surface-gate.sh 9b: sourced into zsh with a grep that matches nothing, the gate still
  refuses a surface-mapped change; CONTROL: the same lying grep, believed in-process under bash, passes it. With the
  guard removed, the arm fails (checked).
- tools/test-browser-check-gate.sh: sourced into zsh, an unchecked web change is still refused and the gate says it
  re-ran under bash; CONTROL: under bash, no re-run.
- Review 1: in both files, settings given as plain zsh variables still refuse, and a POSITIVE control (a compliant
  change) passes through the re-run, so a broken re-run cannot read as a refusal. Mutants, each failing a test in both
  gates: no explicit forwarding at all; a broken recorded path.
- Review 2: an arm per forwarded setting, where only that value (a plain zsh variable) flips the verdict:
  KOSMOS_BCG_MSGS (a trailer or override excuses), KOSMOS_BCSG_DIR (an empty checks folder maps nothing),
  KOSMOS_BCG_BASE (a throwaway repo where the default base refuses and HEAD passes, with a control). Dropping each
  forward ALONE fails a test in every gate that reads that setting (the coarse gate does not read the two
  KOSMOS_BCSG_* settings, so dropping those there changes nothing, as expected).
- Run from the repo directory (the gates read docs/browser-checks relative to it): both files pass in full.
  test-bc-surface-map.sh, test-ci-gate-armed-2518.sh and test-browser-check-surface-map.sh pass.

## Review
Round 2: no blocker; 2 should-fix (three forwards unpinned by any test; the plan overstated the mutant coverage),
taken; nit noted (a clearer message when the recorded path is wrong under emulate sh: it already fails closed).
Round 1: 1 blocker (plain zsh variables did not reach the re-run), taken; 1 should-fix (no positive control through
the re-run), taken; nits recorded above (path under emulate sh fails closed; bash 3.2 vs CI's; dash never could
source these libs).
