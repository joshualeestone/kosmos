# Plan: register board-served-tree-check in the fleet-monitor registry (#3250)

## Problem

The #3239 fleet-monitor registry (`engine/fleet-monitors.js`) is the single source of
truth the audit (`tools/fleet-monitor-audit.js`) reads as its expected set: a monitor
NOT in the registry cannot be reported missing. `com.stonesyndicate.board-served-tree-check`
is a LIVE loaded launchd monitor (verified against `launchctl list`) whose source lives at
`Josh-Brain/Tools/fleet/board-served-tree-guard.sh` (the #1051 guard: catches the board main
checkout serving an unmerged or dirty tree), but it was absent from the registry. Its loss on
a box rebuild would therefore have been a silent gap. Measured 2026-09-18: 8 fleet monitors
loaded, the registry declared 7.

## Change (Part 1 — the reversible, unambiguous half)

1. Register the monitor in the frozen `FLEET_MONITORS` array with its label, purpose, and
   `source` (the deploying-repo-owned guard, mirroring `fleet-drift-check`), per the #3243
   deploying-repo-owned seam.
2. Update the header comment counts: "7 monitors" to "8", "one in Josh-Brain" to "two".
3. Add a red-capable test (`#3250: board-served-tree-check is registered`) that fails if the
   entry is removed or its `source` string is wrong.

## Deliberately deferred (Part 2 — the loaded-but-unregistered inverse check)

The card's second "Consider" item asks for a check that flags a LOADED monitor absent from the
registry (the inverse of today's registered-but-missing audit). This is deferred, deliberately:

- It contradicts `engine/fleet-monitor-audit.js`'s documented directional contract: "A label
  loaded on the box that is NOT in the expected set is deliberately ignored... flagging unknown
  labels would make it noisy about every unrelated LaunchAgent." Reversing that is a design
  change, not a bug fix.
- The "which loaded label is a monitor" bound is genuinely fuzzy: operational jobs
  (`com.kosmos.board`, `board.watchdog`, `night-shift`, `night-report`, `daily-note-prompt`,
  `builder-progress`, `pigeonpete-midnight`) share the `com.kosmos.*` / `com.stonesyndicate.*`
  prefix. A prefix match flags all of them.

Recommendation for a follow-up if the fleet wants it: implement the inverse check as an
ADVISORY, non-gating reporter over a conservative monitor-token allow-set, rather than failing
the audit and silently overriding the existing contract.

## Test plan

- `node --test engine/fleet-monitor-audit.test.js` green (the new red-capable test plus the
  pre-existing manifest-well-formed and audit-verdict tests).
- Full `yarn test` green.

## Not in scope

- Installing the monitors (the #3243 cross-repo source consolidation + idempotent installer).
- Per-host `scope` modelling (a documented #3239 follow-up refinement).
