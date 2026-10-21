# #6799: test:shell's fixable macOS-only habits, the stat-order group

Stacked on #6795 (#6791), which split test:shell into Linux shards and one hosted macOS job listed in
`tools/shell-macos-only.txt`. Each command fixed for Linux leaves the paid, queued macOS job.

## This slice: `stat -f ... || stat -c ...` in BSD-first order
On GNU, `stat -f` is "filesystem status": `stat -f '%Lp' file` treats `%Lp` as a missing file, still prints the real
file's filesystem details to stdout, then fails, so the fallback's answer is captured after that text. Every other
site in the repo is GNU-first (`stat -c ... 2>/dev/null || stat -f ...`), which is safe on both: BSD stat rejects `-c`
without printing to stdout. Swapped at the four BSD-first sites:
- `tools/test-permission-acceptance.sh:58`, `:94`
- `tools/test-deploy-site-staged-mac-4819.sh:173`
- `tools/test-supervisor-codex-isolation-4592.sh:80`
- `tools/lib/launchagent-leak-guard.sh:27` (`_la_mtime`, used by test-launchagent-leak-guard-3011 and by run-tests.sh's
  own LaunchAgents guard)
Three of their four test:shell commands leave `tools/shell-macos-only.txt` (Linux 233 commands, macOS job 141 = 31
listed + 110 syntax checks). test-launchagent-leak-guard-3011 stays, with its reason corrected (review 1, below).

## Measured
- ubuntu-latest, probe branch probe-6799 (never merged), run 39551438303:
  - each of the four ALONE: rc 0; their "skip" lines are test titles about skip behaviour, not platform skips;
  - both Linux shards through tools/run-tests.sh: "all 123 passed", "all 111 passed".
- macOS (this Mac): test-permission-acceptance, test-deploy-site-staged-mac-4819 and test-launchagent-leak-guard-3011
  pass. test-supervisor-codex-isolation-4592 fails two arms here identically on the base (unchanged file) when run
  from an agent shell, and passed in the Mortals full suite (an environment effect of the agent shell, not this change).

## Decided, not missed
- One slice per card comment: the other groups named on the card (`sed -i ''`, `pgrep -fl`, the swiftc skip, sysctl
  hw.ncpu) each need their own Linux measurement and are left for the next slices.
- macOS coverage: the three that leave run only on Linux; their `stat` call is test plumbing and what they test is the
  same on both platforms, and the full suite at each release cut still runs them on macOS.

## Slice 2: `sed -i ''` (test-browser-run-guard)
- `sed -i '' "s/.../" file` is BSD-only (GNU reads `''` as the script and the real script as a file name). Rewritten to
  write the edited copy beside the file and `mv` it over, portable everywhere.
- Measured on ubuntu-latest, probe branch probe-6799b (never merged), run 39553501883: rc 0. Its one SKIP ("the SHIPPED
  pgrep expression vs a real process") is OPT-IN on every platform (`KOSMOS_BC_REALPATH=1`, because its look-alike page
  layer would refuse a concurrent release cut), not a platform skip, so the move loses no macOS coverage. Passes on
  this Mac. It leaves the list: Linux 234, macOS job 140 (30 listed + 110 syntax).
- The same probe ran every other listed command alone on Linux and confirmed each recorded reason still holds (Cocoa/
  swiftc, `date -r`/`-v`, `--uname`, `nc -G`, `pgrep -fl`, codesign, signal decoding, BSD sed's `N`, the Darwin-only
  skips), so each further move needs a real code change and its own slice.

## Review iteration 1 (opus): 1 WARNING, 1 NIT, both fixed
- WARNING: my first draft said `_la_mtime`'s BSD branch stays covered on macOS by run-tests.sh's own LaunchAgents guard.
  Reasoned, and wrong on a hosted runner: `launchagent_snapshot` calls `_la_mtime` only for `com.kosmos.agent.*.plist`
  files, which a clean macos-latest runner does not have. So test-launchagent-leak-guard-3011 is the only CI run of the
  BSD branch, and it stays on the macOS list with that reason. The swap itself stays (it makes the Linux run correct, and
  it also fixes a Mac with GNU coreutils' stat first on PATH).
- NIT: the helper's header comment now names the GNU form first, as the code tries it.

## Weakest premise
That GNU-first is harmless on macOS everywhere it runs: BSD `stat -c` exits non-zero with its usage on stderr only
(stderr is dropped at each site). Measured on this Mac by the three passing tests above.

## Review iteration 2 (sonnet): 2 NITs, both fixed
- The list's header still said 34 listed and 230 on Linux, and 26 Linux failures with no word that three were a
  fallback-order bug; it now says 31 and 233 and names #6799's fix and its probe run.
- test-launchagent-leak-guard-3011's entry is back in alphabetical place.

## Slice 3: core count and load from macOS sysctl only (test-cut-load-guard, test-cut-parallel-region)
- Linux failures (probe run 39553501883): `kosmos_box_load_1min live parse is non-numeric: []` and both "should
  parallelize" arms; test-cut-parallel-region's parallel arm took the serial branch. Cause: `sysctl -n vm.loadavg` and
  `sysctl -n hw.ncpu` both read empty on Linux, and kosmos_cut_parallel_ok goes serial on an empty core count.
- Fix: `kosmos_cpu_count` (hw.ncpu, then `getconf _NPROCESSORS_ONLN`) at the three sites; the load read wraps
  /proc/loadavg's first three fields in macOS's `{ 1m 5m 15m }` shape, so the one shared awk (#2749) still extracts it.
- The test's expected core count used `hw.ncpu || echo 4`, which would now disagree with the guard on Linux; it reads
  the count independently in the same order, and a new arm asserts kosmos_cpu_count reads one on the host platform.
- macOS (this Mac): both pass. Linux, probe-6799c (never merged), run 39556794222: each ALONE rc 0 (the one "skip"
  line is the test title "skips the ps header", not a platform skip; `kosmos_cpu_count reads the core count on Linux
  (4)`); shard 1/2 "all 124 passed"; shard 2/2 "all 112 passed" but run-tests.sh's #4273 leak guard went red on
  "7 x tmp". Cause: the release.sh region keeps its suite/page log on every abort arm ("Full output: ..."), from a bare
  `mktemp`. GNU mktemp honours TMPDIR (/tmp there); macOS mktemp with no template ignores TMPDIR and writes to the
  per-user /var/folders/.../T (measured on this Mac), which is why the macOS job never flagged it. The test now runs the
  region with TMPDIR="$WORK", so on Linux its trap removes them. On macOS they still land in the per-user dir, as they
  did before (pre-existing, left alone: release.sh's kept-on-abort logs are deliberate).
- Re-measured, probe-6799d (never merged), run 39558291451: all three jobs success; both ALONE rc 0; shard 1/2 "all 124
  passed", shard 2/2 "all 112 passed", no #4273 leak. (run-tests.sh prints its load line only on a red run, so the
  "on ? cores" fix is not visible in a green one; kosmos_cpu_count itself read 4 on Linux in the alone job.)
- run-tests.sh's load diagnostic read cores from hw.ncpu only; with the load now readable on Linux it would print
  "on ? cores", so it uses kosmos_cpu_count (same `command -v` guard as its load read).
- Precedent: cut-guard.sh's `_kosmos_load_and_cores` already falls back to /proc/loadavg and getconf the same way.
- Out of scope, recorded: `ps -Ao ... -r` in kosmos_top_cpu_consumers is attribution only (GNU -r means "running
  only"); test-time-scale.sh and build-tmux-from-source.sh fall back to 4.

## Weakest premise (slice 3)
That Linux `sysctl -n hw.ncpu` fails rather than printing something with rc 0; the probe's cpu_count arm measures it.

## Slice 4: `pgrep -fl` (test-cut-guard, test-light-side-4911, test-running-anchor-5470)
- Linux failures (probe run 39553501883): "a live harness was not detected", "#4410 the suite guard's real name arm
  missed a live run-tests.sh stand-in", "the real matcher missed a browser executable ()", "real runs not found".
  Cause: procps `pgrep -fl` prints `pid name`, not `pid command line`, so every anchored match on the script path
  read nothing. Linux needs `pgrep -fa`; macOS reads `-a` as "include ancestors", so the flag follows the platform.
- Fix: `_kosmos_pgrep_cmdlines` in tools/lib/cut-guard.sh (Darwin -> -fl, else -fa), used by kosmos_running_lines,
  _kosmos_playwright_browsers, and the two test-side probes (test-cut-guard's mention check, test-running-anchor's
  settle). tools/ci-runner-setup.sh:257 keeps `pgrep -fl`: it is the macOS runner's own setup script.
- macOS (this Mac): all three pass (test-cut-guard's one skip line is unchanged from the base).
- Weakest premise, as first written: "every caller drops its own run". Wrong (challenge loop iteration 1, below).
- Linux, probe-6799e (never merged), run 39559795454: all three jobs success. ALONE: each rc 0, 0 failures (test-cut-guard's
  one "skip" line is the test title "is skipped only for the claim holder", as on macOS). Through run-tests.sh: shard 1/2
  "all 125 passed", shard 2/2 "all 114 passed" (239 = the list's new count), so the ancestor premise held there too.

## Slice 5: the swiftc skip (test-a11y-writer-mock-2125, test-scan-hatch-symlink-2125b): fixed, both STAY listed
- Each compiles the Cocoa app, so each needs macOS. Each skipped only when swiftc was absent, so a Linux box with Swift
  for Linux installed would try to build Cocoa and fail. Each now also skips when `uname -s` is not Darwin.
- They keep their lines (on Linux they would test nothing), with the reason corrected: "skips off macOS".
- Measured on this Mac, both arms: real uname -> both run fully (all 12 checks / PASS, no SKIP); a stub `uname` printing
  Linux on PATH, swiftc still present -> both print the new "not macOS" SKIP and exit 0. No Linux probe: no command moves.

## Card groups, all done
stat order (slice 1), `sed -i ''` (slice 2), sysctl hw.ncpu + vm.loadavg (slice 3), `pgrep -fl` (slice 4), the swiftc
skip (slice 5). The other listed reasons were re-measured on Linux in probe run 39553501883 and still hold.

## Challenge loop (whole branch vs origin/main), iteration 1 (opus): 2 WARNINGs, 4 NITs
- WARNING, fixed: kosmos_refuse_if_cut_live drops only its own pid. procps pgrep lists its own ancestors (the caller
  and every `$( )` subshell around the call, all carrying the caller's command line), so on Linux a release.sh would
  have read itself as a second cut. Fixed in the helper, not the guard: on Linux `_kosmos_pgrep_cmdlines` drops the
  calling shell's ancestor chain, so both platforms answer the same and no caller changes (the release guard's own
  scope note keeps the subtree walk out of it). New arm in test-running-anchor-5470: a separate matching process IS
  listed (control), none of the caller's own lineage is, and off macOS raw `pgrep -fa` does list that lineage (so the
  filter is exercised). Rejected: moving kosmos_refuse_if_cut_live to the subtree walk (touches an armed release guard
  for a platform that never cuts).
- WARNING, fixed: slice 3 made the time scale (#5727) live on Linux (the load now reads), with cores still hw.ncpu or 4.
  kosmos_test_time_scale now takes cores from kosmos_cpu_count when it is defined. Arm: stubbed cores 2, load 2 ->
  2.00 (the old lib gives 1.00 under the same stub, measured). Recorded: on Linux CI the scale now follows the load,
  only ever lengthening a budget (floor 1, cap 4).
- NIT, taken: `$OSTYPE` instead of a forked `uname` (a failing uname can no longer send a Mac to `-a`).
- NIT, taken: test.yml's counts (230 / 34) no longer restated; the list header keeps the one count.
- NIT, taken: ci-runner-setup.sh's comment names pgrep `-fl` as the macOS form.
- NIT, left: run-tests.sh's "running ONLY the ... part" banner does not name the platform; the shard runner prints its
  own command count, and both jobs are named by platform in the workflow.
- Mac: the pgrep trio, both time-scale tests, cut-load-guard and ci-runner-setup pass. Focused node set (175 files incl.
  the repo-wide audits): 5103 pass, 1 fail, which was tools.shell-shard-4317's run-tests.sh call waiting on another
  agent's suite claim on this Mac past its 120 s limit (contention; full run is on Mortals).

## Challenge loop iteration 2 (sonnet): 2 WARNINGs, 3 NITs
- WARNING, deferred: test.yml's apt-get install has no retry. The repo's other Linux workflows install the same way
  (linux.yml, linux-systemd.yml), and a mirror failure fails the named setup step, not a test, so it does not read as a
  test failure.
- WARNING, fixed: `_kosmos_pgrep_cmdlines` started its ancestor chain at `${BASHPID:-$$}`; without BASHPID (bash 3.2)
  that is the top shell, missing the `$( )` subshells. It now falls back to `$(exec sh -c 'echo "$PPID"')` (measured on
  bash 3.2: the subshell's own pid, not $$). Running the Linux branch on bash 3.2 then found a second defect: a bare
  case pattern `)` inside `$( )` fails to PARSE on bash 3.2 at run time (`bash -n` passes). Fixed with the leading-paren
  pattern form. New arms run the Linux branch on the host's own bash (OSTYPE forced, pgrep stubbed): the caller's
  lineage is dropped and a stranger kept; nothing matching passes 1 through. Control: the pre-fix lib prints the
  syntax error instead.
- NITs, left: a /proc read instead of `ps` per hop (cheap as is); a Linux sysctl printing to stdout with rc 0 for an
  unknown key (procps prints to stderr and exits 255; the Linux probe read 4 cores); the list header's count is not
  asserted (it is a comment; the split itself is pinned by tools.shell-shard-4317.test.js).

## Challenge loop iteration 3 (opus): 3 WARNINGs, 5 NITs
- WARNING, recorded + carded: PR CI no longer runs product shell code's tests on macOS, so a GNU-only form there is
  caught only by the release cut's full macOS suite. A lint is new scope: filed #6808, and the list header names the
  gap. Rejected: a per-PR macOS run of the Linux share (that is the paid queue #6791 exists to shrink).
- WARNING, fixed: the #6791 platform-forward test ran a real run-tests.sh with every KOSMOS_ variable stripped, so on a
  shared Mac it waited on another suite's claim past its 120 s timeout (the red recorded in iteration 1). It now passes
  the same three overrides test-runner-scale-export-5727 uses; the forward does not depend on the wait.
- WARNING, fixed (was deferred in iteration 2): the apt install retries 3 times. New point that changed the call: two
  required Linux shards double a mirror hiccup's chance of failing a run.
- NITs, taken: a comment pins the one-simple-command `$( )` assumption on the pgrep line and names the arm that
  measures it; the time-scale arm stubs 1 core / load 1 (discriminates on any box with 2+ cores; the old lib gives 1.00,
  measured); test.yml's comment re-wrapped, and its probe numbers marked as the original measurement.
- NIT, left: a missing `ps` stops the ancestor walk early, which fails toward refusing (a run reads itself as busy).

## Challenge loop iteration 4 (sonnet): 2 WARNINGs, 1 CONVENTION, 3 NITs
- WARNING, fixed (left as a NIT in iteration 2; raised again and test.yml now points readers at the header): the list
  header's "That is N here, and M commands on Linux." is asserted against the parsed list in tools.shell-shard-4317,
  with a control that a header one count off does not match.
- WARNING, deferred: the ancestor walk's last resort `$$` (no BASHPID AND no runnable `sh`). That needs a box where `sh`
  cannot run, which breaks the tooling well before this; the `exec sh` fallback itself runs on every macOS bash 3.2
  pass of the host-bash arm.
- CONVENTION, deferred (the reviewer also said nothing to change): GNU `stat -f FMT file` without -c takes FMT as a
  second file operand, which is missing, so it exits nonzero after printing; measured on Linux in slice 1.
- NITs, taken: the apt comment says update and install retry together; test.yml's comment reflowed. Left: naming the
  callers of forPlatform's `mac` seam.

## Challenge loop iteration 5 (opus): 1 WARNING, 6 NITs
- WARNING, fixed (in this loop's own iteration-2 test): the host-bash arm's stub listed only `$$` and its parent, so a
  walk started at `$$` would also pass; it pinned the bash 3.2 parse, not the start point iteration 2 credited it
  with. The stub now also lists the calling `( )` subshell's own pid. Mutant measured: with the start point forced
  back to `$$`, the arm fails (keeps the subshell line); with the real lib it passes.
- NITs, taken: linux.yml's header no longer says the shell half never runs on Linux; test.yml's "fourth macOS runner"
  is now "one more"; kosmos_cpu_count's comment names its twin reader (_kosmos_load_and_cores in cut-guard.sh, same
  probes, read there); test-cut-load-guard's comment says its count is the same probe order, so it does not test it.
- NITs, left: the `--only` refusal does not name KOSMOS_SHELL_PLATFORM (the platform check refuses it a few lines
  later); one `ps` per hop (recorded in iteration 2).

## Challenge loop iteration 6 (sonnet): 2 WARNINGs, 2 NITs, both WARNINGs deferred on measurement
- WARNING, deferred: the job `suite (shell 1/1)` is now `suite (shell macOS)`, which a check matching job names would
  miss. Measured: main's ruleset 25277985 requires only `test`, `windows` and `scope`; `git grep 'shell 1/1'` finds
  nothing in the repo (control: `shell macOS` found in test.yml).
- WARNING, deferred: nothing asserts the macOS share stays small (25 listed + every syntax check). Measured in #6795's
  `suite (shell macOS)` job (run 39551114754): 110 syntax checks took 0.2 s in all, max 0.1 s; the 70% time warning
  already covers the job.
- NITs, left: one `ps` per hop (recorded in iteration 2); the apt step relies on the ubuntu-latest image's git, curl
  and python3, as every other ubuntu-latest step here does.

## Challenge loop iteration 7 (opus): 1 WARNING, 4 NITs
- WARNING, fixed (this loop's own iteration-3 header line): the unguarded direction is wider than GNU-only flags.
  Linux runs tests under bash 5 and a Mac runs product scripts under bash 3.2, so bash 4+ syntax passes here and fails
  there at run time, past `bash -n`. The header names both classes in one line and points at #6808; the detail (the
  constructs) went to #6808 as a comment. Measured: no such syntax outside comments in install/ or bin/ today
  (git grep, 0 hits; control lines match).
- NIT, taken (it fails OPEN on a release guard): bash keeps an inherited OSTYPE (measured: an exported
  OSTYPE=linux-gnu reaches a child bash unchanged). A Mac sent to `pgrep -fa` gets no command lines and every guard
  matches nothing. `_kosmos_pgrep_cmdlines` now also asks `uname -s` when OSTYPE is not darwin. New arm: OSTYPE
  linux-gnu with uname Darwin uses -fl (the previous lib answers -fa under the same stubs). The host-bash arms stub
  uname too, so they still reach the Linux branch on a Mac.
- NITs, taken: run-tests.sh's usage comment names KOSMOS_SHELL_PLATFORM; settle() silences the helper's stderr.
- NIT, left: kosmos_test_time_scale's load fallback without cut-load-guard sourced is still sysctl only (fails safe to
  1.00; run-tests.sh sources the guard first).

## Challenge loop iteration 8 (sonnet): 1 WARNING (new, deferred), duplicates otherwise
- WARNING, deferred: on Linux the helper drops the caller's whole ancestor chain, so a parent whose command line is a
  run of the same script reads as absent. By design: if an ancestor is a run of that script, the caller is inside that
  run, and the guards define "this run" as self plus its subtree (#1391); macOS pgrep excludes its ancestors the same
  way, which is the parity the helper exists for, and the helper's comment says so.
- Duplicates: the renamed macOS job (iteration 6, ruleset measured), one `ps` per hop and a Linux sysctl printing to
  stdout (iteration 2).

## Challenge loop iteration 9 (opus): 1 WARNING, 3 NITs
- WARNING, fixed: slice 4 took all three pgrep tests off macOS, so PR CI no longer ran macOS's real `pgrep -fl` and
  its own ancestor exclusion, the branch the release guards use (cuts are macOS only). Slice 1's rule (keep a test on
  macOS when it is the only CI run of a BSD branch) applies. test-running-anchor-5470 holds both platforms' real-pgrep
  arms (macOS ancestor exclusion; the Linux filter and lineage count), so moving it either way loses one. The list now
  takes `both: <command>` (macOS job AND Linux shards, as the syntax checks already run by pattern), and that test is
  marked so. Mac job 136 (26 listed + 110 syntax), Linux 239 (unchanged: the test was already there). tools.shell-
  shard-4317: the split test allows both: lines and checks they stay on Linux; a new arm pins the marker on a fixture
  list with a control (no both set: the line leaves Linux) and a stale both: line refusing. My first header said 240;
  the count arm failed on it, which is the arm working.
- NITs, taken: test.yml's env comment names KOSMOS_SHELL_PLATFORM; the twin-reader comment says "same sources" and
  how their fallbacks differ, not "the same way". Left: test-browser-run-guard's chmod after a failed sed (the arm then
  fails on the probe's output, as it should).

## Challenge loop iteration 10 (sonnet): 1 CONVENTION (no defect), 3 NITs, one of them a real regression
- NIT, fixed (my own iteration-1 change): test-time-scale.sh's fallback lost `|| echo 4`, so on a box where sysctl
  fails (Linux) a caller under `set -e` without cut-load-guard sourced ended on that line. Now `|| true`, falling to 4.
  New arm: set -e, no kosmos_cpu_count, sysctl failing, load 8 -> 4.00 then "done"; the previous lib prints nothing
  (the shell ended), measured.
- CONVENTION, deferred: not a defect. The reviewer reports it skimmed two long test bodies and found no defect in the
  library they exercise.
- NITs, left: one `ps` per hop (iteration 2); the `a && b || c` runs-on expressions (each branch evaluated by
  test-ci-runner-route-5488).

## Challenge loop iteration 11 (opus): 4 NITs, no BLOCKER/WARNING/CONVENTION: CONVERGED
- NITs, left: the header's narrative does not say test-running-anchor-5470 came back as `both:` (the totals are right
  and asserted; iteration 9 above says why); the `forPlatform` seam with `mac` and no `both` drops both: lines (test
  seam only, and one arm uses exactly that as its control); an exported OSTYPE=darwin* on a Linux box would send the
  helper to -fl (needs a darwin OSTYPE exported on Linux).
- NIT, left as the weakest open premise: "one simple command in `$( )` gets no extra shell" is measured on Linux only
  from a trap-free caller. A Linux caller holding an EXIT or ERR trap (run-tests.sh) is evidenced, not pinned: the
  Linux shards run every guard through run-tests.sh green (probe runs 39559795454, 39563371896, 39564000974).

## After the PR: the Linux total left the header (2026-10-21, #6814's fresh run)
- #6814's run against current main went red on this branch's own count arm: main had gained test:shell commands (264
  to 267), so "239 commands on Linux" was stale. The arm worked, but pinning a number that every PR adding a shell
  test changes would red unrelated PRs in parallel. The header now states only how many it lists ("That is 26
  here."), which only an edit to the list can change, and says how to get the Linux share; the arm asserts that
  count, with its off-by-one control. test.yml's pointer says "how many it lists".
- The same run's other red, "#4466 a busy reading that comes back FAST", is outside this diff and passes alone (1 of
  1): a timing flake on the self-hosted runner, not this change.
- Rebased onto main (a73efbd), which adds 3 test:shell commands; the Linux share is now 242, and the same run's
  Linux shards were green on them.
