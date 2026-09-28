# tmpleak-4273: tests leak temp dirs, launchd jobs and processes (kosmos#4273)

## Measured (2026-09-27)
$TMPDIR held 128,442 entries; 9,325 made in the last 24h. tools/run-tests.sh already gives a whole suite its own
temp root (#1151), so the steady leak is test files run DIRECTLY (`node --test <file>`), which agents do all day,
plus shell `mktemp`, which on macOS IGNORES TMPDIR (measured on 26.7: bare `-d` and `-t x` both land in the real
temp root; only an explicit template path is honoured).

## What
- test-support/tmpscope.js: one require gives a test process its own `kts-` temp dir (TMPDIR points into it, so
  every mkdtemp and every child process lands inside), removed on exit and on SIGINT/SIGTERM/SIGHUP.
- Adopted as the first code line of the 24 files that leaked most. Each alone in a fresh TMPDIR: 253 -> 0.
- docs/browser-checks/lib-sandbox-home.js and thread-server.js remove their dirs on a signal too.
- tools/lib/test-leak-guard.sh (leak_guard_after_suite) + run-tests.sh: after the suite, scoped to THIS run's
  temp root: a new launchd job whose plist is under it (either spelling, /var or /private/var) is booted out and
  fails the run; an ORPHANED process (ppid 1) whose command line names it is stopped and fails the run; a temp FAMILY not on tools/test-leak-allowlist.txt fails the run, and a
  listed family that left nothing prints a note (the list only shrinks).
- tools/test-test-leak-guard-4273.sh: every check has an arm and a control; launchctl is a stub.

## Not done (decided)
- The shell `tmp.*` family (~2,480/day): TMPDIR cannot contain macOS mktemp, so each site needs its own cleanup.
  Slice 2, filed separately.
- The remaining 251 allowlisted families: fixed one file at a time as tmpscope spreads; the guard stops NEW ones.
- A count ceiling instead of families: counts wobble with flaky tests; family membership does not.

## Weakest premise
That a family name is stable run to run. The rule drops mkdtemp/mktemp random tails, 6- or 10-character random
tokens inside a name, and 10+ digit timestamps; a test whose dir name embeds some other per-run value would
read as a NEW family every run (a false red). Full run 2 is the measurement.

## Review record
- Round 1 (opus): B launchd reports the RESOLVED plist path (/private/var), the root is /var: the check could never
  match -> both spellings. B a pid inside a name (kosmos-flags-<pid>.txt) made a new family every run (every run
  red); its source, tools.win-installer-native.test.js, called async cliMain unawaited: the assertion compared a
  Promise with 64 (could not fail) and the report leaked -> digit-only tokens dropped; the test awaits. W family
  rule ate real words / skipped empty names -> tail stripped only as a 6/10 token or the last 6 chars; empty ->
  `(unnamed)`, reported. W an all-one-case random token mid-name (~1%) -> allowlist lines may be globs. W process
  check: orphans only (ppid 1) so an operator's `tail` is never killed. W tmpscope re-raised over a file's own
  handler (the file then ran on with TMPDIR gone) -> stands aside when another listener exists; test; red without
  the check. W wiring untested -> one entry point leak_guard_after_suite, tested end to end, and a pin that
  run-tests.sh calls it after the suite. N notes collapsed, comments updated.
  FOUND WHILE FIXING (mine, not the reviewer's): plain `ps` lists only processes with a controlling terminal, so
  an ORPHAN was never listed -> `ps -Aww`; `ps -E` shows no environment on macOS 26.7, so environment matching
  (the reviewer's suggestion) is impossible and is a documented limit; the orphans my env-only test arm started
  could not be cleaned up by path and leaked (killed; the arm is gone). The guard's own labels file sat inside
  the root and would have been counted as a leak -> removed after the launchd check.
  Allowlist rebuilt from runs 1 and 3 (258 lines). `(unnamed)` is allowlisted TEMPORARILY: one fully random
  entry per run, source not found; the guard now prints a raw example per reported family to trace it.
  Run 2 had 4 failures, all load flakes (none of the 4 files uses tmpscope; alone they pass 339/339).
- Round 2 (sonnet): B the no-separator branch of leak_family stripped the last 6 characters UNCONDITIONALLY, so a
  real name (`readme`, `status`) became `(unnamed)` and was hidden by the temporary allowlist line -> the last 6
  go only when they look random; test cases readme/status/logfile. W an all-one-case random TAIL made a family
  flaky -> the trailing 6/10 token after a separator is stripped whatever its case (the case-mix test stays for
  mid-name tokens only); test codex-forget-abcdef. W a bare root given as its own argument was not matched ->
  matched. W TERM then KILL after 1s could kill a load-starved process mid-cleanup -> 3s. W the two
  browser-check helpers re-raised over another handler -> they stand aside, as tmpscope does. DEFERRED NITs: the
  note's plural (cosmetic); a launchd label containing a space (launchd labels do not contain spaces in
  practice); tmpscope's source pin of the `kts-` name (kept on purpose: the socket-length budget depends on that
  exact literal). Guard test 42/42 under /bin/bash 3.2 and brew bash. Full run 4 (before these) was green:
  10996 tests, 0 fail, no leak.


#### Iteration 3 (opus, blind, 2026-09-27 23:24 CDT)
- [WARNING] docs/browser-checks/thread-server.js + lib-sandbox-home.js: two "stand aside if another listener exists" signal handlers in one process stood aside for EACH OTHER, so on SIGTERM only the last swept; the reviewer measured 4 `kosmos-bc-home-` folders left. FIXED: new test-support/remove-at-end.js, ONE handler per process (global symbol, so two copies of the file still share it); tmpscope.js, lib-sandbox-home.js and thread-server.js all register through it. Tests: the two-module SIGTERM case (real lib-sandbox-home + a second registration) sweeps both; a control built from the old shape leaks the first module's folder; two copies of the file install one handler. Perturbed: HEAD's lib-sandbox-home turns the two-module test red; a module-local symbol turns the two-copies test red; both restored byte-identical.
- [NIT] tools/lib/test-leak-guard.sh header omitted the interrupted run. FIXED beyond the note: run-tests.sh's EXIT trap now runs leak_launchd_check while the labels snapshot is unused (an interrupted run), before removing the root, so the 8,096-respawn shape cannot come back from a Ctrl-C. The header says an interrupted run gets only the launchd check. Test: the trap line taken from run-tests.sh, run in a child bash sent SIGTERM, boots out the job and removes the root; control: with the snapshot used, it boots out nothing. Perturbed (inverted file test, old trap): both red.
- [NIT] a separator-less random tail is kept about 1 run in 90. Documented in the lib header with the glob remedy. Swept the source: no mkdtemp prefix without a trailing separator today (`avatarver` is `avatarver-`).
- Validation: guard test 45/45 under /bin/bash 3.2 (no bash 5 on this box now; CI's Linux job runs bash 5). 32 affected test files (24 adopters, tmpscope, every file loading lib-sandbox-home/thread-server/remove-at-end): 893/893.
- Not done: a SIGTERM to the real thread-server process (the harness refused the background-server command twice). The unit test runs the real lib-sandbox-home beside a second registration, which is thread-server's exact use.
