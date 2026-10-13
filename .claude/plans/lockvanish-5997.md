# kosmos#5997: a trust write was lost while all 12 writers reported success

## Cause (measured)
`engine/filelock.js`: a waiter whose `mkdir` met EEXIST, and whose `stat` then failed (the holder had just released:
ENOENT), set `age = Infinity` and went to steal whatever stood at the path next. Under contention that was a writer's
fresh live lock. The #1991 identity check (a null measured mtime always reads as "substituted") moved it aside and put
it back, and a third writer could `mkdir` in that gap: two writers inside the section, one update lost, every writer
reporting success.

## Fix
A failed stat, for any reason (ENOENT after a release, EPERM/EACCES on a Windows lock being deleted, a dangling
symlink), pauses and retries the mkdir; it never leads to a steal. A steal can only remove a lock whose mtime it
measured, so this path could never collect anything, only open the window. The deadline answers "busy", as for a
live holder.

## Evidence
- Deterministic test (statSync throws ENOENT while B holds a live lock; C mkdirs in the gap): red on the old code
  ("the waiter moved a live holder's lock aside"), green after.
- Stress, 12 concurrent writers doing trust.js's read-modify-fsync-rename, instrumented: old lock lost 2 writes in
  2160 (each with exactly one failed put-back after a live lock was moved); fixed lock lost 0 in 1440 twice (once
  instrumented, once on the final code).
- Lock tests 16/16; every lock caller's tests 194/194.

## Review (blind, alternating models)
1. opus: Windows delete-pending (EPERM) would reopen the window. Retried once (later replaced).
2. sonnet: a dangling symlink spun hot. Paused (later replaced). Its premise that the old code collected such a
   lock was wrong: a null mtime always restored.
3. opus: WARNING, the "repeated failure is debris" path could never collect anything and could only reopen the
   window. Replaced rounds 1 and 2 with one rule: no failed stat leads to a steal.
4. sonnet: no blockers, warnings or concerns. Nits taken.

## Decided
- One rule (never steal on a failed stat) over a retry-count scheme. Weakest premise: a lock that is unreadable
  forever now waits out every deadline as "busy"; the old code could not collect it either (verified by review 4).
- Not changed: the #1991 put-back window for a genuinely stale lock substituted mid-steal (needs a lock over 10 s old).
