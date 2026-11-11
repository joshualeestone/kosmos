# win-skip-bash-8378: the first #8378 cluster, tests that run POSIX shell paths, skip on Windows with their reason (kosmos#8378)

**Posture:** production

## Problem
#8378 (phase 2 of #8368): on a Windows computer the full suite is red on main for macOS and Linux reasons. The largest
cause is tests that run a POSIX shell path. **Windows has bash** (a bare `bash` reaches Git Bash, on the box and on
GitHub's Windows runners); what it cannot run is an absolute POSIX path (`/bin/bash`, `/bin/sh`, `/usr/bin/ditto`) or a
script run directly by its shebang line (`install/kosmos`, `test-support/fake-tmux.sh`). Test hygiene, done now because
the Windows product queue is waiting on tonight's build.

## Change
- `test-support/skip-on-win32.js`: `skipOnWin32(reason)` is the reason on Windows and `false` elsewhere, so a test
  skips only on Windows and node:test prints why. An empty or missing reason throws on every platform. Its own tests:
  `test-support.skip-on-win32.test.js` (4). Its comment says to name the mechanism, and that the Windows coupling audit
  sees the call, so a file using it must be listed in HOST_BRANCH_EXCLUDED with its reason (round 3, below).
- 18 test files: each test that fails on Windows only for that reason gets `{ skip: SKIP_POSIX_SHELL }`, with a
  reason that names the mechanism and what it runs. Where a file loops over the bash CLI AND the Windows CLI
  (cli.inputkeep-6774, cli.limitmsg-5805, cli.whoisleft-8137), only the bash half skips; the Windows CLI's tests still
  run on Windows.
- **A real fix, not a skip:** `report-hook-toolfail-6071`'s jq-failure test looked jq up through `/bin/sh` and joined
  PATH with `:`. It now looks it up through the same bare `bash` the hook runs under, reads the answer through cygpath where
  bash has one (Git Bash; no host branch, so the Windows coupling audit is unchanged) for the existence check, and joins
  PATH with `path.delimiter`. It passes on Windows (14 of 14) and still
  exercises the path: a fake jq that does not fail on the signature call turns it red (run).
- Nothing changes on the Mac or Linux: the helper is `false` there, and toolfail's change is the same commands there.

## How the set was chosen
From the #8368 inventory (main 53a164708d, every file run alone on the Windows box), the files whose every failing test
failed for a shell reason (23, boot-adds-5584 and bundle.manifest among them). Re-measured on main 545df024be, and every failing test's first error line read. Then
review round 1 found the premise "Windows has no bash" false, so each file's mechanism was re-read:
- **Dropped** (bare `bash`, which works when Git Bash is on PATH; their failures are something else, a later cluster):
  `tools.shell-shard-4317` (run-tests.sh through bare bash; assertion failures) and `cli.livecheck-prefix-8156`.
- **Left out:** `bundle.manifest.test.js` (the POSIX executable bit: the file-modes cluster).
- **Kept after looking** (first left out): `install.boot-adds-5584`. It looked like a Windows board-start difference (no
  prompter-nudges.json), but the test gives the board fake-tmux.sh, which Windows cannot run, so the heartbeat never
  ticks. The real Windows board on the box does write the file.

## Result (each file run alone on the Windows box, the no-schtasks preload, at this branch's head)
In the 20 changed test files: 0 failing (was 343). 340 tests newly skip, each printing its reason; 3 are fixed (toolfail-6071 one, defaults two). Every
pass count is unchanged except toolfail-6071's and defaults', which rise by their fixed tests.

## Weakest premise
That every skipped test is ONLY about an absolute POSIX path or a shebang script. Each was checked by its first error
line and by how the file spawns (`grep` of every spawn call). A test that also covers a Windows behaviour behind that
call loses it on Windows. None of the 20 changed test files is a win32 file or in the Windows CI job's list, so that job runs them as before. The new helper test, test-support.skip-on-win32.test.js, has win32 in its name, so the Windows job now runs it too (4 tests).

Specifically for `report-hook-killguard-4671` (271 skips): the Windows report hook is the node twin
(`engine/kosmos-report-hook.js`), which has **no kill guard at all**. So these skips remove no Windows coverage of
anything that runs there, and the gap itself (no kill guard on Windows) is a product question, carded as #8406.

## Not covered (later #8378 PRs)
tmux, POSIX modes, signals, the bare-bash files above, and the ~1,900 plain assertions; the stray `board.agent-claim` /
`board.person-start` files.

## Decided (review round 3)
- **The #1777 audit sees the helper.** engine/windows-tests-1777.test.js's host-branch pattern now matches
  `skipOnWin32(`, and the 18 files are in `HOST_BRANCH_EXCLUDED` (tools/windows-tests.js), each entry built from that
  file's own reason string. So a later `skipOnWin32` in a file nothing runs on Windows fails the audit until it is
  listed with why, as every other Windows-branching file must. Control (run): the new pattern with no entries fails
  the audit naming these files.
- **CLAUDE.md** (the Windows test-lists paragraph) names the helper, when to use it, the listing rule, and that a bare
  `bash` is no reason to skip.
- **Superseded in round 5 (see below):** `engine/defaults.test.js` skips both tests whole, though most of their assertions read the defaults text.
  Splitting the run step out, or relaxing its `ran >= 1` guard on Windows, would add a host branch for checks the Mac
  and Linux runs already make. What would change it: those text checks ever differing by platform.
- `tools.windows-tests-schtasks-7247.test.js` fails 2 on this box with or without this change (run on a checkout
  without it): not this PR's.
- (round 4) The helper's comment and the Change bullet above now say the audit sees the call (they still said it did
  not). The audit also checks that each listed skipOnWin32 file's entry carries the file's own reason, so the two
  copies cannot drift (control, run: one word changed in a listed reason fails it, naming the file). Reasons: defaults
  says neither shell exists on Windows; killguard says "the Mac and Linux kill guard".

## Decided (review round 5)
- **engine/defaults.test.js is fixed, not skipped.** On Windows agents are taught the heredoc and stdin forms for Git
  Bash (engine/defaults.js), so skipping those two tests lost the one check that the taught forms run in the shell they
  are taught for. Each now runs the examples in whichever of /bin/bash and /bin/zsh exist, and in bare `bash` where
  neither does (Git Bash on Windows). No host branch, so the file leaves HOST_BRANCH_EXCLUDED. On the box: 30 of 30
  pass, the #6653 control (a double-quoted `$1,200` loses its number) included.
- The #1777 audit, for an entry that says "its only win32 branch is skipOnWin32", now also checks that every call in
  the file has a single-quoted reason the entry carries, and that the file has no other host branch (control, run: a
  `process.platform === 'win32'` line added to a listed file fails it, naming the file).
- killguard's reason now says Windows does not install that hook (its hook is the node twin, with no kill guard:
  #8406), rather than "cannot run": Git Bash could run the .sh, as toolfail-6071 shows.
- toolfail-6071's comment says Git Bash is reached when it is ahead of the WSL launcher on PATH.
