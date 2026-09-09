# Plan: world-switch lockout recovery guard (#2528, P0)

## Problem (measured, not assumed)

Josh, 0.6.49 staging: created a Kosmos "Home", clicked it, hit Restart, and the app
showed "Kosmos is not answering on this computer -- nothing answered at
127.0.0.1:16686". Reload and quit+reopen both hard-failed the same way -- he was
locked out of the app with no way back in.

Root cause, confirmed on current main:
- `engine/worlds.js setActiveWorld` commits the new `activeWorldId` the instant
  POST /api/worlds/active is called (`reg.activeWorldId = id; writeRegistry(...)`),
  BEFORE the board has restarted and confirmed the new world's board serves.
- So if that board never comes up (any reason), the pointer is poisoned: every
  relaunch boots the same dead world and hard-fails. UNRECOVERABLE from the UI.
- #2454 (merged, and IN 0.6.49) made the installed board able to self-restart, but a
  board that restarts and STILL does not serve leaves the same poison -- which is
  exactly what Josh hit, on a build that already carried #2454. #2454's own text
  routes the live create+switch+reboot verification to Angel/Mona Lisa.
- `worldenv.js bootstrapWorldEnv` only fails open for a MALFORMED/absent registry,
  not for a VALID-but-unbootable world, so the "Home" case is not caught.

## Fix: make the lockout RECOVERABLE (never permanently trapped)

A boot-attempt guard (`engine/worldbootguard.js`): a per-world counter in
`<base>/.world-boot-attempts.json`.
- `bootstrapWorldEnv` records an attempt for a non-default active world BEFORE
  applying its env (so a boot that crashes before serving still counts).
- `server.js onListening` clears that world's counter the instant the board is
  `listening` (a real serving state), so a HEALTHY world returns to zero every boot
  and never approaches the threshold.
- When a non-default world has failed `THRESHOLD` (3) consecutive boots,
  `bootstrapWorldEnv` ABANDONS it: it resets the pointer to the DEFAULT world (which
  always works -- it is the base install, no override), clears the counter (so a
  deliberate retry starts fresh), and boots default. The user lands back on their
  default Kosmos, never permanently trapped. The failed world's entry is PRESERVED
  (not deleted) so they can retry or delete it.

This cannot make a broken world boot; it guarantees the app is never bricked by one.
Everything is fail-open: a guard that cannot read/write its own state is swallowed
and treated as "0 attempts / do nothing", so it can never be the reason a board will
not boot.

## Decisions

- **Recoverability guard (boot-attempt fallback), not a two-phase commit.** The
  boot-attempt approach catches ANY reason a world's board fails (crash, wrong port,
  corrupt data), works even when the board crashes at boot (a two-phase promote could
  not), and is self-healing with no user action. A "don't commit the pointer until the
  new board answers" (two-phase) + a web "not-answering -> switch back to Kosmos 1"
  notice are better first-failure UX and are the follow-ups; the P0 is "never
  permanently locked out", which this delivers.
- **THRESHOLD = 3.** > 1 so a single transient failure (busy machine slow to listen,
  a user force-quitting mid-boot) does not abandon a healthy world (#708/#704
  contention is real); small so a genuinely dead world recovers in a few restarts.
  Named constant, easy to tune.
- **Reset the pointer to default on fall-back** so the switcher and the board agree
  (no "switcher shows Home, board serves default" split).

## Verification

- `engine/worldbootguard-2528.test.js`: 4/4. The keystone arm boots a never-serving
  world THRESHOLD times (each STILL tries the named world -- the fallback is
  conditional, proven non-vacuous), then asserts the next boot falls back to default,
  resets the pointer, preserves the Home entry, and clears the counter. Plus the unit
  (increment/clear/threshold), fail-open (unsafe id / no base), and a healthy-world
  arm (LISTENS -> cleared -> never trips).
- Neighbor tests green (24/24: worldenv.booted-2238, boardrestart-2238,
  worldenv-order) -- the boot-ordering invariant and the board restart are unaffected.
- Full run-tests.sh (pending). Weakest premise: that "listening" is a good enough
  "the world serves" signal; it would flip if a board can listen but be unusable, in
  which case the clear should move to a later health check -- but listening is the
  same signal the rest of start() treats as success.
