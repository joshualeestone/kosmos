# kosmos#8841 part 2, rebuilt on main after #8848 (2026-11-21)

## Decided
#8848 (merged 49ec926079) makes the usage poll and the mover on by default with 2+ Claude logins, evaluated on every
call, nothing kept from the start environment. The failure #8841 names (a restart silently drops an operator's
`=1`) cannot happen on main for a board with 2+ logins. So the kept switch (`engine/keptswitch.js`, ~870 lines with
its tests) is DROPPED. What this PR keeps is the screen half: Settings names the reason when readings or moves are
off because of the start environment (`..._OFF=1`, or the force variable set to anything but 1, or
`AGENT_WORKFORCE_AUTOBALANCE_SWEEP_OFF`), instead of only saying nothing is recorded or moved.

## Rejected
- (a) Keeping a forced-on `=1` across restarts on a one-login board: a test-board case; "nothing at all with one
  account" is Josh's 10-25 ruling, so a kept force there works against the ruling.
- (b) Keeping an env brake (`_OFF=1`, `=0`) across restarts. Settings (`autobalance.json`) is the off switch that
  persists, and since #8848 it also stops the usage reading. Keeping (b) would bring back the record, the
  computer-name question (a restored backup on a same-named Mac), and the unanswered question to Josh, for a case
  the persistent switch already covers.

## Weakest part
An operator who set an env-only brake (say during an incident) loses it at a restart and the default turns moves
back ON, silently in the log sense. Mitigation is partial: while the brake holds, Settings now says so, and the
board log names the mover's state at every start. Not mitigated: the moment it is lost.

## What would change my mind
A real case of an operator needing an off that a person's Settings switch cannot give (a fleet-wide brake applied
by launchd, say). Then (b) comes back as its own card, scoped to brakes only.

## Checks
- engine/usagepoll-offbyenv-8841.test.js (new, 4), web.autobalance-off-outside-8841.test.js (new, 5, runs the
  page's painter), server.autobalance-7152.test.js (+1 route case). Without the page change 2 of the 5 page tests
  go red; without the server change the route case goes red.
- 264/264 across the auto-balance, mover, usage poll, reachability and raw-write suites.
- Not run: the full suite locally, and docs/browser-checks/render-autobalance-7152.js (unchanged by this PR).
