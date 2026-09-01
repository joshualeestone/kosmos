---
pre_challenge: true
method: challenge-loop
branch: install-spawn-marker-1728
diff_hash: be50cbf29bc6ba493815abad8ff67e12f8c70ccbf2b03dd0f29d7abc5f4f5188
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T08:18:14Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found zero NEW BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 3 WARNINGs, 1 CONVENTION, several NITs, many STRENGTHs
**Fixed:** 5 | **Deferred:** 5 (NITs) | **Asked:** 0

The loop earned every pass: iteration 1 caught a real BLOCKER the full suite
confirmed (a diff-scoped reviewer plus a green subset had hidden it), iterations
2 and 3 each caught a real WARNING, and iteration 4 converged clean. Full suite
`bash tools/run-tests.sh` -> 3408/3408 on the current base (fbb1caf4).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION, 1 NIT
- [BLOCKER] engine/update.test.js:324,329 — the pre-existing #553 spawn-shape security assertion pinned the OLD command; the new `; rm -f "$4"` tail and the `startedMarker` positional broke it (full suite red, marker subset green). --> FIXED (37479ebd): updated both regexes for the new tail + positional, security intent preserved (URL rides as $1, never interpolated).
- [WARNING] engine/update.js seedFromDisk — a success killed before the shell's `rm` left a surviving marker read as "interrupted". --> FIXED (37479ebd): same-attempt suppression (a status record for the SAME start stamp means the attempt finished; the marker is residue) + two tests and a control.
- [CONVENTION] .claude/plans/ — no plan file. --> FIXED (37479ebd): plan added.
- [NIT] rm -f /dev/null footgun. --> deferred here as harmless/non-root, then RE-RAISED as a WARNING in iteration 3 and fixed there (see below) — the loop re-examining a deferral and escalating it correctly.

#### Iteration 2
**New findings:** 1 WARNING, 2 NITs
- [WARNING] engine/update.test.js — the #553 tests set installedRoot to a hardcoded absolute path; now that wireChild writes a durable marker, they would drop a stray `install.started` into a real dir on a writable host (root CI, a real board), which a later boot reads as spurious "interrupted". --> FIXED (d8ab0f4a): moved onto a shared mkdtemp INSTALL_ROOT with a beforeEach clearing `<root>/logs` so a marker from one test cannot seed lastAttempt() in the next.
- [NIT] mirror micro-window (success killed between the pipeline and the status write). --> FIXED (d8ab0f4a): documented as an inherent residual in the readStartedRecord comment.
- [NIT] stamp-equality suppression could falsely suppress a coincidentally-ms-identical later interruption. --> DEFERRED: requires two attempts across board lifetimes producing millisecond-identical toISOString() values; astronomically improbable.

#### Iteration 3
**New findings:** 1 WARNING, 3 NITs
- [WARNING] engine/update.js:481 — `rm -f "$4"` unconditionally targeted the marker; with no install root ($4 = /dev/null) it would unlink the sentinel (destructive if the board ran as root) AND `rm -f /dev/null` returns non-zero as a non-root user, which would reach wireChild's exit listener and record a FALSE install failure. --> FIXED (206ead7e): guarded as `if [ "$4" != /dev/null ]; then rm -f "$4"; fi` (the if exits 0 in the sentinel case); added a test running the exact command with $4=/dev/null asserting exit 0 and the sentinel intact.
- [NIT] endedAt for an interrupted attempt is the marker's mtime (spawn time), not the kill time. --> DEFERRED: no trace of the kill time exists; the mtime is the best available value, and code:null + because:interrupted carry the real signal.
- [NIT] a spawn error leaves the marker, so after a restart it reads "interrupted" rather than "could not start". --> DEFERRED: thin distinction (both mean non-completion), transient (the next press overwrites and removes it).
- [NIT] temp-dir accumulation from mkdtemp with no afterEach cleanup. --> DEFERRED: OS reclaims os.tmpdir(); cosmetic.

#### Iteration 4
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT
- [NIT] plan file said "(11)" marker tests; it is 12. --> FIXED (b9a56eba): doc miscount corrected.
**Converged** — no NEW actionable findings; 5 STRENGTHs confirming the shell tail correctness, the same-attempt suppression, the non-vacuous /dev/null-guard test, the test isolation, and add-only.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | engine/update.test.js:324 | stale spawn-shape assertion broken by the new tail+positional | FIXED | 37479ebd |
| 2 | 1 | WARNING | engine/update.js seedFromDisk | false "interrupted" on a success killed before rm | FIXED | 37479ebd |
| 3 | 1 | CONVENTION | .claude/plans/ | no plan file | FIXED | 37479ebd |
| 4 | 2 | WARNING | engine/update.test.js #553 | tests write a marker to a hardcoded absolute path | FIXED | d8ab0f4a |
| 5 | 3 | WARNING | engine/update.js:481 | rm unlinks /dev/null sentinel + non-zero exit records false failure | FIXED | 206ead7e |
| 6 | 4 | NIT | plan file | marker test count 11 -> 12 | FIXED | b9a56eba |

### NITs (deferred, non-blocking)
- stamp-equality suppression vs ms-identical stamps across board lifetimes (astronomically improbable)
- interrupted endedAt = marker mtime (spawn time); no kill-time trace exists
- spawn-error stale marker reads "interrupted" not "could not start" (thin, transient)
- mkdtemp temp-dir accumulation under os.tmpdir() (OS-reclaimed)

### Strengths (across all iterations)
- Strictly add-only: detached/unref/stdio untouched; only the observability witness added (the recall design stays flagged for Josh)
- The shell tail is POSIX-clean, always removes a real marker (success or clean failure), never unlinks the /dev/null sentinel, and exits 0 in both cases so a guarded no-op cannot register as a false failure
- The marker invariant + same-attempt suppression resolves every reachable disk state correctly; the one unsuppressable micro-window residual is documented as inherent
- The pre-#1728 install.status / lastAttempt() path is preserved exactly (fields, because string, log path), verified by the preserved #553 tests
- Non-vacuous tests: the /dev/null-guard test would fail without the guard (rc!=0), the "real command lifted from source" tests exec the shell so they cannot drift from update.js, and both the newest-wins picker and the same-attempt suppression have controlled inverse arms
