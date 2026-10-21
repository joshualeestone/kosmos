# #6791: test:shell's Linux-safe commands run on ubuntu-latest

## The question (the card)
Every kosmos run sent both shell shards to hosted `macos-latest`, the deeper queue (29 jobs queued there on 2026-10-20
at 21:18 against 9 self-hosted). Can the part of test:shell that does not need macOS run on Linux?

## Measured
- Read from source first (main dc583148): of the 153 runnable test scripts, 24 need macOS, 6 are platform-aware,
  121 POSIX-only, 2 unsure. Only 9 were measured on Linux then (the shell tests test-linux-setup-4920.yml and
  linux-systemd.yml run).
- Then RUN: probe branch `probe-6791-shell-linux` (never merged) ran each of the 264 test:shell commands ALONE on
  ubuntu-latest in 6 slices (run 39535595626; the first run, 39535218469, was void: the step shell is `bash -e`, so the
  first red ended each slice). 237 PASS, 27 FAIL. One FAIL was the probe's own (test-ci-created-url-6742 requires a
  top-level env in every workflow, and the probe workflow had none). The 26 real ones are the 24 the read found, plus
  test-msg-newlines-1927 (its control relies on BSD sed's `N`) and test-cut-step-record (a status above 128 decodes as
  a signal on Linux). Both "unsure" files passed. By time: 1369 s on Linux in all, 283 s of it the 26.

## Corrections to the card's premise (on the card)
- Billing: standard hosted runners are free for a public repository (reasoned from GitHub's documentation). The cost
  is the queue: hosted macOS is a handful of concurrent jobs for this repo, the Linux pool far larger.
- A self-hosted Linux runner is not a drop-in: tools/ci-runner-job-guard.sh reads the event JSON with
  `/usr/bin/plutil`, so on Linux it would refuse every job. This repository is public, so a fork PR can name any
  runner label. ubuntu-latest needs no trust decision (a throwaway VM), so this change uses it.

## The change
- `tools/shell-macos-only.txt`: the 26 commands, each with its reason. A DENY list, so a new macOS-only test goes
  red on Linux loudly and is listed (or fixed) on purpose, rather than an allow list a new test could skip quietly.
  A line naming no test:shell command refuses (every shard fails), so the list cannot go stale.
- `tools/shell-shard.js`: `list|run <i> <n> [linux|mac]`. linux keeps every command not listed, mac only the listed,
  none the whole list (a local full run is unchanged). Shards are still chosen by each command's hash.
- `tools/run-tests.sh`: `KOSMOS_SHELL_PLATFORM` (linux or mac, only with a shard) is passed through.
- `.github/workflows/test.yml`:
  - matrix: node (unchanged); shell 1/2 and 2/2 with platform linux; shell 1/1 with platform mac (named `shell macOS`);
  - runs-on: node takes scope's choice, else macos-latest (as before); the mac job is always macos-latest, NEVER the
    self-hosted Mac (#4601: some of these touch launchd or sweep processes by pattern); a linux shard takes scope's
    choice (the self-hosted Mac only when KOSMOS_CI_SHELL_SHARDS names it, as before), else ubuntu-latest;
  - a Linux-only step installs tmux, lsof, zsh and jq, as linux.yml does; the tmux step after it then does nothing.
- Pins updated: tools.shell-shard-4317.test.js (the matrix shape; new arms for the split, a stale line, a bad
  platform), tools/test-ci-runner-route-5488.sh (runs-on text and its evaluation, every routing arm's default).

## Effect (numbers updated by iteration 1: 230 on Linux, 34 on macOS)
Each run held three hosted macOS runners (node unless self-hosted, and both shell shards). It now holds at most two
(node unless self-hosted, and the one macOS shell job with 26 commands), and the two shell shards go to the Linux pool.

## Decided, not missed
- ubuntu-latest, not the Hetzner box from #6790: that box is registered to kosmos-relay only, and a self-hosted Linux
  runner here would first need a Linux job guard.
- The 26 are not fixed for Linux in this change (several are one-line fixes: the `stat -f || stat -c` order in 4 files,
  `sed -i.bak`, `pgrep -fa`, an OS check for the swiftc skips, a getconf fallback). Each would shrink the macOS job;
  none is needed for this one, and each needs its own Linux measurement.

## Weakest premise
A command that passes on Linux by taking a degraded fallback (two were noted in the read: install-progress-emit-3233
and time-scale-5727) now runs only on Linux, so it no longer exercises its macOS path in CI. Accepted: the macOS path
of both is a single stat or sysctl read that the 26 cover elsewhere. What would change my mind: a red on a developer
Mac in either that CI did not catch.

## Review iteration 1 (opus): 3 WARNINGs, 2 NITs, all addressed
- WARNING, a PASS that only skipped is not coverage: commands that skip their macOS work off macOS would have moved
  to Linux and tested nothing there. MEASURED rather than read: a second probe (run 39538876370) kept each passing
  command's skip lines. Of 30 PASS lines that mention a skip, 8 are real platform skips (5 whole files; 3 skip the
  arms that need macOS: test-leak-guard-4273's launchctl arm, board-foreground-2956's lsof holder cases,
  update-locked-app-4455's locked-file arms); the other 22 only name a skip in a test title or test a skip path.
  The 8 are listed too, so the list is 34 and Linux runs 230. Weakest premise: board-foreground-2956 and
  update-locked-app-4455 also run on Linux in test-linux-setup-4920.yml, so listing them keeps their Linux arms
  covered there rather than here.
- WARNING, tools/release.sh's #5934 preflight did not refuse a leftover KOSMOS_SHELL_PLATFORM, which would stop a cut at
  step 3 after the bump. Now refused, with arms in tools/test-cut-testpart-guard-5934.sh, and unset in
  tools.release-gate.test.js.
- Found while fixing that, not by the reviewer: tests that nest run-tests.sh reset KOSMOS_SHELL_SHARD= but would
  inherit KOSMOS_SHELL_PLATFORM=linux from a Linux shard job, and run-tests.sh refuses a platform without a shard.
  Measured: test-runner-scale-export-5727 failed 6 arms under a simulated Linux shard environment without the fix,
  0 with it. Reset now beside every KOSMOS_SHELL_SHARD= (test-runner-scale-export-5727, test-cut-guard) and in the env
  lists of tools.run-tests-only-4929 and tools.run-tests-file-timeout-6668.
- NIT, the real Linux job has not run: the PR's own CI is that run; read both Linux shards' logs end to end.
- NITs fixed: the limit step's label says "shell macOS" and gives a fitting hint; stale wording in test.yml,
  shell-shard.js and test-ci-created-url-6742.sh.
