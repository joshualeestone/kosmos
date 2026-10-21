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
Their four test:shell commands leave `tools/shell-macos-only.txt` (Linux 234 commands, macOS job 140 = 30 listed + 110
syntax checks).

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
- macOS coverage: the four now run only on Linux. Their macOS path (`stat -f`) is still exercised on macOS by
  run-tests.sh's own LaunchAgents guard (`_la_mtime`) in every macOS job, and by the full suite at each release cut.

## Weakest premise
That GNU-first is harmless on macOS everywhere it runs: BSD `stat -c` exits non-zero with its usage on stderr only
(stderr is dropped at each site). Measured on this Mac by the three passing tests above.
