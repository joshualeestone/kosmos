---
pre_challenge: true
method: challenge-loop
branch: spinner-553
diff_hash: e890fb23d540393bc93c2f3e7989ce251b916885e16798771b6f48ad65233cba
subdir_audit: passed
timestamp: 2026-08-24T17:42:19Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (plan allowed two; the round's findings were all fixed and it converged)
**Converged:** Yes
**Total findings:** 9 (0 BLOCKERs, 5 WARNINGs, 4 NITs)
**Fixed:** 9 | **Deferred:** 0

### The change

The update overlay could not say it failed: /api/update answers 200 before
anything happens (finishing the job kills the server), so the only success
signal was the server coming back changed and there was no failure signal
at all. Josh watched three minutes this morning and learned nothing. Now
the overlay folds every poll through one pure verdict (done / failed /
did-not-take / slow / deadline) and paints a true sentence with Try again
and Reload instead of spinning; "it failed" is only ever the installer's
own word.

### Iteration 1 (bounded, final)
- [WARNING] the failed verdict was unreachable for the real failures: on an
  UPDATE the installer stops the board before it downloads, so the old
  server is dead for a 404, a dropped download, a checksum refusal, a
  failed swap --> FIXED: the spawned shell writes the installer's exit
  code and the attempt's start stamp to logs/install.status, and whichever
  server answers next seeds its record from it (code 0 seeds nothing;
  success is the board coming back changed)
- [WARNING] "did not take" printed on a client fetch throw (a wifi toggle,
  a sleep) --> FIXED: went-away is now a CHANGE OF BOOT IDENTITY in the
  status payload, never a network hiccup; the test that pinned the old
  behavior was changed with it
- [WARNING] a reattached press (refresh mid-install, or the auto path)
  never saw failed because the already-branch carried no stamp --> FIXED:
  the in-flight attempt's stamp rides the idempotent answer too
- [WARNING] the page guessed the log path in exactly the state it needed
  it --> FIXED: the path rides the status payload from the engine's root,
  remembered from the last status before the board went down
- [WARNING] no screenshot --> FIXED: the failed overlay captured via route
  interception (attached to the PR and the channel)
- [NIT] spawn error could record twice --> FIXED: the first sentence wins,
  and the whole write is now identity-guarded
- [NIT] Try again reloads --> FIXED: relabeled "Reload and try again"
- [NIT] a 503 dip read as deadline not did-not-take; the detached K loader
  keeps drawing --> accepted (safer direction; the reload ends both)
- [NIT] a same-millisecond fresh stamp --> the test asserts endedAt/code
  cleared, which is what "starts clean" means

### Hardening the round surfaced

noteAttemptEnd is now IDENTITY-safe (writes only the record its own press
created), the connect-driver pattern: a superseded child's late exit can
never overwrite the current attempt. Rare in production under single-flight;
certain across tests with a leaked fake timer, which is how it was found.

### Validation
Full suite green (validation-log PASSED, hash e890fb23d540), subdir audit
passed, the verdict pinned for every branch from a slice of the real page,
the durable-file seed and identity guard pinned in the engine, the route's
stamp-and-payload pinned. The failed overlay renders as one true paragraph.
No em dashes in any added line.
