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
