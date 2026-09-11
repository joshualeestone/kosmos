---
pre_challenge: true
method: challenge-loop
branch: win32cfg-2717
diff_hash: f36790dd4a32ec2d8671cf24133b07f5ba0d80e255adeba7bbb6ae4bfba9efc9
timestamp: 2026-09-11T01:37:31Z
iterations: 2
converged: true
---

# Challenge-loop proof: win32cfg-2717 (kosmos#2717)

`/api/removed` computes `accountFolderGone` per removed agent on the board's
five-second poll. Since #2614 that predicate reads a win32 configDir via
`win32job.configDirFor`, which shells `schtasks /Query /XML`. So on Windows it
was **one process spawn per removed agent, every five seconds, forever.**

## The property that makes the cheap fix safe

🔑 **The configDir PATH is immutable for the life of a task. Only whether the
directory still EXISTS changes, and existence is checked live by the caller on
every ask and is NOT cached.** That is what separates this from the naive TTL
cache the card rightly warns against.

**Verified rather than trusted:** `install` is the only writer of a per-agent
task (`create.js:2188`, `create.js:2240`; `win32board.js` writes a different task
name), and restore re-enables via `/Change /ENABLE`, never `/Create`.
Corroborated independently by round 1.

## Decisions

- **Only `known` answers are cached.** A `known: false` is about the moment, not
  the task; caching it turns one transient failure into a permanently disarmed
  safety check.
- **"There is no task" IS cached**, deliberately: that is what a removed agent
  whose task is already gone hits every poll.
- **Bust at the TOP of `install`**, broader than "only on success", which costs
  one re-read and removes "did this failure reach the `/Create`?" from a
  correctness argument. `remove` busts too; `disable`/`enable` are `/Change` on
  STATE and cannot move the path.
- **`setRunner` clears it**, or a stub outlives itself and the next test reads
  the previous one's task.

## Iterations: 2, converged

| round | found |
|---|---|
| 1 | 1 WARNING (a vacuous guard), 1 NIT (shared object) |
| 2 | **NO NEW ISSUES** |

## Verification at convergence

- `bash tools/run-tests.sh`: **exit 0, 5895 tests, 5895 pass, 0 fail, 0 skipped**,
  zero FAIL lines, carried through to the shell gates.
- `engine/win32job.test.js` 30/30, `remove.win32-job-570.test.js` 13/13.
- Controls, each redding only its own arm: never store; `install` bust removed;
  `remove` bust removed; `setRunner` clear removed; NO_SUCH_TASK not remembered;
  writer accepts failures; freeze removed.

## Residuals

- The cache is never pruned. Bounded by agents ever asked about in one process.
- ⚠️ **`create.setAccount` has NO win32 branch**, so on Windows an account switch
  never rewrites the Scheduled Task. **Pre-existing, out of scope, not carded.**
  It is also part of why the cached path cannot go stale.

## Review output, per iteration

#### Iteration 1: 1 WARNING, 1 NIT

[WARNING] 🛑 THE `known === true` GUARD WAS VACUOUS AND THE TEST THAT CLAIMED TO COVER IT COULD NOT FAIL. All four `known: false` returns in `configDirFor` bypassed the writer and returned a literal, so the guard was never reached with a failure and deleting it changed nothing. Measured: the mutant `if (answer)` (cache failures too) SURVIVED at 29 pass / 0 fail. ⭐ The author had disclosed this as "defence in depth, either alone suffices", which is true of the BEHAVIOUR and false of the GUARD: one of the two was not a defence, it was dead code wearing a safety comment. "Two mechanisms, either suffices" and "one mechanism plus an unreachable one" are indistinguishable from outside, and only a mutation aimed at the unreachable one separates them. ⚠️ And the unguarded branch was THE DANGEROUS ONE: caching a `known: false` permanently disarms a safety check, and the natural future refactor ("route everything through the one writer", this code's own stated design) is exactly the move that breaks it, suite green. Fixed: all four failures now route through the writer, so the refusal is load-bearing; the mutant now reds on its own arm.

[NIT] `return cached` handed every caller the same object, where pre-cache each call built a fresh one. Only consumer is read-only, so no live bug. Fixed by freezing on store.

[STRENGTH] The round carried controls proving its battery could go red (install bust removed, 1 fail; remove bust, 1 fail; setRunner clear, 6 fail; NO_SUCH_TASK uncached, 1 fail; writer inert, 2 fail), which is what makes its one SURVIVING mutant mean something.

#### Iteration 2: No issues found

No issues found.

[STRENGTH] Applied each mutant alone, restored it, and ran a green control between them, so a permanently-red battery could not masquerade as coverage. It also independently traced the cache-key normalisation risk end to end (`create.js` reaches `taskName()` with an already-slugged name, `remove.js` via `cleanName`, a trim that is idempotent on a slug) and re-confirmed the round-1 fix by mutation rather than by reading.

[NIT] Flagged, ungraded, that `Object.freeze` had NO regression coverage: deleting it left all 29 arms green. Taken rather than noted, because an invariant nothing tests is indistinguishable from a comment. An arm now asserts both that the answer is frozen and that mutating it cannot change the next ask; removing the freeze reds exactly that arm.

### Final Ledger

2 iterations, converged. 1 WARNING, 2 NIT, 2 STRENGTH. All addressed. The WARNING is the one worth keeping: an author's own honest-sounding disclosure ("defence in depth") concealed that one of the two defences was unreachable, and only a mutation aimed at it revealed the difference. Suite at convergence: exit 0, 5895 tests, 5895 pass, 0 fail, 0 skipped, zero FAIL lines.
