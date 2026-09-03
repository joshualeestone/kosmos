# Plan: make the stale-lock race test self-classify its intermittent red (kosmos#1988)

## The card
`engine/chat.test.js` "two writers that both see a stale lock do not both get inside" reds
intermittently under full-suite load (#1939 local, #1987 CI) and passes in isolation
(114/114). The card asks: decide FIRST whether the LOCK is racy or the TEST is (opposite fixes),
and if the test, make it deterministic WITHOUT weakening the invariant.

## Investigation (this session)
- **Static:** the lock lives in `engine/filelock.js` (`withFileLock`, kosmos#1823), shared by
  chat.js and sendertoken.js. The rename-steal serializes two stale-lock writers correctly:
  `rename(lock->aside)` succeeds once (loser gets ENOENT and re-loops), the winner mkdirs a fresh
  lock before entering `fn()`, and the owner-token makes release delete only our own lock. A lost
  message needs two writers in the critical section at once, which the rename-steal prevents.
- **Empirical:** an instrumented standalone harness reproducing the exact scenario lost 0 messages
  in 326 trials under heavy CPU/IO/process load; 12x parallel `node --test chat.test.js` x3 rounds
  = the stale-lock test 36/36 PASS. The suite uses the default 2s wait (AGENT_WORKFORCE_LOCK_MS
  unset), same as the harness.
- **Structural:** the ACTUAL race is already deterministically guarded by a DIFFERENT test in the
  same file ("the breaker that LOSES the steal stays outside, forced deterministically"), whose own
  comment calls the random 2-process test "a coin-flip guard" that "CANNOT RELIABLY SEE A
  REGRESSION". So detection does not depend on #1381.

## Decision-direction
The evidence does not support a genuine lock race in the scenario #1381 constructs, so "fix the
lock" is likely wrong. The red arises under the full suite's broader contention; the likely cause
is a fail-safe TIMEOUT (a writer waits > the lock wait under saturation, returns recorded:false,
drops its message) or a child crash - a test/liveness issue, not the lock. A rare genuine
double-entry is not excluded but is not what the 2-writer scenario produces in isolation.

## This change (safe, does not weaken the invariant)
Because the red only appears under the suite (not locally reproducible), make #1381 SELF-CLASSIFY:
capture each writer child's recorded-flag and any crash, and put them in the failure message. The
`length===2` + includes-both assertions are UNCHANGED, so a genuine double-entry (both recorded
"true" but a message missing) STILL reds - detection is not weakened, only diagnosed. The next red
(in CI, where it appears) then decides the lock-vs-test fork with no local repro:
- a writer recorded:"false" / a non-zero `failed` = a fail-safe drop -> this test's liveness
  assumption, not the lock.
- both "true" with a message missing = a genuine double-entry -> engine/filelock.js.

I did NOT change the shared lock (my analysis says it is correct and I could not reproduce a loss)
or the assertion's force (which could mask a real race). This turns the card's blocker - the red is
real but unreproducible locally - into a self-resolving next-CI-red.

## Weakest premise
I did not reproduce the actual full-suite red; a negative reproduction (326 trials) is strong
evidence, not proof. That is exactly why this change only ADDS diagnostics rather than altering the
lock or the assertion: if the next instrumented red shows a real double-entry, the fix moves to
filelock.js; if it shows a fail-safe drop, the fix is to relax this test's liveness assumption
(e.g. assert recorded-consistency) without touching the deterministic race guard.
