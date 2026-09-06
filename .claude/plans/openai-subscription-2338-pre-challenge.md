---
pre_challenge: true
method: challenge-loop
branch: openai-subscription-2338
diff_hash: e5c1130ae3295cbbf3891ba483a9bb94e438153da6f2cdb95572ef95f7c1863a
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T21:16:00Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 | **Converged:** Yes (iteration 5 returned zero BLOCKER/WARNING/CONVENTION).
**Total findings:** 11 WARNING, 1 CONVENTION. **Fixed:** 10 | **Deferred:** 2 | **Asked:** 0.

kosmos#2338: the ChatGPT-subscription sign-in backend (async `codex login` driver + 3 routes + connected gate). The interactive child process made this a resource-lifecycle problem; the loop drove out a series of real async and cross-flow defects. Full suite green (node 4958/4958; shell suites 0 failures).

### Per-Iteration Breakdown

#### 6.0 baseline
Full suite green with the initial driver + routes + tests (17 targeted tests).

#### Iteration 1
**New:** 4 WARNING.
- [WARNING] an abandoned `codex login` child was reaped only by an explicit cancel -> FIXED: a watchdog kills it after loginTimeoutMs.
- [WARNING] the session Map was never pruned (unbounded growth) -> FIXED: a reaper drops terminal sessions after a read-grace TTL; all timers unref'd.
- [WARNING] concurrent unlabelled starts could share one CODEX_HOME + an existsSync/mkdir TOCTOU -> FIXED: an activeChatgptDirs reservation + atomic (non-recursive mkdir + EEXIST) madeDir.
- [WARNING] the start response advertised authUrl/userCode that were structurally always undefined -> FIXED: start returns {sessionId, mode}; the client polls status. (Also the error handler now guards every terminal state.)
- Follow-on: excused the setChatgptTimers test seam in engine.reachable.test.js (the export audit's #265 signature).

#### Iteration 2
**New:** 3 WARNING.
- [WARNING] cancelChatgptLogin had no terminal guard -> FIXED: cancelling a settled session returns cancelled:false and changes nothing; route forwards out.cancelled.
- [WARNING] reap freed the slot/dir synchronously while kill() is async, so a concurrent start could reuse a dir a dying child still owned -> FIXED: the slot/dir are freed only when the child is confirmed gone (its exit), or on a spawn error with no child.
- [WARNING] parseChatgptLoginOutput over-captured trailing URL punctuation and could pick a URL token as the device code -> FIXED: trim trailing punctuation; search URL-stripped text preferring XXXX-XXXX.

#### Iteration 3
**New:** 3 WARNING.
- [WARNING] a child that ignores SIGTERM never exits, leaking its slot/dir forever (eventual 500-slot exhaustion) -> FIXED: cancel/watchdog escalate to an uncatchable SIGKILL after forceKillMs; guarded by session.exited, timer cleared on exit.
- [WARNING] a refused (api-key) completion in a REUSED auth-less slot left codex's auth.json on disk, surfacing in list() -> FIXED: dropDirIfOurs removes the auth.json from a reused slot.
- [WARNING] the tricky-parser test waited on 'connected' (which exit can reach before the final stdout flush is parsed) -> FIXED: it waits on the userCode field it asserts.

#### Iteration 4
**New:** 1 WARNING.
- [WARNING] the api-key flow (addWithKey) resolved its dir without consulting activeChatgptDirs, so a concurrent api-key add could land on the slot a live sign-in reserved; the sign-in's anti-litter would then destroy the api-key credential -> FIXED: addWithKey excludes activeChatgptDirs on both arms (unlabelled nextWorkDir, labelled refusal). +1 discriminating test.

#### Iteration 5 -- CONVERGED
**New:** 0 BLOCKER, 0 WARNING, 0 CONVENTION. A fresh blind reviewer confirmed: the const/TDZ scoping of activeChatgptDirs in addWithKey is safe; addWithKeyLive inherits the exclusion; no between-checks interleaving in a single-threaded runtime; no spurious refusal; the full watchdog/force-kill/reap/free-on-exit lifecycle is internally consistent; the parser, routes, and cross-flow test all correct. Verdict: clean.

### Deferred (with reasoning)
- The `$`/backtick omission in the forbidden-character copy of a SIBLING feature (installedCheck) is out of this card's scope.
- The parser's exact real-codex line format is release-gated by design (verified under a real ChatGPT Pro subscription), not this branch's concern.

### Strengths
The slot/dir are freed only on the child's confirmed death, so a concurrent start cannot reuse a dir a dying child still writes into; SIGKILL escalation guarantees that death; both the sign-in and api-key flows honour one shared reservation set, so they cannot clobber each other; the connected gate accepts only auth_mode:chatgpt; every fix is pinned by a test that fails if the fix is reverted (mock codex, no real login/launchctl).
