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

## Review 1 (blind, opus, 06:3x)
- [WARNING] A clock set BACKWARD (network time on a fresh Mac) made `now - since` negative, leaving the row on Checking
  until the clock caught up, which is the bug itself. FIXED: a start time in the future restarts the spell. New arm:
  an hour's backward jump, then Turn On after the grace period. Mutation (no reset): 1 red.
- [NIT] A browser tester (no native app) now sees "Not activated" for a grant the page cannot read, and Turn On opens
  System Settings on the BOARD's Mac. ACCEPTED: Next is never gated, and Splinter's ruling is client-side. The
  `nativePresent` server variant stays the option if it ever bites (recorded under Rejected above).
- [NIT] Overlapping polls (interval + Check again) can land out of order and repaint Checking for one tick. Predates
  this branch and self-corrects; no change.
Checked clean by the reviewer: Check again shares the clock (correct), S2 and sleep have no turnOnAfterMs, the Turn On
handler has no condition on data-checking, the mock switch mirror, Windows (platformHides filters the row out), no
browser check asserts Checking on this row, and sibling suites 1214 (11), 2620 (5), win32-board-copy (29).

## Review 2 (blind, sonnet, 06:3x): converged
No BLOCKER. Checked sound: the gate-name key (one screen polled at a time, the map cleared per screen; no two rows share
a name today), timing (nowMs read after the fetches, Turn On on about the 6th tick, about 4.5 s), visibility (with
neither data-checking nor data-granted the CSS shows .s3-req and Turn On; the click handler ignores gate state), and
test strength (each guard has an arm that reds without it).
- [WARNING] The pill says "Not activated" when the truth is UNKNOWN; on a no-FDA Mac where the grant exists, the row
  stays red. DEFERRED to Mona Lisa as a copy decision (she owns this screen's words), raised on #2559: an honest
  "Not confirmed" pill beside Turn On is the likely answer. Why not tonight: it is Josh-visible copy, Next is never
  gated, and pressing Turn On shows the setting already on. What would change my mind: Mona's wording, or Josh's run
  showing a granted Mac stuck red.
- [NIT] Nothing announces the Checking to Turn On swap to a screen reader. DEFERRED: #fr-s3-msg also carries the
  Turn On failure message, and writing status there risks overwriting it. Part of the same copy follow-up.
- [NIT] performance.now() instead of Date.now(). Not taken: the backward-jump reset covers the trap, and a forward jump
  only shows Turn On early.
- [NIT] A failed fetch counts as uncheckable, so a briefly-down board also offers Turn On after 4 s. Accepted: never gates.
- [NIT] No arm drives a route-supplied actionable:true. Dormant path; accepted.

## Copy, ruled by Mona Lisa (06:38, then 06:50 after a correction)
- The unsure state (uncheckable, Turn On offered) shows a NEUTRAL "Not confirmed" pill beside Turn On; the red
  "Not activated" is kept for a grant Kosmos KNOWS is off; green "Activated" unchanged. (`data-unsure`, set only for
  an uncheckable + actionable read.)
- One quiet dhint line directly under the row, in the unsure state only: "Kosmos cannot check this yet. If you have
  already turned it on, press Next." Her first ruling dropped this line on the belief that Next was disabled there;
  I corrected that (an uncheckable row never gates Next) and she added it, correcting her #2559 comment in place.
- No data-win-hide on the line: on Windows the row is filtered out before any poll, so it never gets data-unsure.
  (Adding it first broke web.win32-board-copy's count of hidden surfaces; removed.)
This supersedes review 2's deferred WARNING and NIT (copy and the screen-reader hint): resolved by her ruling.
render-gated-next (real browser, 06:58): the unsure arm shows Turn On + Not confirmed + the line, no red pill, no
Checking, Next not blocked; the line stays hidden once the grant is read. click-first-run passes. 12 related node
test files 132/132. Mutation: never setting data-unsure reds the unit test.
