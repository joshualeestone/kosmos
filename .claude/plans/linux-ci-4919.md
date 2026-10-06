# #4919 Linux port piece C: the Linux CI lane, and the remaining Linux failures sorted

Original work by Raiden (PR #4986, approved 10-02). Taken over by Angel 2026-10-06 (Splinter 15:08): rebase,
re-run, merge.

## Finished looks like
`.github/workflows/linux.yml` runs the node suite on ubuntu-latest on demand (and on pushes to linux-ci-*
branches). Every Linux failure left on current main is either fixed, marked Mac-only with a one-line reason
that is true on Linux, or carried by a named card. No test is skipped to make the count green.

## Measured: run 37523489451 (ubuntu-latest, main with piece A merged): 126 fail of 16,012

| group | tests | cause | where it goes |
|---|---|---|---|
| installer: install.reachable-1662 39, install.claude-gate 9, install.uninstall-litter-1547 3, install.uninstall-watchdog-2955 1 | 52 | setup.sh is Mac-only (stops with "Kosmos runs on macOS"); the tests run it under `set -euo pipefail`, which Ubuntu's dash refuses | piece D, #4920 / PR #4985 (Kitty) |
| downloads and runners: engine/runners 22, engine/connect 17, connect.install-997 16, server.runners 4, connect.nobinary-1580 4, muserun 2, connect.hookwiring-1569 1 | 66 | the board refuses to download Claude Code or any runner on Linux | new card #5419 (product gap; stays red, nothing skipped) |
| engine/create #4279 leftover-job tests | 6 (3 skipped on Linux for macOS temp roots; 2 keyed on their premise, a second spelling of the plist folder; 1 had its temp arm split into its own test, skipped on Linux, the rest runs) | fixtures are a macOS temp-folder plist and its /private spelling; launchd only | Mac-only, skipped on Linux only (tempRoots() lists only macOS /private folders; Linux agent jobs are #4918, not yet on main) |
| engine/status unrecognised-tmux-error test | 1 | measured: Linux tmux answers a plain file at the socket path with "no server running", so the probe cannot make the connect error | Mac-only premise, skipped on Linux only, with that reason |
| report-hook-killguard-4671 awk fallback | 1 | took 20.2 s on Linux; the production hook times out at 15 s | new card #5420 (real Linux bug; bound NOT widened) |

Baseline before A merged (run 37001432347, 10-02): 146 fail of 14,207.

## Changed from the PR as approved, and why
- Workflow triggers: on demand + linux-ci-* pushes, not every PR (expected red until B/D land; runners backed up).
- report-hook-killguard-4671 kept at main's bounds (widening hid #5420).
- The tmux test's skip reason replaced by the measured one, and limited to Linux.
- The skips this takeover added use `process.platform === 'linux'`, so Windows coverage is unchanged (create.test.js
  runs on the Windows job). One kept from the PR uses `!== 'darwin'` (projects.open-why-1199, not on the Windows job). The
  codexsession skip is keyed on its premise instead (os.tmpdir() not reached through a symlink), review 4.
- Review 1: the leftoverJob test now skips only its temp-folder arm on Linux; the preview test runs everywhere and
  asserts the answer the disk gives (adopt on a case-insensitive disk, make on a case-sensitive one).
- install/kosmos lsof lookup: the two absolute paths only (no PATH fallback: it added trust and no coverage).
- Known gap: the lane has no expected-red list; its header names the expected failures. Follow-up after B/D.

## Kept from the PR
Case-sensitivity probe for the case-insensitive-volume tests; /tmp-symlink and /usr/bin/open Mac-only skips;
GNU-then-BSD stat in shims; lsof lookup in install/kosmos and server.startup.test.js; zsh presence check;
update.js selfInstallRefusal honouring the platform override.
