# win-skip-tmux-8378: the tmux cluster of #8378, tests that need a tmux, skip on Windows with their reason (kosmos#8378)

**Posture:** production

## Problem
#8378 (phase 2 of #8368), second cluster. The first (PR #8408) added `skipOnWin32` and took the tests that run an
absolute POSIX path or a script by its shebang. This one takes the tests whose failure on Windows is tmux: a fake tmux
written as a `#!/bin/sh` script (which Windows cannot run by its shebang), or a real tmux server, which Kosmos does
not run on Windows.

## How the set was chosen
From the #8368 inventory (main 53a164708d), the files whose every failing test names tmux (8). Re-measured on main
c94894ce11 and every failing test's first error line read. Kept (4):
- `engine/status.panes-async-6173` (3 of 4 tests): AGENT_WORKFORCE_TMUX_BIN points at a `#!/bin/sh` fake (slowTmux).
- `server.socket-split` (3 of 3): a `#!/bin/sh` fake tmux for the board's roster, and its subject (#668) is the job
  states launchctl reports.
- `server.agent-id` (2 of 2): the board's roster through a `#!/bin/sh` fake tmux.
- `engine/last-look` (1 of 5): reads a real tmux server of its own (its own message: "this test needs tmux installed").
Left for later clusters (their failures are not tmux, despite the name): `tools.sbom-o05` (tar and a control character
in a file name), `engine/create.tmux-linux-4917` (a Linux path assertion), `engine/connect-oldjob-8294` (a null label),
and `server.post-project-2837` (done in the first cluster).

## Change
- 4 test files: the failing tests get `{ skip: SKIP_POSIX_SHELL }` (or `SKIP_NO_TMUX` in last-look), each reason naming
  the mechanism; the other tests in those files still run on Windows (status.panes-async 1, last-look 4).
- `tools/windows-tests.js`: the 4 files in HOST_BRANCH_EXCLUDED, each entry built from the file's own reason (the #1777
  audit requires it and checks the two agree).

## Result (each file run alone on the Windows box, the no-schtasks preload)
9 tests that failed now skip with their reason; 0 failing in the 4 files; pass counts unchanged (5 pass as before).
Nothing outside these files and the list can move: only tests and the list changed.

## Weakest premise
That the Windows board needs no test of its own for what these cover. The roster on Windows is read without tmux
(engine/win32* modules, with their own tests run by the Windows job), so these skips remove no Windows coverage of code
that runs there; a Windows twin of the #6173 "the board keeps turning while the roster is read" check is not looked for
here.

## Not covered (later #8378 PRs)
POSIX modes, signals, the bare-bash files, the three held-back files above, and the plain assertions.
