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
  path as an argument counts (fail toward busy); only the queue's own waiter is carved out (the FIRST word
  ending in .sh being a queued-heavy.sh in any directory: tools/, or the installed copy agents actually
  run, ~/.cache/claude-handoffs/queued-heavy.sh; this also covers a lead that ps split at a space; a
  queued-heavy.sh after the lead script is just an argument), because the
  waiter starts the real run as its own process when its turn comes, and that run counts.
- The per-cut wrapper (outside the repo, mortals:~/.cut-07NN.sh) sources the Mortals main checkout's
  cut-guard.sh, so 0.7.28's wrapper calls `kosmos_running_lines tools/browser-checks.sh` and treats rc 2
  as "still running". MERGED IS NOT IN EFFECT: the wrapper reads mortals:~/work/agent-workforce (main),
  and tools/queued-heavy.sh loads its guards from ~/work/kosmos-bc-main-4610 (or the main-checkout
  fallback), so each of those checkouts must be pulled to a main holding this merge before it applies.

## Rejected
- Matching on a node child (as the wrapper's suite check does): browser-checks.sh's first seconds have no
  node child, and a run would be missed then.
- Changing queued-heavy's argv only (#5467's fix): it cannot reach the parent shell, which the harness owns.

## Weakest premise
That every real run starts its command line with the interpreter. A run started as `./tools/browser-checks.sh`
(exec by shebang) shows `/bin/bash ./tools/browser-checks.sh`, which matches, as do shell options before the
script, including +x, a bare --, the value-taking -o/-O NAME and --rcfile/--init-file FILE. Not seen:
a `zsh tools/...` run (nothing starts one), and a run whose script PATH contains a space, which pgrep
prints split (the replaced guards had the same gap; heavy-gate.sh counts it; every checkout this fleet
cuts or tests from is space-free). _kosmos_drop_test_fixtures still reads a fixture's script without the
options group, so an optioned fixture can only be dropped by ancestry or cwd: more refusals, never fewer. macOS only: Linux's `pgrep -fl` prints process names.

## Tests
- `tools/test-running-anchor-5470.sh`, in test:shell, real processes and a unique script name per run:
  nothing running gives 1; a queued-heavy-shaped waiter, its `sh -c` parent, a mention kept on a command
  line and a `-c` string naming the script are NOT runs (with a control that the unanchored pgrep DOES
  match all four); `bash tools/<script>`, `/bin/bash /abs/tools/<script>` and `bash -x tools/<script>`
  `bash -o pipefail tools/<script>` ARE runs; a failing pgrep or no script gives 2. Each spawned pid is
  awaited in pgrep (up to ~5 s), not a fixed sleep. Shapes that cannot be held open (bash -n exits at
  once) are read through a stubbed pgrep: -n, -xn and -lc are not runs; -eo NAME, +x, -- and --rcfile ARE. Measured red: anchor removed gives 3 failures.
- tools.heavy-gate-3805.test.js gains a #5470 case: a waiter line (also under a spaced checkout path) does
  not count, nor one using the installed ~/.cache/claude-handoffs/queued-heavy.sh or ./queued-heavy.sh;
  the run the waiter starts (with the waiter as its ancestor) does; a queued-heavy.sh that is
  only an argument after another script does not stop that script's heavy path counting. Its sh -c parent is a
  command string, which heavy-gate already never counted.
- Existing guards pass: test-cut-guard, test-browser-run-guard (and its real-path control,
  KOSMOS_BC_REALPATH=1), test-browser-gate-cut-claim-1398, test-machine-claim-1962, test-light-side-4911,
  tools.heavy-gate-3805.test.js.
