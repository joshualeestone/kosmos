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
  passed", shard 2/2 "all 112 passed", no #4273 leak; the load line now reads "on 4 cores".
- run-tests.sh's load diagnostic read cores from hw.ncpu only; with the load now readable on Linux it would print
  "on ? cores", so it uses kosmos_cpu_count (same `command -v` guard as its load read).
- Precedent: cut-guard.sh's `_kosmos_load_and_cores` already falls back to /proc/loadavg and getconf the same way.
- Out of scope, recorded: `ps -Ao ... -r` in kosmos_top_cpu_consumers is attribution only (GNU -r means "running
  only"); test-time-scale.sh and build-tmux-from-source.sh fall back to 4.

## Weakest premise (slice 3)
That Linux `sysctl -n hw.ncpu` fails rather than printing something with rc 0; the probe's cpu_count arm measures it.
