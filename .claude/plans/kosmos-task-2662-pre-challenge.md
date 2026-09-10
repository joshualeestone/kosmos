---
pre_challenge: true
method: challenge-loop
branch: kosmos-task-2662
diff_hash: 7715df7a6dc1cc31ed2ad77191ab4aec8ac4c550f4861721f741439aa02519d9
validation: passed
subdir_audit: passed
timestamp: 2026-09-10T20:13:25Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 2 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 6 NITs (plus 1 synthetic 6.0 finding)
**Fixed:** most | **Deferred:** 2 NITs

This loop earned its keep: every iteration through 4 found real issues (a shipped em dash, a
security-critical verb with no test, a help-flag routing BLOCKER, a silent-data-loss bug, a
false-success-shape gap, a sanitizer divergence, and a validation-ordering convention), and iteration
4 (sonnet) converged after independently injecting the two regressions the new test claims to catch
and confirming both red the assertions.

### Per-Iteration Breakdown

#### 6.0 initial validation
FAILED: tools/test-msg-newlines-1927.sh's whitelist count (4) was stale -- cmd_task added two more
multi-line JSON-escape sites. FIXED (4d6b5cf2): bumped 4->6; the broken-form guard still enforces 0.

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 1 WARNING, 2 NITs
**Self-generated:** 0
- [BLOCKER] install/kosmos:1372 -- a literal em dash in cmd_task's header comment (ships in the CLI) --> FIXED (4d6b5cf2)
- [WARNING] install/kosmos -- the security-critical verb had no shell-level test --> FIXED: added cli.task-2662.test.js (set-e + token-off-argv) (4d6b5cf2)
- [NIT] engine/projects.test.js -- curly apostrophe in an assertion message --> FIXED (4d6b5cf2)
- [NIT] install/kosmos -- healthy() before arg-usage checks --> initially deferred, FIXED in iteration 3

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 5 WARNINGs, 2 NITs
**Self-generated:** 0 (findings on the original code / the fix's own coverage)
- [BLOCKER] install/kosmos:1197 -- the #1674 -h/--help guard whitelist omitted 'task', so 'kosmos task --help' never reached cmd_task --> FIXED (8e7f8e1c)
- [WARNING] install/kosmos:1199 -- the catch-all verb list also omitted 'task' --> FIXED (8e7f8e1c)
- [WARNING] add/close -- treated any non-error body as success --> FIXED: match the board's {"task":...} shape, fallback exits 1 (8e7f8e1c)
- [WARNING] add -- detail was $3 only, dropping $4+ on an unquoted multi-word detail --> FIXED: fold trailing args into detail (8e7f8e1c)
- [WARNING] esc_project -- an independently-invented sanitizer diverged from cmd_room's --> FIXED: reuse cmd_room's exact sed (8e7f8e1c)
- [WARNING] cli.task-2662.test.js -- the token-off-argv sandbox was never cleaned up --> FIXED: finally cleanup (8e7f8e1c)
- [NIT] ordering (healthy before verb-recognition) --> FIXED: recognize the subcommand before healthy (8e7f8e1c)
- [NIT] test could migrate a real store on a direct run --> FIXED: KOSMOS_NO_LEGACY_MIGRATION=1 in both tests (8e7f8e1c)
- [NIT] list renderer could double-print on a mid-loop console.log throw --> DEFERRED: pathological for well-formed board output; the raw-JSON fallback is right for genuinely unparseable data

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 CONVENTION, 1 NIT
**Self-generated:** 0
- [CONVENTION] install/kosmos -- only the subcommand was validated before healthy(); the positional args were validated after, unlike cmd_post/cmd_room --> FIXED (4000db9e): move each subcommand's required-arg + number validation before the health check
- [NIT] add/close success messages keep a now-dead ${project:-...} fallback --> DEFERRED: defensive default matching the file's cautious style

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** -- no new actionable findings. The reviewer injected both regressions the new test
claims to catch (a bare body=$(...) losing the rc guard; a dropped token) and confirmed both red the
expected assertion, so the tests are fault-detecting, not vacuous.
- [NIT] cli.task-2662.test.js -- a cleanup comment inaccurately claimed the sibling test cleans up unconditionally --> FIXED (c16a0800)

### Final Ledger

| # | Iter | Category | File | Origin | Status | Resolution |
|---|------|----------|------|--------|--------|------------|
| 1 | 6.0 | BLOCKER(synthetic) | tools/test-msg-newlines-1927.sh | BRANCH | FIXED | 4d6b5cf2 |
| 2 | 1 | BLOCKER | install/kosmos (em dash) | BRANCH | FIXED | 4d6b5cf2 |
| 3 | 1 | WARNING | install/kosmos (no CLI test) | BRANCH | FIXED | 4d6b5cf2 |
| 4 | 1 | NIT | engine/projects.test.js (apostrophe) | BRANCH | FIXED | 4d6b5cf2 |
| 5 | 2 | BLOCKER | install/kosmos:1197 (help-flag) | BRANCH | FIXED | 8e7f8e1c |
| 6 | 2 | WARNING | install/kosmos:1199 (verb list) | BRANCH | FIXED | 8e7f8e1c |
| 7 | 2 | WARNING | install/kosmos (success-shape) | BRANCH | FIXED | 8e7f8e1c |
| 8 | 2 | WARNING | install/kosmos (detail slurp) | BRANCH | FIXED | 8e7f8e1c |
| 9 | 2 | WARNING | install/kosmos (esc_project) | BRANCH | FIXED | 8e7f8e1c |
| 10 | 2 | WARNING | cli.task-2662.test.js (temp leak) | BRANCH | FIXED | 8e7f8e1c |
| 11 | 2 | NIT | install/kosmos (ordering) | BRANCH | FIXED | 8e7f8e1c |
| 12 | 2 | NIT | cli.task-2662.test.js (migration) | BRANCH | FIXED | 8e7f8e1c |
| 13 | 2 | NIT | install/kosmos (list dup) | BRANCH | DEFERRED | pathological |
| 14 | 3 | CONVENTION | install/kosmos (arg validation) | BRANCH | FIXED | 4000db9e |
| 15 | 3 | NIT | install/kosmos (dead fallback) | BRANCH | DEFERRED | defensive style |
| 16 | 4 | NIT | cli.task-2662.test.js (comment) | BRANCH | FIXED | c16a0800 |

### Outstanding questions (ASKED)
None.

### NITs (deferred)
- list renderer double-print on a mid-loop throw (iteration 2) -- pathological.
- dead ${project:-...} fallback in success messages (iteration 3) -- defensive default.

### Strengths (across all iterations)
- Board token never on argv: flows through kosmos_curl's mode-600 -H @file, verified end-to-end by
  the new test.
- Set-e safety: rc=0; body=$(...) || rc=$? in all three subcommands (the #2321 guard), tested.
- Success matching anchored on the board's own {"task":...} shape, verified against server.js's
  actual response key order at all three routes.
- esc_project sanitizer byte-identical to cmd_room's; URL vs JSON-body escaping applied correctly.
- The new test file is fault-detecting (both claimed regressions red the assertions when injected),
  sandbox cleaned in finally, migration-safe on a direct run.
