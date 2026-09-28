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
- tools/lib/test-leak-guard.sh + run-tests.sh: after the suite, scoped to THIS run's temp root:
  a new launchd job whose plist is under it is booted out and fails the run; a process whose command line names
  it is stopped and fails the run; a temp FAMILY not on tools/test-leak-allowlist.txt fails the run, and a
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
