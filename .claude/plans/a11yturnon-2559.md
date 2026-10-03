# a11yturnon-2559: the onboarding Kosmos row offers Turn On after a few seconds of Checking

Card: joshualeestone/kosmos#2559. Day-one, assigned by Splinter 2026-10-03 06:11 from Baron's read of server.js.

## Problem
The first-run Automation screen's Kosmos row (`data-gate="tmux"`) polls `/api/a11y-status`. On a fresh Mac with no
Full Disk Access, `appGrant()` cannot read the TCC database, and the route trusts the native app's own `read()` only
when it says GRANTED. So the route answers `{checkable:false}` with no `actionable` flag. `frReadGate` returns
`uncheckable`, `frPollGates` sets `data-checking`, and the row shows "Checking..." with NO Turn On, for as long as the
screen is open. A newcomer's first real screen offers no action.

## Decision (Splinter's ruling: client side, keep the trusted Activated read)
- `FR_GATES.tmux.turnOnAfterMs = FR_CHECKING_TURN_ON_MS` (4000).
- `frPollGates` records, per gate name, when a row first read `uncheckable` (`FR_CHECKING_SINCE`). Any other reading
  clears it. Once the row has been uncheckable for `turnOnAfterMs`, its read is marked `actionable`. That reuses the
  #3113 path, dormant since the tmux row was removed on 09-19: the row paints the default "Not activated" + Turn On.
  The state stays `uncheckable`, so it never sets `anyBlocked`: Next is never gated by it.
- `frGateStart` clears the clock, so every screen gives Checking its grace period first.
- Scope: the Kosmos row only. The sleep row is advisory and keeps its own Checking. The S2 file-access row is inert to
  `data-checking`.

Rejected:
- A server-side `actionable` from `/api/a11y-status` when `nativePresent()` holds. It is more precise (a browser tester
  would keep Checking), but it depends on the native app's presence marker, which is exactly what may be missing on a
  fresh install, and it was not the ruling.
- Showing Turn On at once: the grace period lets a grant that IS readable land first, without a flash of red.

Weakest premise: that Turn On is the right action when the grant cannot be read. On a Mac where Kosmos IS already
granted but FDA is missing, the person sees "Not activated" for a setting that is in fact on. Turn On then opens the
Accessibility pane, where they find it already on. Honest but slightly confusing. Pressing it changes nothing harmful,
and Next is never blocked.

## Tests
`web.a11y-turnon-2559.test.js` runs the page's real `FR_GATES`, `frReadGate` and `frPollGates` (lifted from
web/index.html) with a fake DOM, fetch and clock. Arms:
1. Checking first, still Checking at grace - 1 ms, Turn On at grace; never a false green; Next enabled.
2. A granted read is green at once. CONTROL: a definite not-granted still gates Next (#2911 unchanged).
3. The clock restarts after any other reading.
4. Scope: the sleep row keeps Checking.
5. frGateStart clears the clock before its first poll.

Red on today's code: main's web/index.html fails all 5. With only the `actionable = true` line removed, arms 1, 2 and 4
red. 12 node test files touching the gate code: 130/130. Coarse and surface browser-check gates are green.
Browser checks render-gated-next and click-first-run, through tools/browser-checks.sh at the fix commit: both PASS (06:32).

## Status
- [x] fix + test (cf. commit "a11yturnon-2559 -- the Kosmos row offers Turn On ...")
- [ ] browser checks, blind review, full validation, proof, PR, merge (0.7.21 if before Baron pins it, else 0.7.22)
