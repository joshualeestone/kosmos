# kosmos#7554: follow-ups to the data-root hardening (#1760, storemode-1760)

**Review 4 (03:1x) changed the outcome: item 1 is DROPPED, measured.** Building a 13-variable cache key costs ~1.85 us per
write against ~1.09 us to resolve the root directly (bench run twice on this Mac, node 26.8.1; the reviewer measured the
same in production, test and throwaway-root cases). The card's premise was a path resolution per write, but `realish`
already caches per spelling and `inThisTestRun` caches its answer (`runSeen`). So the cache, its variable list, its test
seam and the reachable-excuse entry are all REMOVED; store.js differs from the base only by item 2.

## What ships: item 2

`secureRoot()` no longer records EBUSY as tried (transient, so the next write retries). EPERM and EACCES stay recorded (a
root this user cannot change, usually for good; retrying would cost a failing chmod per write); the board's start call
always retries. Tests: engine/store.chmod-retry-7554.test.js (EBUSY retried; EPERM and EACCES tried once over three
writes, then tightened by secureRoot()), listed in tools/windows-tests.js ALSO (its win32 branch is a decision).

## Item 3 (not code)

A real cloud box on the FIRST release containing storemode-1760: the data root 0700, messages.jsonl 0600. No SSH on
cloud boxes, so finding a way to read the modes is part of it.

## History of the review loop (rounds 1-3 were on the dropped cache)

R1: the cache untested. R2: tools/check-frozen-roots.js tripped on a comment inside the list. R3: engine.reachable
EXCUSED and windows-tests-1777. R4: the cache is slower than what it saves. Lesson: measure a performance premise first.
## Rejected

- Not recording EPERM/EACCES either: a failing chmod on every write for a root that will never change.
- Keying the cache on the resolved root alone: that is the resolution being saved.

## Weakest premise

That `ROOT_ENV_INPUTS` stays complete. The audit test reads the six functions that decide the root, but a new input
reached through another helper they call (not a direct `env.X` read) would not be seen by it.
