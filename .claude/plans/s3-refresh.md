# Plan: S3 "Check again" button + faster gate poll (#2451/#2559, Josh 0.6.50 7.58.24)

## Problem (Josh, 0.6.50)
On the first-run Automation screen (S3), after Josh granted Accessibility and came back, the
screen "sat here forever before it finally activated the Next button... what the hell is going
on, I can't continue forward." Two asks: (1) a manual "check again"/refresh so the user can
re-trigger the check, and (2) a faster check cadence. (He gave phrasing latitude.)

## Fix (web/index.html only)
- **Faster poll:** the gate poll (`frPollGates` via `FR_GATE_TIMER`) ran every 1500ms. Named it
  `FR_GATE_POLL_MS = 750` (2x faster) so a just-granted permission reflects within about a second.
- **Manual re-check:** a "Check again" button (`.s3-recheck.fr-recheck`) on the S3 pane, left-
  aligned under the gate rows per Josh. The fr-pane-3 delegated click handler routes it to
  `frRecheckGates()`, which fires an immediate `frPollGates(FR_GATE_SCREEN, FR_GATE_GEN)` on the
  active gated screen. `frGateStart` now stores `FR_GATE_SCREEN`; `frGateStop` clears it.
- The button is a quiet SECONDARY control (it grants nothing; it only re-polls). The poll keeps
  running regardless; the button only front-runs the next tick.

## Decisions
- Placed on S3 (the screen Josh hit); the mechanism (frRecheckGates) is general, but scope is the
  Automation screen per the report. A general placement on S2 is a possible follow-up, not this.
- Phrasing "Check again" (Josh gave latitude); Mona can refine wording later.
- 750ms (not lower): fast enough that the wait is not noticeable, not so fast it hammers the board
  on the single HTTP thread.

## Verification
- `web.firstrun-a11y-1214.test.js`: the button markup, `FR_GATE_POLL_MS < 1500`, the timer uses the
  constant, and the handler routes `.fr-recheck -> frRecheckGates`. Also FIXED an existing sibling
  test whose fixed-offset handler slice broke when the fr-recheck branch grew the handler -- bounded
  both slices to the handler's own `\n});` (the eval-slice-window trap).
- `docs/browser-checks/render-gated-next.js`: a net block -- the "Check again" button exists + reads
  "Check again"; clicking it fires an IMMEDIATE /api/a11y-status re-check (a new request lands inside
  150ms, less than the poll interval, so it is attributable to the click not the timer) and unlocks
  Next once the grant has landed. Satisfies #1720 (web change carries a browser-check assertion).
- Full run-tests.sh.
- Weakest premise: that 750ms is "fast enough" for Josh's perception. It is a one-line tune if he
  still finds it slow; the manual button covers the impatient case regardless.
