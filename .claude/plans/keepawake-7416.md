# keepawake-7416: keep this computer awake while agents are working (kosmos#7416 slice 3)

Base: origin/main (slices 1 and 2 merged: #7479, #7476).

## Decided (card comment 6464053404, Mona Lisa's wording above it)
- The board holds macOS's own `caffeinate -i -w <board pid>` while the switch is on and any card on the roster reads
  `working`, and stops it when none does. `-i` is idle sleep only; `-w` ties caffeinate to the board process, so a board
  that dies cannot leave the computer held awake. Rejected: `pmset` (admin rights, outlives Kosmos).
- Working is the board's own card state (safeRoster), never a second derivation. A stale self-report decays after
  status.REPORT_WORKING_DECAY_MS (5 min), so a stuck turn holds at most about that long past its last report.
- Rejected: holding while engine/limitqueue.js keeps messages for an out-of-usage agent. That can be hours with nothing
  running, and the switch says "while agents are working".
- Off by default; a missing or unreadable setting reads off.
- One 30 s pass (macOS's shortest sleep setting is a minute). The roster is read only while the switch is on.
- A roster that could not be read leaves the hold as it is (engine/keepawake.js pass): letting go then could put an
  idle computer to sleep mid-turn. After ten unread passes in a row (five minutes, the same as a stale self-report)
  it lets go. The switch going off, or reading unreadable, lets go at once without a roster.
- The switch rides on /api/machine's sleep row (`keepAwake: {on, holding}`) only when the setting was read, as
  startAtSignIn does, so a position nobody checked is never drawn. PUT /api/keepawake-setting is screen-only, 409 off a Mac.
- Mac only. The Windows half (SetThreadExecutionState) goes to Homer after this merges.
- startAtSignInClick and keepAwakeClick share machineSwitchClick; the shared function keeps the existing
  `set-machine-msg` line unchanged (that id splits to the surface token `msg`, mapped by 39 browser checks).

## Weakest premise
A turn that runs past 5 minutes with no tool call has a decayed self-report, and holds only if the scraped fallback
also reads working. Measured once this ships, by reading the card during a long turn.

## Proof
- engine/keepawake-7416.test.js: the rule on real fleet cards; the holder with a fake spawn (args, single start, stop,
  outside exit, stale exit, spawn failure, non-Mac); the setting's defaults.
- server.keepawake-7416.test.js: the route (default, screen-only, boolean-only, 409 off a Mac) and the sleep row field.
- web.keepawake-7416.test.js: the switch drawn only from a read setting, the holding line, the click repaint.
- Mutations: wants() ignoring state reds the engine test; dropping the `ka.ok` gate reds the server test.
