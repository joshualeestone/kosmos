# worlds-abandon-visible-2628 -- surface the silent world-switch abandon

Card: joshualeestone/kosmos#2628 (multi-Kosmos switching broken). This branch is the
VISIBILITY half that Splinter greenlit; the ROOT cause (a named world not booting on
Josh's installed machine) is parked needs-operator for his board log.

## The problem this fixes

When a switched-to world will not boot, `engine/worldbootguard` (#2528) correctly abandons
it and falls the board back to the default world (Kosmos 1), logging ONLY to stderr. The
switcher's `worldswReconnect` poll then only sees the board come back on the default world,
never matches the world it asked for, and waits out its full 150s timeout on a bare spinner.
The user is dumped on Kosmos 1 with no explanation -- exactly Josh's "the restart errored and
I am back in Kosmos 1." The silent recovery is why the whole thing reads as "switching is just
broken."

## The fix (additive, no change to the switch/registry/boot logic)

1. `engine/worldenv.js`: when a boot abandons a world, record `{id, name, at}` in a
   module-level `abandonedWorld` (captured BEFORE `setActiveWorld` flips the pointer, so the
   name is the abandoned world's). Export `lastAbandonedWorld()`. Null on a normal boot.
2. `server.js` `/api/status`: expose `lastAbandonedWorld`.
3. `web/index.html` `worldswReconnect`: when the board is back but the requested world was
   abandoned (`lastAbandonedWorld.id === switchedId` AND `at > start`), say
   "'<name>' could not start, so Kosmos brought you back to Kosmos 1..." at once instead of
   timing out. Do not reload (the point is the person reads why).

## Decisions

- **The `at > start` guard is load-bearing.** `lastAbandonedWorld` persists for the life of a
  board, so a world that failed on an EARLIER boot would false-fire the instant the reconnect
  first reaches the still-running old board, before this switch's restart. Only an abandon
  stamped after this switch began is this switch's. (Verified in the unit test that `at` is
  from the current boot.)
- **In-memory, not persisted.** The board that abandons is the same process that serves
  `/api/status`, so in-memory suffices; a fresh successful boot starts null. No reset needed.
- **Fallback is always Kosmos 1** (the #2528 abandon target is DEFAULT_ID = "Kosmos 1"), so
  the message names it directly.

## Verification

- `engine/worldenv.abandon-2628.test.js`: an abandon records id/name/at and falls back to
  default; a healthy boot records null. (Passing, plus the 6 existing worldenv tests.)
- **Browser-check: deferred to a follow-up, done via the `Browser-check:` trailer.** The
  reconnect branch is additive and deterministic and the engine signal is unit-tested; a proper
  Playwright scenario (drive `worldswReconnect` against a stubbed `/api/status` returning
  `lastAbandonedWorld`, assert the message + no reload, plus a stale-`at` negative case) belongs
  in / beside `docs/browser-checks/render-worldswitch-2238.js`, which is the #1704 switcher
  harness (Angel's lane) and needs a claude-fe/Playwright session. Filed as a follow-up so it is
  tracked rather than skipped.

## Weakest premise

That the in-product message is the right shape without live-screen confirmation from Josh. What
would change it: his read of the wording, or discovering the fallback is not always Kosmos 1 (it
is, per #2528). The message is copy Josh can trivially reword; the mechanism is the deliverable.

## Not in scope

The ROOT cause (why Home does not boot on his machine) -- parked needs-operator for the board
log. This branch only makes the existing silent recovery visible.
