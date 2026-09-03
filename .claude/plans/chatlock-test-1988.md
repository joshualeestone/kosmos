# kosmos#1988 - the chat.js stale-lock test reds under load: fix the harness, and a real lock race falls out

## The card's premise (partly right)
The card (`engine/chat.test.js` "two writers that both see a stale lock do not both get inside" reds under
load, greens alone) argues this is "more likely a real lock race than a flaky test." First diagnosis: the
OBSERVED reds are a benign give-up-under-load the harness misreports as corruption (below). But the
challenge loop (iter 2) then found the suspicion HAS merit: there is ALSO a plausible cross-process
stale-steal TOCTOU in filelock.js (kosmos#1991) that could double-enter. So this card is TWO things
tangled: a harness flaw (fixed here) and a production lock race (filed separately, #1991, NOT masked by
this fix). The test change fixes the give-up noise AND keeps a real double-entry visible.

## Diagnosis
`chat.js appendMessage` -> `engine/filelock.js withFileLock`. Entry is gated EXCLUSIVELY by an atomic
`mkdirSync` (EEXIST if held). The stale STEAL is a rename-aside to a UNIQUE destination + rmSync, after
which the stealer `continue`s and must RE-ACQUIRE via mkdir -- it never enters directly. Two writers that
both see the lock stale each rename the SAME source `lock`; exactly one succeeds, the loser gets ENOENT
and loops. Release is guarded by a per-holder token written into the lock dir. So two writers that both
rename the SAME stale lock cannot both enter.

⚠️ **CORRECTION (challenge-loop iter 2): the lock is NOT provably race-free -- the card's suspicion has
merit, for a DIFFERENT interleave than my first diagnosis considered.** The stat-then-rename in the steal
(`filelock.js:90` statSync, `:93` renameSync) is not atomic and the rename never verifies it is moving the
SAME lock the stat measured. If writer Y measures the lock stale, is descheduled, and meanwhile writer X
fully steals it AND re-acquires a FRESH live lock L1, then Y's rename lands on L1 (succeeds, no ENOENT),
moves X's LIVE lock aside, and Y enters beside X -> double-entry -> a lost update. This is a plausible
(load-only, hard to reproduce) PRODUCTION race, filed as **kosmos#1991** for a separate filelock.js fix.
The deterministic sibling test only covers the empty-path sub-case (its mock both freshens the lock and
throws ENOENT, which cannot both happen on a real FS), so it does NOT exercise this interleave.

The "reds under load" is a GIVE-UP misreported as loss: `filelock` fails SAFE (`recorded:false`, message
never written) if it cannot acquire within `LOCK_WAIT_MS` (2s). Under a saturated CI (loadavg was 22+
tonight), these REAL child processes each `require('./chat')` (a 2000-line module) then RMW under the
lock, so a waiting child's 2s can elapse -> it gives up -> its message is never written -> `length === 1`
-> RED. `writer.js` does not retry. And the stale test DROPPED the `answers === ['true','true']` control
its non-stale sibling keeps, so it cannot tell a benign give-up from a lost append and asserts
`length === 2` unconditionally under arbitrary load. (Confirmed by reading writer.js, the sibling's
control at chat.test.js:1309, and filelock.js:88.)

## The fix (test-only; the production lock is unchanged and correct)
- **`writer.js` gains a bounded RETRY** on a lock/busy give-up (until it records or a 30s deadline). Each
  attempt keeps the DEFAULT sub-2s wait, and the retry RE-ATTEMPTS rather than lengthening one wait, so a
  single acquire's wait never approaches `LOCK_STALE_MS` (10s). So a contended writer takes its turn
  instead of dropping its message, under any load, WITHOUT lengthening a single wait past the stale bound.
  (Age-based staleness can still let a 2s waiter cross 10s if the lock was already near-stale when it
  arrived -- a pre-existing production property, unchanged here, and any resulting loss reds the restored
  control rather than being masked.)
- **The stale test restores the dropped control**: assert both children returned `'true'`. Now a give-up
  reds LEGIBLY ("a false here is a give-up under load, not a lock defect"), and a genuine loss (both
  recorded yet a message missing) is the ONLY thing that reds the `length` assertion -- so the test still
  guards the real invariant, but can no longer misreport a timeout as corruption.

## Rejected: raise the single-call wait budget above the stale bound
The obvious first fix -- `AGENT_WORKFORCE_LOCK_MS=30000` for the spawned children -- is WRONG and I
reverted it: 30s > `LOCK_STALE_MS` (10s), so a waiter waiting on a holder whose section runs past 10s
(possible under the exact CPU-starvation this test hits) would see the LIVE lock as stale, steal it, and
enter -- the double-entry the test guards against, with a real interleaved-RMW loss. The default 2s is
safe precisely because 2s < 10s. The retry keeps every wait under the stale bound and is robust to
arbitrary load; the budget bump traded a legibility bug for a genuine correctness bug.

## Decision record
- **Call:** the flake is the harness (give-up-under-load + a dropped control), not a chat.js lock race.
  Fix the test: a bounded retry (each attempt under the stale bound) + restore the control. Do NOT touch
  chat.js/filelock.js.
- **Weakest premise, and it turned out FALSE (corrected in iter 2):** my first diagnosis claimed the lock
  is genuinely race-free. Review found a plausible cross-process TOCTOU (stat-then-rename not atomic,
  kosmos#1991) that CAN double-enter. Why the test-only fix is still right anyway: (1) the OBSERVED reds
  are consistent with a benign give-up (a contended writer times out at 2s -> recorded:false), which the
  retry fixes; (2) crucially, the fix does NOT MASK the real race -- a double-entry loss surfaces as both
  children recorded:true yet a message missing, which the restored control leaves reding the length
  assertion, and the retry only re-fires on recorded:false so it can never green a real double-entry. So
  this change makes the give-up noise go away AND leaves the real race MORE visible (no give-up to conflate
  it with), and the production race gets its own focused fix in #1991. Fixing filelock.js here would be
  scope creep into a shared lib (chat.js, sendertoken.js, ...) and a separate concurrency change.
- **Reproduction caveat, stated honestly:** the flake is LOAD-ONLY (greens in isolation; the child
  processes do not reliably overlap without CPU saturation), so it cannot be reproduced deterministically
  in a unit test -- the same reason the card only saw it twice under load. The fix follows from the
  diagnosis, not from a red-then-green demonstration; the existing `heldlock` test already pins the core
  claim (a held lock -> `recorded:false`, no write).
