# win-skip-tmux-8378: the tmux cluster of #8378 (kosmos#8378)

**Posture:** production

## Problem
#8378 (phase 2 of #8368), second cluster. The first (PR #8408) added `skipOnWin32` and took the tests that run an
absolute POSIX path or a script by its shebang. This one takes the tests whose failure on Windows is tmux: a fake tmux
written as a `#!/bin/sh` script (which Windows cannot run by its shebang), or a real tmux server, which Kosmos does not
run on Windows.

## How the set was chosen
From the #8368 inventory (main 53a164708d), the files whose every failing test names tmux (8). Re-measured on main
c94894ce11 and every failing test's first error line read. Four are in this PR. Left for later clusters (their
failures are not tmux, despite the name): `tools.sbom-o05` (tar and a control character in a file name),
`engine/create.tmux-linux-4917` (a Linux path assertion), `engine/connect-oldjob-8294` (a null label);
`server.post-project-2837` was done in the first cluster.

## Change
**Fixed, so they run on Windows (5 tests).** Review round 1 showed the tmux in these is only the fixture's way of
giving the board an empty fleet, and the logic under test runs on the Windows board too:
- `server.agent-id` (#170, #704): the child board now gets its roster through `status.setPaneSource`, the seam the
  Windows board itself uses (server.js wires win32roster into it). Empty for #170; for #704 null three times (a failed
  look, the same fact a refusing tmux gave: engine/status.js) and then empty. Control, run: with no failed looks #704
  goes red ("the seam did not engage").
- `server.socket-split` (#668): the same seam gives the empty fleet; it already faked launchctl and forced the darwin
  probe on every non-Linux host. Its own control (a parked job keeps the plain verdict) passes beside the two arms.
- In both, the `#!/bin/sh` stub tmux stays only because the sandbox guard requires AGENT_WORKFORCE_TMUX_BIN (#1651);
  with a pane source set, nothing runs it. On macOS and Linux the tests now read the roster through the seam too, which
  is what their subjects (ids, the poll, the ghost row) need; how tmux is read is tested elsewhere.

**Skipped on Windows with their reason (5 tests):**
- `engine/status.panes-async-6173` (all 4): its subject is the tmux roster itself (async against sync, the board
  turning while tmux answers), faked with a `#!/bin/sh` slowTmux. The fourth ("a tmux that cannot be asked") used to
  pass on Windows only because neither driver could spawn the fake at all, so it never reached the case it names;
  it skips with its siblings.
- `engine/last-look` (1 of 5): reads a real tmux server of its own. Constant `SKIP_NO_TMUX`.
- `tools/windows-tests.js`: those two files in HOST_BRANCH_EXCLUDED (20 entries now), each built from the file's own
  reason, which the #1777 audit checks.

## Result (each file run alone on the Windows box, the no-schtasks preload)
socket-split 3 pass (was 3 failing), agent-id 2 pass (was 2 failing), status.panes-async 4 skipped (was 3 failing, 1
passing vacuously), last-look 4 pass and 1 skipped (was 1 failing). The #1777 audit 24 of 24. Nothing outside these
files and the list can move: only tests and the list changed.

## Weakest premise
That the Windows board needs no test of its own for what status.panes-async covers. The roster on Windows is read
without tmux (engine/win32roster.js and its tests, run by the Windows job); a Windows twin of the #6173 "the board keeps
turning while the roster is read" check was not looked for here.

## Not covered (later #8378 PRs)
POSIX modes, signals, the bare-bash files, the three held-back files above, and the plain assertions. The new list
entries sit at the top of HOST_BRANCH_EXCLUDED rather than in an order; reordering that list is left alone here.
