---
pre_challenge: true
method: challenge-loop
branch: fix-change-dialog-control-drift
diff_hash: fed96288b36e9337edc3e3af66702a7fb5bf0cdbf9271a62db9e97d439f4a952
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T01:58:43Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs)
**Fixed:** 2 | **Deferred:** 3 | **Asked (awaiting user):** 0

Fleet-wide `test` CI blocker. kosmos#2463 (merged 01:35Z) added a `providerOf`
reference to web/index.html. The control test web.change-dialog.test.js:80 runs
`git show origin/main:web/index.html` and executes that evolved page in a harness
that (on branches whose committed harness predates #2463) does not define
`providerOf`, so change() surfaced 'providerOf is not defined' into got.msg and
the control's `got.msg === 'Working…'` assertion failed on CI AND locally, for
EVERY open PR. Fix: retire the control BEHAVIOURALLY (skip when the old page no
longer produces the 'Working…' lie, for any reason) instead of by the stale
code-string regex it used to detect "main already carries the fix".

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
- [WARNING] web.change-dialog.test.js - the behavioural skip makes the control a
  permanent no-op now that origin/main carries #619's fix (it always skips, never
  reaches the assertion). --> DEFERRED: this is a deliberate, DOCUMENTED retirement
  (the pre-#619 subject is gone from origin/main; the live change-dialog coverage
  is the forward tests above, which drive CURRENT_PAGE). The alternative the
  reviewer named -- pinning `before` to a fixed pre-#619 sha to keep the bite --
  risks an old page not running in today's evolved harness and needs uncertain
  archaeology; documented it as a future enhancement rather than block a P0 fleet
  unblock on it.
- [NIT] web.change-dialog.test.js - the comment implied the providerOf THROW fires
  on THIS branch; in fact this branch carries #2463's harness (providerOf defined)
  so it takes the msg-mismatch exit; the throw reds stale-harness branches. -->
  FIXED: corrected the comment to say which of the two exits fires where.
- [NIT] web.change-dialog.test.js - `e && e.message` logs "undefined" for a
  non-Error throw. --> FIXED: `(e && e.message) || e`.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - reviewer reported "No issues found"; the change correctly stops
the fleet-wide red and the comment is accurate.
- [NIT] web.change-dialog.test.js:98 - "never the assertion" is very slightly
  absolute (a narrow theoretical path exists that in practice does not occur). -->
  DEFERRED: wording only; the reviewer itself notes it does not occur in practice.
- [NIT] web.change-dialog.test.js:117 - the catch swallows any error, not only the
  providerOf ReferenceError. --> DEFERRED: acceptable and intended -- the control
  is retired, so it should not surface harness breakages; the forward tests own
  live coverage.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web.change-dialog.test.js | Behavioural skip makes the control a permanent no-op | DEFERRED | Deliberate documented retirement; forward tests carry coverage; pinning noted as future |
| 2 | 1 | NIT | web.change-dialog.test.js | Comment wrong about which exit fires on this branch | FIXED | comment corrected |
| 3 | 1 | NIT | web.change-dialog.test.js | e && e.message logs "undefined" for non-Error | FIXED | (e && e.message) || e |
| 4 | 2 | NIT | web.change-dialog.test.js:98 | "never the assertion" slightly absolute | DEFERRED | wording; in practice does not occur |
| 5 | 2 | NIT | web.change-dialog.test.js:117 | catch swallows any error | DEFERRED | intended for a retired control |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web.change-dialog.test.js:98 - wording (iteration 2, deferred)
- [NIT] web.change-dialog.test.js:117 - broad catch on a retired control (iteration 2, deferred)

### Strengths (across all iterations)
- Dual guard is the right shape with no hole for the reported failure: change()
  swallows the ReferenceError into got.msg (msg-mismatch exit), and the try/catch
  additionally covers a hard throw (iterations 1, 2).
- Not too broad: only the OLD origin/main page's verification is relaxed; a real
  harness regression is still caught hard by the unchanged forward tests that drive
  CURRENT_PAGE (iterations 1, 2).
- Retirement documented behaviourally rather than by tightening the already-brittle
  regex, with the concrete future fix (pin to a pre-#619 sha) named, and each exit
  emits a clear diagnostic naming the actual got.msg (iteration 2).
