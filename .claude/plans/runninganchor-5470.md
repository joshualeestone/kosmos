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
  STARTS with `[path/](ba)sh [path/]<script>[ args]`. Returns 0 (running), 1 (not running), 2 (pgrep
  failed, or no script named), the same three outcomes the existing callers already used.
- The two places cut-guard.sh already anchored this by hand (the browser gate, and the side-turn intruder
  check) now call it. One regex instead of two: they differed (`(/bin/)?` vs `([^ ]*/)?` before the shell),
  and the helper takes the wider `([^ ]*/)?`, which is a superset of real runs (`/usr/local/bin/bash ...`).
- The per-cut wrapper (outside the repo, `mortals:~/.cut-07NN.sh`) sources this cut-guard.sh, so 0.7.28's
  wrapper calls `kosmos_running_lines tools/browser-checks.sh` and treats rc 2 as "still running" (wait,
  never assume quiet). That wrapper is written after this merges and Mortals' main is fresh.

## Rejected
- Matching on a node child (as the wrapper's suite check does): browser-checks.sh's first seconds have no
  node child, and a run would be missed then.
- Changing queued-heavy's argv only (#5467's fix): it cannot reach the parent shell, which the harness owns.

## Weakest premise
That every real run starts its command line with the interpreter. A run started as `./tools/browser-checks.sh`
(exec by shebang) shows `/bin/bash ./tools/browser-checks.sh`, which matches. A `zsh tools/...` run would
not, and nothing in the repo starts one that way.

## Tests
`tools/test-running-anchor-5470.sh`, in test:shell, real processes, a unique script name per run:
nothing running gives 1; a queued-heavy-shaped waiter, its `sh -c` parent and a mention are NOT runs
(with a control that the unanchored pgrep DOES match the waiter and parent); `bash tools/<script>` and
`/bin/bash /abs/tools/<script>` ARE runs; a failing pgrep gives 2. Measured red: with the anchor removed,
3 failures. Existing guards still pass: test-cut-guard, test-browser-run-guard (and its real-path control,
KOSMOS_BC_REALPATH=1), test-browser-gate-cut-claim-1398, test-machine-claim-1962.
