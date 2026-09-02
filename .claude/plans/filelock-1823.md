# #1823 -- extract the shared file-lock primitive

## The problem

`engine/chat.js` `withThreadLock` (round 19/40) and `engine/sendertoken.js`
`withSessionLock` (#1782, commit 17c3b950) are two copies of the same mkdir-atomic
file lock. A blind pass on the first sendertoken copy found three recovery-path bugs
chat.js had already fixed (a `rmdir` break two waiters both win; a crash between
mkdir and owner-write that wedges the session; no age fallback). #1782 transcribed
chat.js's proven design rather than re-derive, which is correct but leaves TWO copies
of a notoriously bug-prone primitive.

## Why a new low-level module, not extract-into-one

The shared home cannot be chat.js or sendertoken.js: chat.js is required fleet-wide
via status.js, which requires sendertoken -- so putting the lock in either is
circular. `engine/filelock.js` requires only fs/path (a LEAF), which dissolves the
cycle.

## The change

- `engine/filelock.js` (new): `withFileLock(file, fn, opts)` + `LOCK_STALE_MS` /
  `LOCK_WAIT_MS` / `LOCK_SPIN_MS`. Built from the UNION of both hardened copies
  (sendertoken's was the more hardened): rename-steal, age-staleness, owner-token
  release-only-if-ours, umask chmod of the lock dir + owner file (#1761), no-SAB
  `pauseMs` fallback, `maxRetries`. `opts.busy` / `opts.cannotAccess` parameterize
  the two caller messages (string or function); `opts.waitMs` / the
  `AGENT_WORKFORCE_LOCK_MS` env override the wait.
- `engine/chat.js`: `withThreadLock(file, fn)` -> thin delegator (busy =
  `lockedBecause`, cannotAccess = "...this conversation"). Its own `pauseMs`/`PARK`
  STAY -- used by the codex-gap path at line 781, not just the lock. The two dead
  lock constants removed.
- `engine/sendertoken.js`: `withSessionLock(sessionName, fn)` -> thin delegator
  (busy = `LOCK_BUSY`, cannotAccess = "...that agent's tokens"), keeping the
  `securewrite.secureDir` call before the lock. Dead constants + `PARK`/`pauseMs`
  removed; `LOCK_BUSY` kept.

## Behavior notes

- chat.js GAINS the umask chmod, the no-SAB `pauseMs` fallback, `maxRetries`, and
  the `AGENT_WORKFORCE_LOCK_MS` override by delegating -- all hardenings, none a
  regression. Verified by its full test run.

## Verification

- `node --test engine/chat.test.js engine/sendertoken.test.js` -> 158 pass, 0 fail
  (owner-token release, stale-steal, owner-less recovery, umask non-wedge,
  N-concurrent no-token-loss all unchanged).
- new `engine/filelock.test.js` -> 9 pass (ordinary release, fn-throw propagation,
  opts.busy string+function, opts.waitMs + env override, stale steal, our-vs-successor
  release, non-EEXIST reported-not-thrown).
- `node -c` clean on all three source files.
- No `web/` changes -> no #1720 trailer. No linter configured.
