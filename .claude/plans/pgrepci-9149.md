# pgrepci-9149: the rest of #9149's class, off the validation and promote path

## Why
#9184 put pgrep and awk under LC_ALL=C on the gate, cut and queue paths. The same failure (pgrep exits 3, macOS awk exits
2, whenever any process has a command line that is not valid UTF-8) remained in the CI runner tools and clean-machine.

## Plan
- [x] tools/ci-runner-setup.sh: `pgrep() { LC_ALL=C command pgrep "$@"; }` covers its bare pgrep calls.
- [x] tools/ci-runner-claim-pause.sh: both "$PGREP" calls under C.
- [x] tools/clean-machine.sh: both sandbox sweeps under C (no test file exists for it).
- [x] Review 1: verify's awk over `ps -U <ci user> -o args=` under C (it ended verify under set -e).
- [x] Arms: a stand-in pgrep that refuses unless LC_ALL=C (preflight still clear; a cut claim still pauses), a stand-in ps
      line whose first word holds \377 (verify still reaches its verdict). Tests unset LC_ALL. Each red without its fix.
- [x] Review 2: the verify arm's byte had been an env -i ARGUMENT (a live argv on the shared Mac): the stand-ins now decode
      ASCII escapes (FX_PS_ESC, FX_LIVE_ESC). preflight's refusal tr under C, with an arm read under C (the test's own
      grep skips such a line in UTF-8). A second verify arm: a node line with the byte in a later word.
- [x] Review 3: no BLOCKER or SHOULD-FIX (converged).
- [ ] Proof, PR, merge on green (after the 0.8.27 hold).

## Decisions
- DEFERRED, a slice of its own: the job-cleanup hook's pgrep. The hook is written out as job-cleanup.sh and verify
  compares it byte for byte, so changing its text reports every installed runner as rewritten until each is reinstalled.
- Not changed (review 3 NIT): claim-pause's sed and grep over `launchctl print` output, which describes the runner's own
  LaunchAgent, not other processes' command lines.
- No arm for clean-machine.sh: it has no test file; the change is one word on two lines.
- Weakest premise: that no other locale-sensitive reader of argv remains in these scripts; review 1 swept them and named
  only the two above (its grep note: macOS grep -E also misses lines with a bad byte, but none here reads argv).
