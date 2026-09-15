---
pre_challenge: true
method: challenge-loop
branch: pkg-1670-retry-main
diff_hash: 3b9a84410218c54d1d95b4b89366a972cf1a2f0920b6ea7ad8abefbc9830d917
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T18:35:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero NEW BLOCKER/WARNING/CONVENTION findings; witnessed by two models)
**Total findings:** 2 WARNINGs, 1 CONVENTION, 4 NITs (+ STRENGTHs)
**Fixed:** 2 WARNINGs (+ 1 NIT) | **Deferred:** 1 CONVENTION + 3 NITs | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** general-purpose (Opus-family default)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty at iteration 1; 6.0 passed so the first reviewer is iteration 1 with an empty list)
- [WARNING] install/pkg-scripts/postinstall:222 (BRANCH) - hardcoded `/bin/sleep 3`; the `_rsleep`/`KOSMOS_PKG_RETRY_SLEEP` knob was computed+sanitized but never used (dead), and the test's SLEEP=0 fast-drive was a no-op (23.5s). --> FIXED (5e39aef91): `/bin/sleep "$_rsleep"`.
- [WARNING] tools/test-pkg-checksum-1670.sh:74-79 (BRANCH) - comment claimed the refuse arms "complete instantly"; false due to the hardcoded sleep. --> FIXED (5e39aef91): resolved by wiring _rsleep; runtime now 2s.
- [NIT] tools/test-pkg-checksum-1670.sh:110,150 (BRANCH) - killed background servers printed job-control "Terminated: 15" noise. --> FIXED (5e39aef91): `wait "$SRV"` after kill.

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per kosmos#2032)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (the sanitize block flagged predates the loop; it is in the pre-loop cherry-picked #1670 commit, so BRANCH)
**Duplicates of prior findings (confirmed resolved):** the iter-1 sleep fix was confirmed present.
- [WARNING] install/pkg-scripts/postinstall:194-197,222 (BRANCH) - digit sanitize had no UPPER bound: a large-but-numeric KOSMOS_PKG_RETRY_SLEEP could hang the install, and a value `sleep` itself rejects would abort under `set -e` (unguarded last statement) with raw usage text; `_rmax` had no ceiling either. Prod-unreachable (sudo -u -H strips env) so the served pkg is unaffected, but the comment overstated the guard. --> FIXED (98e326226): clamp both to max 10 attempts / 10s pause; overflow and too-large cases fall to default or cap via the `||` guards.
- [CONVENTION] commit 786b5c307 (BRANCH) - the cherry-picked #1670 commit subject "pkg #1670: ..." is a hybrid of the two accepted forms. --> DEFERRED: the repo squash-merges PRs (evidence: #3098/#3102/#3114 all landed as squash commits), so intermediate commit subjects never reach main; the squash-merge uses the convention-compliant PR title. Cosmetic and does not reach main.
- [NIT] postinstall message consolidation (BRANCH) - absent-checksum and setup-download-failure now share one "could not download..." message. --> DEFERRED: intentional; both are transient/safe-to-retry, the test assertion was updated in lockstep, no stale references remain.
- [NIT] postinstall `_why` last-write (BRANCH) - the final refuse message reflects only the last attempt's failure mode. --> DEFERRED: cosmetic; the retry-then-refuse outcome is identical, and the message is best-effort guidance.

#### Iteration 3
**Reviewer model:** general-purpose (Opus-family default; rotated back per the two-model ping-pong)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings. Both NITs are the deferred iter-2 concerns re-observed and confirmed harmless/intentional:
- [NIT] postinstall:204-206 - a 20+ digit value prints cosmetic `[: integer expression expected` to stderr before the `||` fallback; the value is still correctly bounded and the script exits 0 (no abort, no hang), only reachable via a manual non-default-sudoers invocation. Reviewer: "not warranted" to fix. DEFERRED.
- [NIT] postinstall:222-224 - message consolidation (dedup of the iter-2 NIT). DEFERRED.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | postinstall:222 | BRANCH | dead _rsleep / hardcoded sleep | FIXED | 5e39aef91 |
| 2 | 1 | WARNING | test:74-79 | BRANCH | false "instantly" comment | FIXED | 5e39aef91 (wired _rsleep) |
| 3 | 1 | NIT | test:110,150 | BRANCH | job-control noise | FIXED | 5e39aef91 (wait after kill) |
| 4 | 2 | WARNING | postinstall:194-197 | BRANCH | unbounded retry knobs (hang / set -e abort) | FIXED | 98e326226 (clamp 10/10) |
| 5 | 2 | CONVENTION | commit 786b5c307 | BRANCH | hybrid commit subject | DEFERRED | repo squash-merges; never reaches main |
| 6 | 2 | NIT | postinstall (msg) | BRANCH | message consolidation | DEFERRED | intentional; test updated |
| 7 | 2 | NIT | postinstall (_why) | BRANCH | last-write refuse message | DEFERRED | cosmetic |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Job-control noise (iter 1) - FIXED.
- Message consolidation (iter 2, re-confirmed iter 3) - DEFERRED (intentional).
- `_why` last-write refuse message (iter 2) - DEFERRED (cosmetic).
- 20+ digit stderr noise on a manual absurd value (iter 3) - DEFERRED (harmless, prod-unreachable, reviewer said not warranted).

### Strengths (across all iterations)
- Verification cannot be bypassed: `exec /bin/sh "$d/setup"` is reachable only via the `break` guarded by `[ -n "$want" ] && [ "$want" = "$got" ]`; every other path retries or `exit 1`s. The loop is provably bounded (clamped _rmax, monotonic n). (all iterations)
- The digit-sanitize + ceiling-clamp is robust against every abuse class probed (`-5`, `abc`, `3.5`, empty, `007`, `0`, `10000000000`, 20+ digit overflow): non-digits/out-of-range fall back to default, in-range values ceiling-capped, and only legal digit strings <=10 ever reach `/bin/sleep`. (iter 2, 3)
- ARM 4 (transient-recovery) is deterministic + red-capable: a hit-counter origin serves wrong-then-right, guaranteeing attempt 1 mismatches and attempt 2 recovers; a single-shot regression leaves RAN uncreated and fails the arm. (all iterations)
- `sh -n` (postinstall, incl. the nested single-quoted `sh -c` body with no apostrophe breakage) and `bash -n` (test) both clean; suite 11/11 PASS exit 0; em-dash clean across all added lines (literal, entity, \u spellings); both files wired into test:shell. (all iterations)
- The bounded retry preserves #1670's fail-closed threat model exactly: a persistent mismatch or persistently-unreachable checksum still refuses after the retry budget; verification is retried, never skipped. (all iterations)

### Note for the reviewer/merger
This branch is RESOLVER-FREE (based on origin/main; ICK's resolver fix landed separately as #3114). A pre-existing stale comment at postinstall:~33 ("confirms they hold a real Aqua GUI session") is now inaccurate ON MAIN after #2511/#3114, but is accurate on THIS branch's own (old) resolve-install-user.sh, so it is correctly a follow-up on post-merge main rather than a fold-in here.
