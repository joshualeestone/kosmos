# #4804: trust-lock-3088 fails under load on the lock's wait budget, not on a lost update

Card: joshualeestone/kosmos#4804 (claimed:angel, night shift). Branch trustlockflake-4804 off main.

## What finished looks like
`engine/trust-lock-3088.test.js` measures what it names (twelve concurrent writers through the lock, nothing lost)
and no longer fails a PR because the CI runner is busy; when a child does fail, the failure says why.

## Cause
withFileLock (engine/filelock.js) waits at most LOCK_WAIT_MS = 2 s for a live holder, then answers "the file is
locked by another writer". Twelve Node children on a loaded runner queue past that, exit 2, and print nothing.

## The change (test only)
1. The children get a 30 s lock wait through the existing AGENT_WORKFORCE_LOCK_MS override, set in runChildren's
   environment. The product's 2 s budget is untouched (filelock.test.js covers it).
2. Each child prints trustFolder's answer; the assertion lists every failed child with its code and output.
3. New control: the test holds the lock itself (touching it every second so it never ages into a stale steal), and
   each child signals the parent when it reaches the lock. Children told the product's 2 s budget: the lock is held
   until they have all exited, so each is refused 2 s after reaching it and says "locked by another writer" (CI's
   failure, independent of how slowly they started). Children on runChildren's own environment: the lock is released
   3 s after the last one reached it, so each waited past a 2 s budget and must succeed.
4. The header's never-release claim is restated (with a 30 s wait the 10 s stale steal frees one child at a time,
   so the later children still fail), and the main test asserts N stays large enough for that.

## Decisions
- Card option 1 (longer wait) plus "make them say which", not option 2 (tolerate refusals, assert no lost update
  among the rest): a test that tolerates refusals can pass with almost nothing written. Not option 3 (lower N):
  load can still exceed 2 s with fewer children.
- WEAKEST PREMISE: that 30 s is enough on any runner we have. Twelve two-file-op sections serialised take well under
  a second of lock time; a runner too loaded for 30 s would fail other tests first.

## Measured
- Both tests green 3 of 3 runs locally (about 0.4 s and 3.2 s).
- Mutant: the wait removed from runChildren's environment -> the control goes red. Restored (cmp against a copy).
- Mutant: a 3 s sleep in each child before it reaches the lock (a slow runner) -> both tests stay green.
- A first control (child wait 0, no holder) passed: the children did not overlap, so it could not fail. Replaced.

## Review
Round 1 (blind): BLOCKER, the first held-lock control timed its 3.5 s hold from the spawn, so on a runner slower
than 1.5 s to start a child the 2 s arm would succeed (reviewer's 1.7 s delay mutant made it red). Fixed: the hold
is timed from each child reaching the lock, and refreshed. SHOULD-FIX, the plan was not committed: committed.
Nits taken: the header's never-release wording plus an N assertion; "default" arm renamed to "2 s budget".
