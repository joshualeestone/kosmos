# kosmos#1988 - the chat.js stale-lock test reds under load: it is the HARNESS, not the lock

## The card's premise, and why it is wrong
The card (`engine/chat.test.js` "two writers that both see a stale lock do not both get inside" reds under
load, greens alone) argues this is "more likely a real lock race than a flaky test." Diagnosed: it is
NOT. The production lock is sound; the test misreports a benign under-load timeout as corruption. (A
harness bug wearing a product bug's clothes -- the red was real, its cause was invented; the same shape
the `an-anchored-pattern-matches-the-line-you-imagined` bulletin names.)

## Diagnosis
`chat.js appendMessage` -> `engine/filelock.js withFileLock`. Entry is gated EXCLUSIVELY by an atomic
`mkdirSync` (EEXIST if held). The stale STEAL is a rename-aside to a UNIQUE destination + rmSync, after
which the stealer `continue`s and must RE-ACQUIRE via mkdir -- it never enters directly. Two writers that
both see the lock stale each rename the SAME source `lock`; exactly one succeeds, the loser gets ENOENT
and loops. Release is guarded by a per-holder token written into the lock dir. So two writers CANNOT both
enter -- the deterministic sibling test ("...LOSES the steal stays outside, forced deterministically",
which monkeypatches `fs.renameSync`) proves it.

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
- **Weakest premise:** that the lock is genuinely race-free (so a test-only fix is right). Backed by:
  entry gated by atomic OS-level `mkdir` across processes; the rename-steal contends on a unique
  destination (no overwrite) and the loser loops rather than entering; token-guarded release; and the
  deterministic sibling test that forces the loser to stay out. If a real race DID exist, the restored
  control would still catch it (both recorded yet a message missing), so the fix does not MASK a
  regression -- it makes one legible. The card's "probably a real race" is not supported by the code.
- **Reproduction caveat, stated honestly:** the flake is LOAD-ONLY (greens in isolation; the child
  processes do not reliably overlap without CPU saturation), so it cannot be reproduced deterministically
  in a unit test -- the same reason the card only saw it twice under load. The fix follows from the
  diagnosis, not from a red-then-green demonstration; the existing `heldlock` test already pins the core
  claim (a held lock -> `recorded:false`, no write).
