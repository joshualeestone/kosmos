# ktsowner-6061: a kts- leak names the test file that was killed (#6061)

Card: joshualeestone/kosmos#6061. A full validation goes red on one `kts-*` dir with every test passing (2 known:
diagfields-5959 10-13 11:03, tkdrop-5842). A `kts-` dir is test-support/tmpscope.js's per-process TMPDIR; it is left
when its exit sweep did not run or failed (a kill it cannot catch, a process still running, an rmSync error). 214 files
require tmpscope, and the guard printed only the random suffix, so the
author could not tell which test was killed and the only move was a 35-minute re-run.

## The call (options (a) + (b) from the card)
- tmpscope.js writes `.kts-owner` into its dir: the script path relative to the cwd (real paths on both sides), or its
  absolute path (home written as ~) when it sits outside the cwd, or `(no script, <basename of argv0>)` for `node -e`;
  then a tab and `pid N`.
  Best effort: a failed write leaves the dir working as before.
- tools/lib/test-leak-guard.sh `leak_kts_owners`, called when `leak_tmp_check` reports the `kts` family: one line per
  `kts-` dir, "made by <file> (pid N); its exit sweep did not run (killed, still running, or the sweep failed)", or "no
  owner recorded" when the file is absent or empty. It reads the owner safely under `set -e` (an unterminated line from
  a kill mid-write still reports; review 1).
- The guard still fails the run. This makes the red actionable; it does not excuse it.

## Rejected
- (c) allowlisting `kts`: a killed test process is a real event (a hang the harness killed, a crash); hiding it hides
  that.
- Naming the test inside the file (which `test()` was running): tmpscope cannot know it, and the file is enough to
  re-run alone.

## Proven
- Shell (tools/test-test-leak-guard-4273.sh): an owned kts- dir is named with file and pid; an ownerless one says so;
  exactly one owner line per kts- dir and none for another leaked family (the control); the kts family still fails.
- JS (test-support.tmpscope.test.js): a real SIGKILLed process leaves one kts- dir naming its file and its own pid; `node
  -e` records no script; a file outside the cwd gets its absolute path; end to end, the real guard reads the line a
  real killed process wrote (so the two halves cannot drift on format).
- Found by the new test while building: macOS gives the cwd as /private/var and argv[1] as /var, so a plain
  path.relative climbed to the root. Fixed with real paths.
- Mutation: tmpscope not writing the owner reds all four new JS tests (the ~ test added in review 1 came later).
- Review 1: under `set -e` an empty or unterminated owner aborted the function; fixed with `|| true`, and dropping it
  reds exactly the two new set -e checks. A home path is written as ~; argv0 is its basename.

## Weakest premise
That the leftover is a SIGKILL of a test process. If the harness kills a CHILD that has its own tmpscope (a nested
`kts-` inside its parent's), the parent sweeps it and nothing leaks, so the report only ever names top-level kills.
