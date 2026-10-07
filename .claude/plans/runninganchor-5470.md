# runninganchor-5470: one anchored "is <script> running" helper for the cut path

Card: #5470 (filed by Angel; Splinter 05:52 10-07: land before the 0.7.28 cut). Branch: runninganchor-5470.
Owner: Baron Draxum.

## Why
On the 0.7.27 cut a hand-written wait (`pgrep -f "tools/browser-checks\.sh"` in Baron's per-cut wrapper)
read a tools/queued-heavy.sh waiter as a running browser check, and the waiter was waiting for the same
machine: a deadlock (#5467). #5467 takes the wrapped command off the waiter's own command line, but the
`sh -c "... bash tools/browser-checks.sh"` shell that started the waiter still carries it. So any
unanchored `pgrep -f` stays exposed.

## Decided
- `kosmos_running_lines <script>` in tools/lib/cut-guard.sh: the "<pid> <command>" lines whose command
  STARTS with `[path/](ba)sh [options] [path/]<script>[ args]`, options being flags like -x or --norc but
  never a cluster holding c (a command string) or n (a syntax check). Returns 0 (running), 1 (not running),
  2 (pgrep failed, or no usable script named): the three outcomes the callers already used.
- EVERY "is X running" check in cut-guard.sh now calls it: the cut (release.sh), the install harness
  (test-install.sh), the suite candidates (run-tests.sh), the browser gate and the side-turn intruder check
  (browser-checks.sh). Before, five hand-written copies used two different interpreter patterns; the
  helper takes the wider `([^ ]*/)?`, which only ever adds candidates (a Homebrew bash), failing toward busy.
- tools/heavy-gate.sh (what cutters run for a quiet box) classifies a command whose lead script is
  tools/queued-heavy.sh as a waiter, not a run. It keeps its deliberate rule that a script taking a heavy
  path as an argument counts (fail toward busy); only the queue's own waiter is carved out, because the
  waiter starts the real run as its own process when its turn comes, and that run counts.
- The per-cut wrapper (outside the repo, mortals:~/.cut-07NN.sh) sources this cut-guard.sh, so 0.7.28's
  wrapper calls `kosmos_running_lines tools/browser-checks.sh` and treats rc 2 as "still running".

## Rejected
- Matching on a node child (as the wrapper's suite check does): browser-checks.sh's first seconds have no
  node child, and a run would be missed then.
- Changing queued-heavy's argv only (#5467's fix): it cannot reach the parent shell, which the harness owns.

## Weakest premise
That every real run starts its command line with the interpreter. A run started as `./tools/browser-checks.sh`
(exec by shebang) shows `/bin/bash ./tools/browser-checks.sh`, which matches, as do shell options before the
script. A `zsh tools/...` run, or an option that takes a value (`bash -o pipefail tools/...`), would not,
and nothing in the repo starts one that way. macOS only: Linux's `pgrep -fl` prints process names.

## Tests
- `tools/test-running-anchor-5470.sh`, in test:shell, real processes and a unique script name per run:
  nothing running gives 1; a queued-heavy-shaped waiter, its `sh -c` parent, a mention kept on a command
  line and a `-c` string naming the script are NOT runs (with a control that the unanchored pgrep DOES
  match all four); `bash tools/<script>`, `/bin/bash /abs/tools/<script>` and `bash -x tools/<script>`
  ARE runs; a failing pgrep or no script gives 2. Measured red: anchor removed gives 3 failures.
- tools.heavy-gate-3805.test.js gains a #5470 case: a waiter line and its sh -c parent do not count; the
  run the waiter starts (with the waiter as its ancestor) does.
- Existing guards pass: test-cut-guard, test-browser-run-guard (and its real-path control,
  KOSMOS_BC_REALPATH=1), test-browser-gate-cut-claim-1398, test-machine-claim-1962, test-light-side-4911,
  tools.heavy-gate-3805.test.js.
