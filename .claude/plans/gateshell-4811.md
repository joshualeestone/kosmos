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
  (`bash -c '. <lib> && <gate>'`), returning that answer. KOSMOS_BCG_* and KOSMOS_BCSG_* settings reach it as
  exported variables (a zsh prefix assignment exports for the call; measured with KOSMOS_BCG_BASE=no-such-ref).
- Under bash nothing changes.

## Decisions
1. Re-run under bash rather than refuse (the card's ask was refuse). Both make a false green impossible; the re-run
   gives the agent the right answer the first time. Rejected: refusing (an extra step every time), and replacing
   each `grep` with `command grep` (fixes this function but not the next ambient difference; the gates are bash
   programs and should run as bash).
2. Both gates get the guard. The coarse gate's verdict does not run through grep (its one grep picks a merge base,
   only without the seams), so it was not wrong on #4805; the guard is for consistency and the next difference.
WEAKEST PREMISE: that `bash` on PATH is a sane bash. On this macOS fleet it is /bin/bash (3.2) or Homebrew bash,
both of which run these libs today under CI and run-tests.sh.

## Tests
- tools/test-browser-check-surface-gate.sh 9b: sourced into zsh with a grep that matches nothing, the gate still
  refuses a surface-mapped change; CONTROL: the same lying grep, believed in-process under bash, passes it. With the
  guard removed, the arm fails (checked).
- tools/test-browser-check-gate.sh: sourced into zsh, an unchecked web change is still refused and the gate says it
  re-ran under bash; CONTROL: under bash, no re-run.
- Run from the repo directory (the gates read docs/browser-checks relative to it): both files pass in full.
