# Plan: fix the TOCTOU double-entry in engine/filelock.js's stale steal (kosmos#1991)

Branch: `filelock-toctou-1991` · Repo: joshualeestone/kosmos (local checkout `~/work/agent-workforce`)

## The bug (verified against the code, not just the card)

`withFileLock`'s stale-steal is two non-atomic syscalls:

- `filelock.js` measures the lock's age with `fs.statSync(lock).mtimeMs`.
- If stale, it steals with `fs.renameSync(lock, aside)` — but `rename` moves whatever
  stands at the path **at rename time**, not the dir the stat measured.

Trace (two processes Y, X racing an already-stale lock L0):
1. Y stats L0 stale, then is descheduled (realistic under load; #1988 measured loadavg 22+).
2. X completes a full steal of L0 and re-acquires a FRESH LIVE lock L1 at the same path, enters `fn()`.
3. Y resumes at `renameSync(lock, aside)` with its cached "stale" verdict. `lock` is now L1 (a real dir), so rename SUCCEEDS, moving X's live lock aside. Y `rmSync`s it and enters `fn()` too.
4. Both run the critical section concurrently → lost update — the exact interleave the lock exists to prevent, reached through the repair path.

The 2s `LOCK_WAIT_MS` does not help: the race is on the steal path (an already-stale lock), not the wait path.

Also: the existing deterministic guard (`chat.test.js` "the breaker that LOSES the steal stays outside") mocks `renameSync` to BOTH freshen mtime AND throw ENOENT in one call — mutually exclusive on a real FS. It only covers the EMPTY-path sub-case, never "rename succeeds on a live fresh lock."

## Fix

Make the steal verify identity: capture the lock's `mtimeMs` in the same stat that measures age, and after `renameSync(lock, aside)` confirm `statSync(aside).mtimeMs` equals it.

- **Match** → the moved dir is the measured-stale lock; proceed to `rmSync` + `continue` (unchanged behavior).
- **Mismatch** (or an unreadable mtime) → a fresh lock was substituted; **restore it** (`renameSync(aside, lock)`, best-effort) and re-wait (`pauseMs; continue`) rather than entering the section.

### Why MTIME, not inode

Inode survives rename, but a racing process rm's the stale lock (freeing its inode) then mkdirs a fresh one that **could reuse the freed inode number** — a false match. mtime cannot collide: staleness is itself an mtime bound, so a measured-stale lock's mtime is >LOCK_STALE_MS old while any re-acquired lock's is ~now. For the normal steal (no race), `rename` preserves mtime and nothing writes into a stale dir, so the two stats read the same value exactly → the steal proceeds.

### Why restore is load-bearing

Without restoring, re-waiting leaves `lock` empty, so the loop's own next `mkdirSync(lock)` acquires it and double-enters anyway. Restoring puts L1 back so the re-wait hits EEXIST and waits properly. Residual: an extreme 3-process sub-race (a third process `mkdir`s in the tiny restore window) is unchanged by this fix and left to the staleness rule; the fix eliminates the primary 2-process double-entry.

### Rejected
- Inode witness (reuse hole, above).
- `LOCK_WAIT_MS` tuning (wrong path).
- An atomic compare-and-swap rename (POSIX has none).

### Weakest premise
The restore's 3-process sub-race window. Named and bounded above; it degrades to an inert `.stale` leftover + a safe no-op release by the moved-aside holder, never a corrupting double-entry.

## Tests (engine/filelock.test.js)
- `#1991`: reproduces the TOCTOU deterministically — a `renameSync` mock substitutes a fresh live lock (L1) between the stealer's stat and rename, keeping L0 alive for unambiguous identity. Asserts the stealer restores L1, fails safe (busy), never runs `fn`, and leaves the live holder's lock intact. **Perturbation-verified**: disabling the restore reds it.
- `#1991 CONTROL`: a clean stale steal (no substitution) still matches identity and runs the section — guards against a fix that always restores.

## Verification
- `node --test engine/filelock.test.js` (11) green; caller suites `chat.test.js` + `sendertoken.test.js` green (169 total). Full challenge-loop.
