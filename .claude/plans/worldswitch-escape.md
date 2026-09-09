# Plan: #2528 fast-follow - recover a switch-lockout on the FIRST failed reopen

## Problem (measured on Josh's 0.6.50, live prod)

Josh switched Kosmos 1 -> "Side Project"; its board never answered (:16687); the switch
hung ("quit and reopen Kosmos"); after ONE quit+reopen he got "Kosmos could not start"
and was locked out. This is on 0.6.50, which HAS the #2528 guard. Verdict (confirmed):
the guard recovers, but only after THRESHOLD=3 failed boots, so a user who gives up at
the first "could not start" (Josh did) never reaches recovery. Technically-correct,
UX-broken. (Ruled out: NOT #2559 listen-then-die -- it never listened; NOT native-upstream
-- bootstrapWorldEnv records the attempt at require-time before the crash.)

Architecture note that shapes the fix: there is ONE board (`com.kosmos.board`), restarted
via launchctl to switch worlds -- NOT a board per world. So once it restarts onto a dead
world, NO board answers, and a web "switch back" button has nothing to POST to. The
recovery must be engine-side, on the next board boot.

## Fix: a set-once "confirmed" marker (engine-only, no native exit codes)

Key on WHETHER A WORLD HAS EVER SERVED, not on "was this a switch":
- `server.js onListening` -> clears the count AND marks the world CONFIRMED (it reached a
  serving state at least once). Set-once; never cleared.
- `bootstrapWorldEnv` -> abandons via `shouldAbandon`, which fires when EITHER the world
  has failed THRESHOLD boots (a CONFIRMED world gone bad) OR it has NEVER served (not
  confirmed) AND has failed at least one boot (a world that never came up). The
  never-served branch is the fix: a world whose board never comes up falls back to default
  on the FIRST failed reopen, so Josh recovers on reopen 1 instead of reopen 3.
- `worlds.setActiveWorld` does NO switch-time marker bookkeeping (only the pre-existing
  count-clear for fresh tries). This is deliberate: it removes the pointer-vs-booted
  divergence a switch-time marker had (iter1/iter2 found a redundant/unmanaged-board
  switch-back could re-arm a switch-time marker on a healthy, already-serving world and
  then false-abandon it). "Has it ever served?" is a per-world fact that no switch can
  wrongly flip.

THRESHOLD stays 3 for the confirmed-world path (unchanged from the shipped #2528): the
never-served fast path below is what fixes Josh, and it is INDEPENDENT of THRESHOLD, so
there is no need to reduce a confirmed world's force-quit tolerance. An earlier draft
lowered it to 2; two blind reviews (iter1, iter5) flagged that as a mild false-abandon of
a healthy confirmed world (two consecutive force-quits-mid-boot -> abandon), so it was
reverted to 3. Josh's fix does not depend on it.

## Why this satisfies both goals
- Recovers Josh on reopen 1 (never-served fast path), the actual reported failure.
- Does NOT false-abandon a healthy world: once a world has served it is CONFIRMED forever,
  so a later force-quit (or a switch-back, no-op, or pointer-divergent switch) uses
  THRESHOLD=3 and tolerates the transients it always did. No switch can re-arm the fast
  path on a confirmed world. (Splinter's no-false-abandon requirement, and the iter1/iter2
  finding, both fully met -- the confirmed path's behavior is unchanged from 0.6.50.)

## Decisions / rejected
- Rejected a switch-time "pending" marker (the first design): worlds.setActiveWorld keys on
  the registry POINTER, but the route's no-op keys on the BOOTED world; on an unmanaged
  board the two diverge and a switch-back false-armed the fast path on a healthy world.
  The set-once confirmed marker keys on a per-world fact and has no such divergence.
- Rejected a blind THRESHOLD=1: it would false-abandon a force-quit of a confirmed world.
  The confirmed marker gets the same fast recovery for never-served worlds WITHOUT that cost.
- Rejected a web "switch back to Kosmos 1" button as the primary fix: with one board,
  there is no board to POST to once it is down; the escape only helps in the narrow
  board-still-up window. The engine fallback works in all cases. (A web escape for the
  board-still-up "not answering" screen is a reasonable ADDITIVE follow-up, not this fix.)
- Deferred (separate, #2238): WHY a switched-into world's board does not come up at all.
  This fix rescues the app; #2238 makes the switch actually work.

## Verification
- engine/worldbootguard-2528.test.js (9/9): the never-served fast path (reopen-1 fallback via
  bootstrapWorldEnv), the confirmed-world THRESHOLD path (no fast abandon once served),
  shouldAbandon = never-served+failure vs confirmed-uses-THRESHOLD, the iter2 regression (a
  CONFIRMED world switched-to any way -- redundant / switch-back / pointer-divergent -- is NOT
  fast-abandoned), a healthy world never trips either path, fail-open. Fast path proven
  non-vacuous by perturbation (dropping the !isConfirmed guard reds the confirmed-world test).
- Neighbors: worldbootguard-2528 + worldenv.booted-2238 + worldenv + worlds.registry-1704 +
  server.worldenv-order (the set that touches the changed paths) all green; the exact count is
  re-run at 6j (the full run-tests.sh is the authority, not a hand-counted subset).
- Full run-tests.sh. Engine-only; no web/ change, so #1720 does not apply.
- Weakest premise: that a NEVER-served world which fails its first boot is genuinely dead
  rather than merely slow on its first-ever boot (extra init) with the user reopening
  impatiently. If the latter, the user lands on the default world (count cleared) and can
  re-switch -- a minor, self-correcting cost, and far better than the lockout it removes. A
  world that has served even once is confirmed and never suffers this (it gets THRESHOLD).
