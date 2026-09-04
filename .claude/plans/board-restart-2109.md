# #2109 - step-10 local board restart: warn on a slow/down board, fail only on stale

## The bug
`tools/release.sh` step 10 restarts the developer's local board and calls
`restart-local-board.sh`, which waits `KOSMOS_BOARD_WAIT_SECS` (120s, #2090) for the board
to serve the new version, then exits 1 if it does not. Under heavy fleet load BOTH cuts
tonight (0.6.27, 0.6.28) had the board come back at ~121s+ - just past the deadline - so
the cut exited 1 on a **fully-served, verified** publish (steps 8-9 already passed). A green
publish reading as a failed cut is misleading and invites a needless re-cut.

## The key insight (makes the fix safe)
Step 10 exists to catch #360: the local board **serving STALE code** because launchd did not
restart it. Crucially, launchd runs the board **FROM THIS REPO** (the script checks
`WD == REPO`), so a board that is *restarting* always comes back on the code **on disk** (the
new version), never the old. Therefore:
- The ONLY way the board serves the OLD version after the deadline is if launchd never
  restarted it -> `got` is the old version (non-empty) the whole time. That is #360, a real
  failure -> FAIL (exit 1).
- A board that is NOT answering (`got` empty / 'none') is down or mid-restart. It is NOT
  serving stale code, and it will come back on the new code. That is slow, not wrong ->
  WARN, do not fail the cut (the bytes already served and verified).

## The change
`tools/restart-local-board.sh`:
- `wait_for_want` returns 0 (serves wanted), 1 (genuine failure: empty-want OR board still
  SERVING A DIFFERENT non-empty version = #360 stale), or 2 (board NOT answering = silent).
- A shared `board_outcome_exit` maps the outcome for both call sites (the poll-only test seam
  and the real restart): rc 0 -> exit 0; rc 2 -> print a WARNING and exit 0; rc 1 -> exit 1.
  Uses `|| rc=$?` so set -e does not abort on the non-zero return.
- Update the header comment: stale still reds; a silent board now warns.

## Tests (`tools/test-restart-local-board.sh`)
- Keep: success arm (exit 0), slow-but-healthy flip arm (exit 0), empty-want (exit 1),
  bad-knob (exit 1), zero-padded knob (exit 0).
- Change the **stale arm**: a board serving a DIFFERENT version forever still exits 1, but
  assert the NEW message ("STILL SERVING <ver>, NOT <want>" / #360), not the old wording.
- Change the **not-answering arm**: a dead URL now exits 0 with a WARNING (was exit 1) - this
  is the exact behaviour #2109 adds; assert exit 0 + the warning text.
- Add an explicit arm proving stale (exit 1) and silent (exit 0) DIVERGE, so a regression that
  collapses them back is caught.
- Prove each changed arm red-capable.

## Out of scope
Widening the 120s deadline further (#2109 makes the hard-fail conditional instead; the 120s
knob stays as-is for how long to wait before deciding). release.sh step 10 keeps calling with
120s; no release.sh change needed beyond what already exists.
