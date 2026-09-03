# phonehome-defaults-2013 -- flip the two in-machine defaults ON (#2013)

## Goal
Two of Kosmos's four phone-home / autonomy settings should default ON so a fresh
install behaves the way the product intends without the operator hunting for a
toggle. This flips the two that are safe to default ON and are decided, and
deliberately HOLDS the two that are not.

## What ON-by-default means, per setting
- **heartbeat** (`engine/heartbeat-setting.js`): missing config -> on. A present
  boolean is honoured (`typeof x === 'boolean' ? x : true`). A CORRUPT/unreadable
  config -> OFF (fail-safe): we do not start phoning home on a config we could
  not parse.
- **autohandoff** (`engine/autohandoff.js`): missing config -> on. Present boolean
  honoured. A CORRUPT config -> ON, documented as a DELIBERATE choice: autohandoff
  is an in-machine convenience with no external emission, so the safe-by-default
  direction is ON, unlike heartbeat.

## Out of scope / HELD (card #2020)
- **notify** and **ping** are NOT flipped. Josh removed them on 2026-08-26 and a
  later 2026-09-03 ruling points the other way; the two rulings conflict and only
  Josh can reconcile them. `notify.js` and `ping.js` are left at their prior
  default. This is the irreversible-consequence carve-out: an external-emission
  default is not an agent's call. Tracked as #2020.

## Supporting changes
- `engine/remote.js`: no behaviour change; a comment recording the commercial
  reason the paid-relay default must STAY OFF (it must never auto-enable).
- Tests updated to the new contracts: `engine/autohandoff.test.js`,
  `engine/heartbeat-setting.test.js`, `server.heartbeat-1722.test.js`,
  `server.test.js` (the #1724 contract), `web.autohandoff-1724.test.js`,
  `web.heartbeat-1722.test.js`.
- `web/index.html`: the Settings copy and hints that still read "Off by default"
  now read "On by default", plus stale comments corrected.

## Decisions made in flight (challenge-loop iters 1-3, already committed)
- iter 1: a server-level heartbeat default test asserted the old default; fixed.
  remote's comment corrected.
- iter 2: a second missed default contract (`server.test.js`, #1724), the
  corrupt-config sign-off (heartbeat OFF / autohandoff ON), and frontend drift.
- iter 3: the USER-VISIBLE Settings hints still said "Off by default" (prose a
  code-pattern grep missed); fixed, plus 5 stale comments.

## Verification
- engine + server + web unit suites green.
- No user-facing "Off by default" string remains for these two settings.
