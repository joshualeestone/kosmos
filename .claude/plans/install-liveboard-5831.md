# install-liveboard-5831: the full install test must not restart the live board

Card: #5831. Asked for by Liu Kang (m4954): make the fix the leg's own isolation, not "do not run it here", and
add a control that fails if the real com.kosmos.board pid changes during the run.

## What happened

A full `tools/test-install.sh` run on Mortals on 2026-10-11 restarted the live board at 08:50:44Z (pid 21886 to
23352, last exit -15). launchd had it answering again within a second. The leg that did it is the #924 control,
"a DEFAULT KOSMOS_HOME with AGENT_WORKFORCE_DATA unset still targets Application Support".

## Why

- The leg unset `AGENT_WORKFORCE_LAUNCH` on purpose and pointed `HOME` at a fake folder.
- A fake `HOME` scopes files. It does not scope the launchd domain. With `KOSMOS_HOME` at its default the label
  is the bare `com.kosmos.board`.
- Since the board became launchd-supervised (#2956), `kosmos start` asks launchd whether that label is loaded
  (`_kosmos_board_supervised` in `install/kosmos`) and kickstarts it. On a Mac with Kosmos installed that is the
  real board. With `AGENT_WORKFORCE_LAUNCH` set, that function returns 1 and a plain board is started instead.
- The same class as #946 (the leg's uninstall half, fixed by pinning LAUNCH) and #1539.

## The change (tools/test-install.sh only)

1. **The leg's own isolation.** The control install pins `AGENT_WORKFORCE_LAUNCH` to the fake home's
   LaunchAgents, as its uninstall already does. The `kosmos stop` after it gets the same pin.
2. **The half-sandbox guard.** Pinning LAUNCH while DATA, PROJECTS and WORKERS stay unset is the shape
   `engine/sandbox.js` refuses (#634). Those three are unset on purpose (the default data root is what the
   control is about) and under the fake HOME their defaults resolve inside the sandbox, so the leg states the
   guard's own override, `AGENT_WORKFORCE_HALF_SANDBOX_OK=1`, for this one install.
3. **The control Liu Kang asked for.** The harness records the real `com.kosmos.board` job's pid and start time
   at the start (`live_board_id`) and the closing checks fail if it differs at the end. Full run only: under
   `KOSMOS_INSTALL_GATE=1` a release cut may restart the build Mac's board for its own reasons. With no such
   job loaded it prints a note and checks nothing.

## Rejected

- **A sandbox KOSMOS_HOME for the leg.** The leg exists to prove the DEFAULT home's data root; moving the home
  removes what it tests.
- **"Do not run the full harness on a box with a live board."** Liu Kang ruled it out, and it is how the fault
  stayed hidden.
- **Checking the port only.** The harness already did; a restart that launchd heals in a second passes it.

## Done looks like

- A full run on Mortals, with the live board up, ends with the #924 control passing and the new closing check
  passing, and my own before and after read of the live board's pid and start time agrees.
- The new closing check can fail: with the old leg it must go red (shown by the 08:50Z run's restart; the
  planted control is a changed `LIVE_BOARD_BEFORE`, not a second live restart).

## Weakest part

The "can it fail" proof for the closing check is a planted wrong value, not a real restart, because a real one
costs every agent on this Mac a board restart. The real restart is on record once, from before the check existed.

## Measured (2026-10-11, head 35ab3d540, Mortals, live board up)

- Full `tools/test-install.sh`, in the fair queue: 398 passed, 0 failed, exit 0.
- `#924 control (default KOSMOS_HOME) install exits 0`: PASS (it was the 1 failure of the run that restarted the
  board). `control uninstall exits 0`: PASS.
- The new closing check: PASS, "the same process as when this run began: 23352 started Sun Oct 11 03:50:44 2026".
- My own read outside the harness, before and after: pid 23352, same start time. The board was not restarted.
- Planted control for the closing check: `live_board_id` compared with the old pid (21886) and another start
  time is not equal, so the check goes red on a changed process.
